const path = require('node:path');
const fs = require('node:fs');

/** Opt-in isolated desktop instance; ordinary launches retain all historical defaults. */
function resolveDesktopRuntime(env = process.env) {
  const instanceRoot = env.CAT_CAFE_DESKTOP_INSTANCE_ROOT;
  if (instanceRoot === undefined) return { frontendPort: 3003, apiPort: 3004, redisPort: 6399, instanceRoot: null };
  if (!instanceRoot || !path.isAbsolute(instanceRoot)) throw new Error('Desktop instance root must be absolute');
  const port = (key) => {
    const raw = env[key];
    const value = /^\d+$/.test(raw || '') ? Number(raw) : NaN;
    if (!Number.isInteger(value) || value < 1024 || value > 65535 || [3003, 3004, 6399].includes(value))
      throw new Error(`Invalid isolated desktop port: ${key}`);
    return value;
  };
  const config = {
    instanceRoot: path.resolve(instanceRoot),
    frontendPort: port('FRONTEND_PORT'),
    apiPort: port('API_SERVER_PORT'),
    redisPort: port('REDIS_PORT'),
  };
  if (new Set([config.frontendPort, config.apiPort, config.redisPort]).size !== 3)
    throw new Error('Isolated desktop ports must be distinct');
  return config;
}
function rewriteDesktopLoopbackUrl(raw, config) {
  if (!config.instanceRoot) return undefined;
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) return undefined;
  const port = Number(url.port);
  if (port !== 3003 && port !== 3004 && port !== config.packagedApiPort) return undefined;
  url.port = String(port === 3003 ? config.frontendPort : config.apiPort);
  return url.href;
}
function readPackagedApiPort(root) {
  const { rewrites } = JSON.parse(fs.readFileSync(path.join(root, 'packages/web/.next/routes-manifest.json'), 'utf8'));
  const rules = Array.isArray(rewrites) ? rewrites : Object.values(rewrites).flat();
  const url = new URL(rules.find((rule) => rule.source === '/api/:path*')?.destination);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || !url.port)
    throw new Error('Packaged API rewrite must be a loopback origin for an isolated desktop');
  return Number(url.port);
}
module.exports = { resolveDesktopRuntime, rewriteDesktopLoopbackUrl, readPackagedApiPort };
