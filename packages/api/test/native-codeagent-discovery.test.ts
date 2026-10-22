import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoverCodeAgentRuntimes } from '../src/routes/native-codeagent-discovery.js';

test('intranet CodeAgent discovery provides three identities without requiring any other installed CLI', () => {
  const probed: string[] = [];
  const runtimes = discoverCodeAgentRuntimes((name) => {
    probed.push(name);
    return name === 'codeagent' ? 'D:/Enterprise/codeagent.exe' : null;
  }, true);
  assert.deepEqual(probed, ['codeagent']);
  assert.deepEqual(
    runtimes.map((runtime) => runtime.roleTemplateId),
    ['ragdoll', 'maine-coon', 'turkish-van'],
  );
  for (const runtime of runtimes) {
    assert.equal(runtime.installed, true);
    assert.equal(runtime.clientId, 'acp');
    assert.equal(runtime.priority, 100);
    assert.deepEqual(runtime.acp, {
      command: 'D:/Enterprise/codeagent.exe',
      startupArgs: ['--acp'],
      transport: 'stdio',
    });
  }
});

test('missing CodeAgent stays visible but unavailable and never invents an executable or login status', () => {
  const runtimes = discoverCodeAgentRuntimes(() => null, true);
  assert.equal(runtimes.length, 3);
  for (const runtime of runtimes) {
    assert.equal(runtime.installed, false);
    assert.equal(runtime.acp, undefined);
  }
});
