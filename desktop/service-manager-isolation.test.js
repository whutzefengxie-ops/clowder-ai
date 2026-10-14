const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('isolated desktop Redis probing, spawn and API env all use the same owned port', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-isolation-'));
  process.env.LOCALAPPDATA = base;
  const ServiceManager = require('./service-manager');
  const manager = new ServiceManager(base, { frontendPort: 5158, apiPort: 3158, redisPort: 6367 });
  const probes = [],
    starts = [];
  const spawnProcess = manager._startProcess.bind(manager);
  manager._isPortOpen = async (port) => {
    probes.push(port);
    return false;
  };
  manager._commandExists = async () => true;
  manager._startProcess = (...args) => starts.push(args);
  manager._waitForPortWithFallback = async (port) => {
    probes.push(port);
    return true;
  };
  try {
    await manager._startRedis(base);
    assert.deepEqual(probes, [6367, 6367]);
    assert.equal(starts[0][2][1], '6367');
    // Observe the env received by a real, test-owned Node child; no API/Redis starts.
    const resultPath = path.join(base, 'env.json');
    spawnProcess('probe', process.execPath, [
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({redis:process.env.REDIS_URL}))`,
    ]);
    await new Promise((resolve) => manager.procs.probe.once('exit', resolve));
    assert.equal(JSON.parse(fs.readFileSync(resultPath, 'utf8')).redis, 'redis://localhost:6367');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
