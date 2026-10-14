const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { createRequire } = require('node:module');

// A packaged Next build can contain build-time rewrite destinations. The isolated
// desktop gateway owns these routes at runtime instead of reaching another instance.
function createDesktopWebGateway(handler, apiPort) {
  const proxy = (url) => /^\/(?:api|socket\.io|uploads)(?:\/|\?|$)/.test(url || '');
  const server = http.createServer((request, response) => {
    if (!proxy(request.url)) return handler(request, response);
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: apiPort,
        path: request.url,
        method: request.method,
        headers: { ...request.headers, host: `localhost:${apiPort}` },
      },
      (result) => {
        response.writeHead(result.statusCode, result.headers);
        result.pipe(response);
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end('Isolated API unavailable');
    });
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  });
  server.on('upgrade', (request, socket, head) => {
    if (!proxy(request.url)) return socket.destroy();
    const upstream = net.connect(apiPort, '127.0.0.1', () => {
      upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`);
      for (const [name, value] of Object.entries(request.headers))
        upstream.write(`${name}: ${name === 'host' ? `localhost:${apiPort}` : value}\r\n`);
      upstream.write('\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
  });
  return server;
}
async function start() {
  const [web, frontendPort, apiPort] = process.argv.slice(2);
  const requireWeb = createRequire(path.join(web, 'package.json'));
  const app = requireWeb('next')({ dev: false, dir: web });
  await app.prepare();
  const server = createDesktopWebGateway(app.getRequestHandler(), Number(apiPort));
  await new Promise((resolve) => server.listen(Number(frontendPort), '127.0.0.1', resolve));
  const stop = () => server.close(() => app.close().then(() => process.exit(0)));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
if (require.main === module)
  start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { createDesktopWebGateway };
