import {
  assertBattleEvent,
  type ActiveSlot,
  type BattleEvent,
  type SideId,
} from '../core/battle-state.js';
import {
  CurrentBattleEvaluator,
  type CurrentEvaluationRequest,
} from '../core/current-evaluator.js';
import { parseShowdownProtocol } from '../input/showdown-protocol.js';
import type { SessionResult } from '../web/live-types.js';
import { ShowdownAdapter } from './browser-adapter.js';
import { BrowserBattleSession } from './browser-session.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function readBody(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  if (typeof init?.body === 'string') return JSON.parse(init.body || '{}') as unknown;
  if (init?.body instanceof Blob) return JSON.parse(await init.body.text()) as unknown;
  if (input instanceof Request) {
    const text = await input.clone().text();
    return text ? JSON.parse(text) as unknown : {};
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateEvents(value: unknown): BattleEvent[] {
  if (!Array.isArray(value)) throw new Error('eventsは配列で指定してください。');
  return value.map((event) => {
    assertBattleEvent(event);
    return event;
  });
}

function validateSide(value: unknown): SideId {
  if (value !== 'p1' && value !== 'p2') throw new Error('sideはp1またはp2で指定してください。');
  return value;
}

function validateSlots(value: unknown): ActiveSlot[] {
  if (!Array.isArray(value) || value.some((slot) => !/^(p1|p2)[ab]$/.test(String(slot)))) {
    throw new Error('actorSlotsが不正です。');
  }
  return value as ActiveSlot[];
}

export class PagesApiEmulator {
  private readonly evaluator: CurrentBattleEvaluator;

  constructor(
    private readonly adapter: ShowdownAdapter,
    private readonly session: BrowserBattleSession,
  ) {
    this.evaluator = new CurrentBattleEvaluator(adapter);
  }

  async handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> {
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    const url = new URL(rawUrl, window.location.href);
    if (!url.pathname.startsWith('/api/')) return null;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

    try {
      if (method === 'GET' && url.pathname === '/api/health') {
        return jsonResponse({ status: 'ok', engine: 'browser', mod: 'champions', persistence: 'localStorage' });
      }

      if (method === 'GET' && url.pathname === '/api/search') {
        const kind = url.searchParams.get('kind');
        const query = url.searchParams.get('q') ?? '';
        if (kind !== 'species' && kind !== 'moves') throw new Error('検索種別はspeciesまたはmovesを指定してください。');
        return jsonResponse({
          results: kind === 'species'
            ? this.adapter.searchSpecies(query)
            : this.adapter.searchMoves(query),
        });
      }

      if (method === 'GET' && url.pathname === '/api/state') {
        return jsonResponse(this.session.stateSnapshot());
      }

      if (method === 'POST' && url.pathname === '/api/state/events') {
        const body = await readBody(input, init);
        if (!isRecord(body)) throw new Error('JSONの形式が正しくありません。');
        return jsonResponse(this.session.applyMany(validateEvents(body.events)).state);
      }

      if (method === 'POST' && url.pathname === '/api/state/showdown') {
        const body = await readBody(input, init);
        if (!isRecord(body) || typeof body.text !== 'string') throw new Error('textを文字列で指定してください。');
        const events = parseShowdownProtocol(body.text);
        const snapshot = this.session.applyMany(events);
        return jsonResponse({ parsedEvents: events.length, state: snapshot.state });
      }

      if (method === 'POST' && url.pathname === '/api/evaluate-current') {
        const body = await readBody(input, init);
        if (!isRecord(body)) throw new Error('JSONの形式が正しくありません。');
        const request: CurrentEvaluationRequest = {
          side: body.side === undefined ? 'p1' : validateSide(body.side),
          formatId: typeof body.formatId === 'string' ? body.formatId : this.session.snapshot().metadata.formatId,
          ...(typeof body.maxActionsPerPokemon === 'number'
            ? { maxActionsPerPokemon: body.maxActionsPerPokemon }
            : {}),
        };
        return jsonResponse(this.evaluator.evaluate(this.session.stateSnapshot(), request));
      }

      if (method === 'POST' && url.pathname === '/api/state/reset') {
        return jsonResponse(this.session.resetState().state);
      }

      if (method === 'GET' && url.pathname === '/api/session') {
        return jsonResponse(this.session.snapshot());
      }

      if (method === 'GET' && url.pathname === '/api/session/export') {
        return jsonResponse(this.session.exportData());
      }

      if (method === 'POST' && url.pathname === '/api/session/new') {
        const body = await readBody(input, init);
        const record = isRecord(body) ? body : {};
        return jsonResponse(this.session.startNew({
          ...(typeof record.title === 'string' ? { title: record.title } : {}),
          ...(typeof record.formatId === 'string' ? { formatId: record.formatId } : {}),
        }));
      }

      if (method === 'POST' && url.pathname === '/api/session/import') {
        return jsonResponse(this.session.importData(await readBody(input, init)));
      }

      if (method === 'POST' && url.pathname === '/api/session/undo') {
        const body = await readBody(input, init);
        const count = isRecord(body) && body.count !== undefined ? Number(body.count) : 1;
        if (!Number.isFinite(count) || count < 1) throw new Error('countが不正です。');
        return jsonResponse(this.session.undo(count));
      }

      if (method === 'POST' && url.pathname === '/api/session/decision') {
        const body = await readBody(input, init);
        if (!isRecord(body)) throw new Error('decisionが不正です。');
        if (body.kind !== 'individual' && body.kind !== 'joint') throw new Error('kindが不正です。');
        if (typeof body.actionId !== 'string' || typeof body.label !== 'string') throw new Error('行動が不正です。');
        if (typeof body.evaluationRevision !== 'number' || typeof body.score !== 'number') throw new Error('行動スコアが不正です。');
        return jsonResponse(this.session.recordDecision({
          evaluationRevision: body.evaluationRevision,
          side: validateSide(body.side),
          kind: body.kind,
          actionId: body.actionId,
          label: body.label,
          score: body.score,
          actorSlots: validateSlots(body.actorSlots),
          ...(typeof body.notes === 'string' ? { notes: body.notes } : {}),
        }));
      }

      if (method === 'POST' && url.pathname === '/api/session/finish') {
        const body = await readBody(input, init);
        const record = isRecord(body) ? body : {};
        const allowed = new Set<SessionResult>(['win', 'loss', 'draw', 'cancelled', 'unknown']);
        const result = allowed.has(record.result as SessionResult) ? record.result as SessionResult : 'unknown';
        return jsonResponse(this.session.finish({
          result,
          ...(typeof record.notes === 'string' ? { notes: record.notes } : {}),
        }));
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : '内部エラーが発生しました。' }, 400);
    }
  }
}
