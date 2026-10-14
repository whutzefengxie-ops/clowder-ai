import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { discoverAdditionalRuntimes } from '../dist/routes/native-additional-runtimes.js';

test('detects Kimi/OpenCode/Pi without disclosing authentication, and distinguishes Pi RPC from ACP', () => {
  const root = mkdtempSync(join(tmpdir(), 'additional-runtime-'));
  const keys = ['KIMI_SHARE_DIR', 'KIMI_CONFIG_FILE', 'OPENCODE_CONFIG', 'XDG_CONFIG_HOME'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    mkdirSync(join(root, '.kimi'), { recursive: true });
    mkdirSync(join(root, '.config/opencode'), { recursive: true });
    writeFileSync(
      join(root, '.kimi/config.toml'),
      'default_model="kimi-code/k3"\n[models."kimi-code/k3"]\nprovider="native"\n[providers.native]\napi_key="sensitive-sentinel"\n',
    );
    writeFileSync(
      join(root, '.config/opencode/opencode.json'),
      JSON.stringify({ model: 'provider/model', provider: { key: 'sensitive-sentinel' } }),
    );
    const command = (name) => (name === 'pi-acp' ? null : join(root, `${name}.cmd`));
    const found = discoverAdditionalRuntimes(root, command);
    assert.deepEqual(
      found.map((r) => r.id),
      ['kimi', 'opencode', 'pi'],
    );
    assert.deepEqual(
      found.slice(0, 2).map((r) => r.configuredModel),
      ['kimi-code/k3', 'provider/model'],
    );
    assert.equal(found[2].installed, true);
    assert.equal(found[2].discoveryStatus, 'adapter_missing');
    assert.equal(found[2].acp, undefined);
    assert.doesNotMatch(JSON.stringify(found), /sensitive-sentinel|api_key/);
    const bridged = discoverAdditionalRuntimes(root, (name) => join(root, `${name}.cmd`));
    assert.deepEqual(bridged[2].acp, { command: join(root, 'pi-acp.cmd'), startupArgs: [], transport: 'stdio' });
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    rmSync(root, { recursive: true, force: true });
  }
});
