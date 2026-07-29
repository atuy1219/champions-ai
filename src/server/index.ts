import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

import { HeuristicAnalyzer } from '../core/heuristic.js';
import { InputError } from '../core/errors.js';
import type { AnalyzeRequest } from '../core/types.js';
import { ShowdownAdapter } from '../showdown/adapter.js';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';
const PUBLIC_ROOT = resolve(process.cwd(), 'dist/public');
const MAX_BODY_BYTES = 64 * 1024;

const showdown = new ShowdownAdapter();
const analyzer = new HeuristicAnalyzer(showdown);

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

async function serveStatic(
  pathname: string,
  response: ServerResponse,
): Promise<boolean> {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = resolve(join(PUBLIC_ROOT, safePath));

  if (!filePath.startsWith(PUBLIC_ROOT)) {
    return false;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;

    response.writeHead(200, {
      'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': filePath.endsWith('index.html')
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
      });
      return;
    }

    if (method === 'GET' && url.pathname === '/api/search') {
      const kind = url.searchParams.get('kind');
      const query = url.searchParams.get('q') ?? '';

      if (kind !== 'species' && kind !== 'moves') {
        throw new InputError('検索種別はspeciesまたはmovesを指定してください。');
      }

      const results =
        kind === 'species'
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

    if (method === 'GET' && await serveStatic(url.pathname, response)) {
      return;
    }

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

server.listen(PORT, HOST, () => {
  console.log(`champions-ai: http://${HOST}:${PORT}`);
});
