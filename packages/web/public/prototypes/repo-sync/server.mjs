import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const cssRoot = resolve(root, '../../../src/app');
const files = new Map(
  [
    'index.html',
    'styles.css',
    'binding.css',
    'delivery.css',
    'workbench.css',
    'task-model.mjs',
    'render-task.mjs',
    'progress.mjs',
    'issues.mjs',
    'delivery.mjs',
    'audit.mjs',
    'render-delivery.mjs',
    'binding.mjs',
    'baseline.mjs',
    'binding-ui.mjs',
    'render-binding.mjs',
    'app.mjs',
    'data.mjs',
    'state.mjs',
    'storage.mjs',
    'pr.html',
    'pr.mjs',
    'html.mjs',
    'render-flow.mjs',
    'render-overview.mjs',
    'render-detail.mjs',
  ].map((file) => [`/${file}`, resolve(root, file)]),
);
files.set('/', resolve(root, 'index.html'));
files.set('/native-theme.css', resolve(cssRoot, 'theme-tokens.css'));
files.set('/native-console.css', resolve(cssRoot, 'console-tokens.css'));
const port = Number(process.env.REPO_SYNC_PORT ?? 5186);
if ([3003, 3004].includes(port)) throw new Error('Clowder AI 保留端口不可用于原型');
createServer(async (request, response) => {
  const requestedPath = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  const path = /^\/internal\/demo\/core\/pull\/\d+$/.test(requestedPath)
    ? resolve(root, 'pr.html')
    : files.get(requestedPath);
  if (!path) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  try {
    const content = await readFile(path);
    response.writeHead(200, {
      'Content-Type': path.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : path.endsWith('.mjs')
          ? 'text/javascript; charset=utf-8'
          : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
    });
    response.end(content);
  } catch {
    response.writeHead(500);
    response.end('File unavailable');
  }
}).listen(port, '127.0.0.1', () => console.log(`仓库同步原型：http://127.0.0.1:${port}`));
