import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

import {
  assertBattleEvent,
  isActiveSlot,
  type ActiveSlot,
  type BattleEvent,
  type SideId,
} from '../core/battle-state.js';
import {
  CurrentBattleEvaluator,
  type CurrentEvaluationRequest,
} from '../core/current-evaluator.js';
import { HeuristicAnalyzer } from '../core/heuristic.js';
import { InputError } from '../core/errors.js';
import type { AnalyzeRequest } from '../core/types.js';
import { parseShowdownProtocol } from '../input/showdown-protocol.js';
import {
  BattleSessionService,
  type FinishSessionInput,
  type RecordDecisionInput,
  type SessionResult,
  type StartSessionInput,
} from './battle-session.js';
import { ShowdownAdapter } from '../showdown/adapter.js';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';
const PUBLIC_ROOT = resolve(process.cwd(), 'dist/public');
const SESSION_FILE = resolve(process.env.SESSION_FILE ?? join('.data', 'battle-session.json'));
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const showdown = new ShowdownAdapter();
const analyzer = new HeuristicAnalyzer(showdown);
const currentEvaluator = new CurrentBattleEvaluator(showdown);
const battleSession = new BattleSessionService(SESSION_FILE);

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > MAX_BODY_BYTES) {
      throw new InputError('リクエストが大きすぎます。');
    }

    chunks.push(buffer);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new InputError('JSONの形式が正しくありません。');
  }
}

function validateEvents(value: unknown): BattleEvent[] {
  if (!Array.isArray(value)) throw new InputError('eventsは配列で指定してください。');
  try {
    for (const event of value) assertBattleEvent(event);
  } catch (error) {
    throw new InputError(error instanceof Error ? error.message : 'イベント形式が正しくありません。');
  }
  return value;
}

function validateCurrentEvaluationRequest(value: CurrentEvaluationRequest): CurrentEvaluationRequest {
  if (value.side !== undefined && value.side !== 'p1' && value.side !== 'p2') {
    throw new InputError('sideはp1またはp2で指定してください。');
  }
  if (value.formatId !== undefined && typeof value.formatId !== 'string') {
    throw new InputError('formatIdは文字列で指定してください。');
  }
  if (
    value.maxActionsPerPokemon !== undefined
    && (!Number.isFinite(value.maxActionsPerPokemon) || value.maxActionsPerPokemon < 1)
  ) {
    throw new InputError('maxActionsPerPokemonが不正です。');
  }
  return value;
}

function validateStartSessionInput(value: unknown): StartSessionInput {
  if (!value || typeof value !== 'object') return {};
  const body = value as Record<string, unknown>;
  if (body.title !== undefined && typeof body.title !== 'string') throw new InputError('titleは文字列で指定してください。');
  if (body.formatId !== undefined && typeof body.formatId !== 'string') throw new InputError('formatIdは文字列で指定してください。');
  return {
    ...(typeof body.title === 'string' ? { title: body.title } : {}),
    ...(typeof body.formatId === 'string' ? { formatId: body.formatId } : {}),
  };
}

function validateDecisionInput(value: unknown): RecordDecisionInput {
  if (!value || typeof value !== 'object') throw new InputError('decisionを指定してください。');
  const body = value as Record<string, unknown>;
  if (body.side !== 'p1' && body.side !== 'p2') throw new InputError('decision.sideが不正です。');
  if (body.kind !== 'individual' && body.kind !== 'joint') throw new InputError('decision.kindが不正です。');
  if (typeof body.actionId !== 'string' || typeof body.label !== 'string') throw new InputError('行動IDまたは表示名が不正です。');
  if (typeof body.evaluationRevision !== 'number' || !Number.isFinite(body.evaluationRevision)) {
    throw new InputError('evaluationRevisionが不正です。');
  }
  if (typeof body.score !== 'number' || !Number.isFinite(body.score)) throw new InputError('scoreが不正です。');
  if (!Array.isArray(body.actorSlots) || body.actorSlots.some((slot) => !isActiveSlot(slot))) {
    throw new InputError('actorSlotsが不正です。');
  }
  return {
    evaluationRevision: Math.max(0, Math.trunc(body.evaluationRevision)),
    side: body.side as SideId,
    kind: body.kind,
    actionId: body.actionId,
    label: body.label,
    score: body.score,
    actorSlots: body.actorSlots as ActiveSlot[],
    ...(typeof body.notes === 'string' ? { notes: body.notes } : {}),
  };
}

function validateFinishInput(value: unknown): FinishSessionInput {
  if (!value || typeof value !== 'object') return { result: 'unknown' };
  const body = value as Record<string, unknown>;
  const allowed: SessionResult[] = ['win', 'loss', 'draw', 'cancelled', 'unknown'];
  if (body.result !== undefined && !allowed.includes(body.result as SessionResult)) {
    throw new InputError('resultが不正です。');
  }
  if (body.notes !== undefined && typeof body.notes !== 'string') throw new InputError('notesは文字列で指定してください。');
  return {
    result: (body.result as SessionResult | undefined) ?? 'unknown',
    ...(typeof body.notes === 'string' ? { notes: body.notes } : {}),
  };
}

