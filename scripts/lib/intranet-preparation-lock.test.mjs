import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { acquirePreparationLock, recoverPreparationLock } from './intranet-preparation-lock.mjs';

test('a failed lock write leaves no published lock and a subsequent preparation can acquire it', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'deployment-lock-'));
  const path = join(root, 'lock');
  const original = fs.writeFileSync;
  try {
    fs.writeFileSync = () => {
      throw new Error('simulated lock write EPERM');
    };
    syncBuiltinESMExports();
    assert.throws(() => acquirePreparationLock(path), /simulated lock write/);
  } finally {
    fs.writeFileSync = original;
    syncBuiltinESMExports();
  }
  assert.equal(fs.existsSync(path), false);
  const release = acquirePreparationLock(path);
  assert.ok(JSON.parse(fs.readFileSync(path, 'utf8')).birth);
  release();
});

test('an explicitly recovered stale birth identity is distinct from a live reused PID', () => {
  const path = join(fs.mkdtempSync(join(tmpdir(), 'deployment-reused-')), 'lock');
  fs.writeFileSync(path, JSON.stringify({ pid: process.pid, birth: 'previous-process-birth' }));
  recoverPreparationLock(path, (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined));
  assert.equal(fs.existsSync(path), false);
  assert.equal(fs.readdirSync(join(path, '..')).filter((x) => x.includes('.retained-')).length, 1);
});
