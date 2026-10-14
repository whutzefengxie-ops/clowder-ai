const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { createDesktopWebGateway } = require('./runtime-web-server');

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const close = (server) => new Promise((resolve) => server.close(resolve));
test('packaged rewrites proxy body and uploads to the actual owned API and keep pages in Next', async () => {
  const seen = [];
  const api = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      seen.push({ method: request.method, path: request.url, body });
      response.writeHead(201, { 'content-type': 'text/plain' });
      response.end('owned API');
    });
  });
  await listen(api);
  const gateway = createDesktopWebGateway((_request, response) => response.end('Next page'), api.address().port);
  await listen(gateway);
  const base = `http://127.0.0.1:${gateway.address().port}`;
  try {
    const result = await fetch(`${base}/api/cats`, { method: 'POST', body: 'owned payload' });
    assert.equal(result.status, 201);
    assert.equal(await result.text(), 'owned API');
    assert.equal(await (await fetch(`${base}/uploads/avatar.png`)).text(), 'owned API');
    assert.equal(await (await fetch(`${base}/settings`)).text(), 'Next page');
    assert.deepEqual(seen, [
      { method: 'POST', path: '/api/cats', body: 'owned payload' },
      { method: 'GET', path: '/uploads/avatar.png', body: '' },
    ]);
  } finally {
    await close(gateway);
    await close(api);
  }
});