async function serveStatic(
  pathname: string,
  response: ServerResponse,
): Promise<boolean> {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = resolve(join(PUBLIC_ROOT, safePath));

  if (!filePath.startsWith(PUBLIC_ROOT)) return false;

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;

    response.writeHead(200, {
      'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': filePath.endsWith('index.html') || filePath.endsWith('live.html')
        ? 'no-cache'
        : 'public, max-age=300',
    });
    createReadStream(filePath).pipe(response);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (request, response) => {
  try {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, {
        status: 'ok',
        engine: 'pokemon-showdown',
        mod: 'champions',
        persistence: SESSION_FILE,
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/search') {
      const kind = url.searchParams.get('kind');
      const query = url.searchParams.get('q') ?? '';
      if (kind !== 'species' && kind !== 'moves') {
        throw new InputError('検索種別はspeciesまたはmovesを指定してください。');
      }
      const results = kind === 'species'
        ? showdown.searchSpecies(query)
        : showdown.searchMoves(query);
      sendJson(response, 200, { results });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/analyze') {
      const body = await readJsonBody<AnalyzeRequest>(request);
      sendJson(response, 200, analyzer.analyze(body));
      return;
    }

    if (method === 'GET' && url.pathname === '/api/state') {
      sendJson(response, 200, battleSession.stateSnapshot());
      return;
    }

    if (method === 'POST' && url.pathname === '/api/state/events') {
      const body = await readJsonBody<{ events?: unknown }>(request);
      const snapshot = await battleSession.applyMany(validateEvents(body.events));
      sendJson(response, 200, snapshot.state);
      return;
    }

    if (method === 'POST' && url.pathname === '/api/state/showdown') {
      const body = await readJsonBody<{ text?: unknown }>(request);
      if (typeof body.text !== 'string') throw new InputError('textを文字列で指定してください。');
      const events = parseShowdownProtocol(body.text);
      const snapshot = await battleSession.applyMany(events);
      sendJson(response, 200, {
        parsedEvents: events.length,
        state: snapshot.state,
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/api/evaluate-current') {
      const body = validateCurrentEvaluationRequest(
        await readJsonBody<CurrentEvaluationRequest>(request),
      );
      const session = battleSession.snapshot();
      const evaluationRequest = {
        ...body,
        formatId: body.formatId?.trim() || session.metadata.formatId,
      };
      sendJson(response, 200, currentEvaluator.evaluate(session.state, evaluationRequest));
      return;
    }

    if (method === 'POST' && url.pathname === '/api/state/reset') {
      const previous = battleSession.snapshot().metadata;
      const snapshot = await battleSession.startNew({ title: previous.title, formatId: previous.formatId });
      sendJson(response, 200, snapshot.state);
      return;
    }

    if (method === 'GET' && url.pathname === '/api/session') {
      sendJson(response, 200, battleSession.snapshot());
      return;
    }

    if (method === 'GET' && url.pathname === '/api/session/export') {
      sendJson(response, 200, battleSession.exportData());
      return;
    }

    if (method === 'POST' && url.pathname === '/api/session/new') {
      const body = validateStartSessionInput(await readJsonBody<unknown>(request));
      sendJson(response, 200, await battleSession.startNew(body));
      return;
    }

    if (method === 'POST' && url.pathname === '/api/session/import') {
      sendJson(response, 200, await battleSession.importData(await readJsonBody<unknown>(request)));
      return;
    }

    if (method === 'POST' && url.pathname === '/api/session/undo') {
      const body = await readJsonBody<{ count?: unknown }>(request);
      const count = body.count === undefined ? 1 : Number(body.count);
      if (!Number.isFinite(count) || count < 1) throw new InputError('countが不正です。');
      sendJson(response, 200, await battleSession.undo(count));
      return;
    }

    if (method === 'POST' && url.pathname === '/api/session/decision') {
      sendJson(response, 200, await battleSession.recordDecision(
        validateDecisionInput(await readJsonBody<unknown>(request)),
      ));
      return;
    }

    if (method === 'POST' && url.pathname === '/api/session/finish') {
      sendJson(response, 200, await battleSession.finish(
        validateFinishInput(await readJsonBody<unknown>(request)),
      ));
      return;
    }

    if (method === 'GET' && await serveStatic(url.pathname, response)) return;

    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    if (error instanceof InputError) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }

    console.error(error);
    sendJson(response, 500, { error: '内部エラーが発生しました。' });
  }
});

async function start(): Promise<void> {
  await battleSession.initialize();
  server.listen(PORT, HOST, () => {
    console.log(`champions-ai: http://${HOST}:${PORT}`);
    console.log(`session file: ${SESSION_FILE}`);
  });
}

void start().catch((error) => {
  console.error('Failed to start champions-ai', error);
  process.exitCode = 1;
});
