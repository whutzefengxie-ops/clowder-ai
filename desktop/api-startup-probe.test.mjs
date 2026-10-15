import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('startup evidence attributes module loads and thread identity without leaking file paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-graph-'));
  try {
    fs.writeFileSync(path.join(root, 'dep.mjs'), 'export const value = 1;');
    fs.writeFileSync(
      path.join(root, 'main.mjs'),
      "import {value} from './dep.mjs'; globalThis.__clowderStartupMilestone('http-listening');",
    );
    const output = execFileSync(
      process.execPath,
      ['--import', new URL('./api-startup-probe.mjs', import.meta.url).href, path.join(root, 'main.mjs')],
      { encoding: 'utf8' },
    );
    const events = output
      .trim()
      .split('\n')
      .filter((line) => line.startsWith('[api-startup]'))
      .map((line) => JSON.parse(line.slice(14)));
    const ready = events.find((event) => event.phase === 'http-listening');
    assert.ok(ready.moduleLoads >= 2);
    assert.equal(ready.threadId, 0);
    assert.ok(ready.moduleReadMs >= 0);
    assert.equal(output.includes(root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
