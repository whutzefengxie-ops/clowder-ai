import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createDirectAgentCarrierSession } from '../src/domains/cats/services/agents/providers/DirectAgentCarrierSession.js';

test(
  'Windows direct app-server carrier executes the npm CMD entry without a shell error',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'codex-native-shim-'));
    mkdirSync(join(root, 'node_modules/example'), { recursive: true });
    writeFileSync(
      join(root, 'node_modules/example/entry.js'),
      'console.log(JSON.stringify({ok: true, value: process.argv[2]}))',
    );
    const shim = join(root, 'test-agent.cmd');
    writeFileSync(shim, '@ECHO OFF\nnode "%~dp0\\node_modules\\example\\entry.js" %*\n');
    const session = await createDirectAgentCarrierSession({
      command: shim,
      args: ['quoted value & symbols'],
      cwd: root,
      invocationId: 'native-shim-test',
    });
    try {
      const output: unknown[] = [];
      for await (const value of session.read()) output.push(value);
      assert.deepEqual(output, [{ ok: true, value: 'quoted value & symbols' }]);
    } finally {
      await session.close();
    }
  },
);
