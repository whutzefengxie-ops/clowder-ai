const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const moduleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-policy-'));
const homeKeys = ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'CAT_CAFE_DESKTOP_INSTANCE_ROOT'];
const original = Object.fromEntries(homeKeys.map((key) => [key, process.env[key]]));
for (const key of homeKeys.slice(0, 4)) process.env[key] = moduleRoot;
delete process.env.CAT_CAFE_DESKTOP_INSTANCE_ROOT;
const ServiceManager = require('./service-manager');
for (const [key, value] of Object.entries(original)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
after(() => fs.rmSync(moduleRoot, { recursive: true, force: true }));

test('desktop supplies an instance-owned policy path without writing it, with explicit paths winning', () => {
  const previous = process.env.CAT_CAFE_HOST_POLICY_FILE;
  const base = path.join(moduleRoot, 'host-policy');
  fs.mkdirSync(base, { recursive: true });
  const manager = new ServiceManager(base, { frontendPort: 5158, apiPort: 3158, redisPort: 6367 });
  try {
    delete process.env.CAT_CAFE_HOST_POLICY_FILE;
    assert.equal(manager._buildApiEnv(base).CAT_CAFE_HOST_POLICY_FILE, path.join(base, 'host-policy.json'));
    assert.equal(fs.existsSync(path.join(base, 'host-policy.json')), false);
    process.env.CAT_CAFE_HOST_POLICY_FILE = path.join(base, 'owner-policy.json');
    assert.equal(manager._buildApiEnv(base).CAT_CAFE_HOST_POLICY_FILE, process.env.CAT_CAFE_HOST_POLICY_FILE);
  } finally {
    if (previous === undefined) delete process.env.CAT_CAFE_HOST_POLICY_FILE;
    else process.env.CAT_CAFE_HOST_POLICY_FILE = previous;
  }
});

test('an isolated desktop keeps its own policy path instead of inheriting another deployment file', () => {
  const keys = [
    'CAT_CAFE_HOST_POLICY_FILE',
    'CAT_CAFE_DESKTOP_INSTANCE_ROOT',
    'FRONTEND_PORT',
    'API_SERVER_PORT',
    'REDIS_PORT',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const base = path.join(moduleRoot, 'isolated-policy');
  fs.mkdirSync(base, { recursive: true });
  try {
    process.env.CAT_CAFE_DESKTOP_INSTANCE_ROOT = base;
    process.env.FRONTEND_PORT = '5158';
    process.env.API_SERVER_PORT = '3158';
    process.env.REDIS_PORT = '6367';
    process.env.CAT_CAFE_HOST_POLICY_FILE = path.join(moduleRoot, 'another-deployment-policy.json');
    const manager = new ServiceManager(base, { frontendPort: 5158, apiPort: 3158, redisPort: 6367 });
    assert.equal(manager._buildApiEnv(base).CAT_CAFE_HOST_POLICY_FILE, path.join(base, 'host-policy.json'));
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
