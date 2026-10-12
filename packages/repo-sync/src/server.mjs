import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatch } from './actions.mjs';
import { body, requestPath, requireToken, send } from './http.mjs';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const assets = new Map([
  ['/', 'index.html'],
  ['/app.mjs', 'app.mjs'],
  ['/styles.css', 'styles.css'],
  ['/progress.mjs', 'progress.mjs'],
  ['/receipts.mjs', 'receipts.mjs'],
]);
export function createReceiverServer(receiver, options = {}) {
  const token = randomBytes(32).toString('hex');
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
    );
    try {
      const path = requestPath(request, server.address()?.port);
      if (request.method === 'GET') return await get(receiver, options, token, path, response);
      if (request.method !== 'POST' || path !== '/api/action') return send(response, 404, { code: 'NOT_FOUND' });
      requireToken(request, token);
      const input = await body(request);
      const result = await dispatch(receiver, input, options);
      return send(response, 200, { result: input.action === 'heads' ? result : null, state: await receiver.status() });
    } catch (error) {
      return sendError(response, error);
    }
  });
  return server;
}
function sendError(response, error) {
  const status = ['HOST_REJECTED', 'ORIGIN_REJECTED', 'TOKEN_REJECTED'].includes(error.code)
    ? 403
    : error.code === 'BODY_TOO_LARGE'
      ? 413
      : 409;
  return send(response, status, {
    code: error.code ?? 'INVALID_REQUEST',
    message: error.code ? error.message : '请求未完成，请核对输入与当前步骤',
  });
}
async function get(receiver, options, token, path, response) {
  const demoPr = options.demoMerge && /^\/demo\/pr\/[a-f0-9]{24}$/.test(path);
  if (assets.has(path) || demoPr) {
    const file = demoPr ? 'index.html' : assets.get(path);
    const type = file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    response.setHeader('Content-Type', `${type}; charset=utf-8`);
    response.end(await readFile(resolve(web, file)));
    return;
  }
  if (path !== '/api/status') return send(response, 404, { code: 'NOT_FOUND' });
  const { sourceUrl, internalUrl, sourceBranch, targetBranch } = receiver.config;
  return send(response, 200, {
    token,
    state: await receiver.status(),
    config: { sourceUrl, internalUrl, sourceBranch, targetBranch },
    synthetic: Boolean(options.demoMerge),
  });
}
export function listen(server, port = 5187) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3003, 3004].includes(port))
    throw new Error('本地工具端口无效或被 Clowder AI 保留');
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolvePromise(server));
  });
}
