import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../../scripts/role-agent-quality.mjs', import.meta.url));
const controls = {
  'Q01-A': {
    healthy: {
      'src/cache.mjs': `export function createCache(now = Date.now) {
  const entries = new Map();
  return {
    put(key, value, ttlMs) { entries.set(key, { value, expiresAt: now() + ttlMs }); },
    get(key) { const item = entries.get(key); return item && now() < item.expiresAt ? item.value : undefined; },
  };
}`,
    },
    partial: { 'src/cache.mjs': null },
  },
  'Q01-B': {
    healthy: {
      'src/store.mjs': `export function listNotes(notes, options = {}) { return notes.filter(note => options.includeArchived === true || !note.archived); }`,
      'src/view.mjs': `import { listNotes } from './store.mjs';
export function renderNotes(notes, options) { return listNotes(notes, options).map(note => note.title).join('|'); }`,
    },
    partial: { 'src/view.mjs': null },
  },
  'Q01-C': {
    healthy: {
      'src/money.mjs': `export function parseMinorUnits(text) {
  const matched = /^([+-]?)([0-9]+)(?:\\.([0-9]{1,2}))?$/.exec(text.trim());
  if (!matched) return null;
  const value = (BigInt(matched[2]) * 100n + BigInt((matched[3] ?? '').padEnd(2, '0'))) * (matched[1] === '-' ? -1n : 1n);
  return value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER) ? null : Number(value);
}`,
    },
    partial: {
      'src/money.mjs': `export function parseMinorUnits(text) { return /^[-+]?[0-9]+(\\.[0-9]{1,2})?$/.test(text.trim()) ? Math.round(Number(text) * 100) : null; }`,
    },
  },
};

for (const [id, control] of Object.entries(controls)) {
  test(`${id} oracle rejects seed, incomplete fix and scope escape but accepts healthy control`, (t) => {
    const parent = resolve('artifacts/role-agent-refactor/quality-calibration');
    mkdirSync(parent, { recursive: true });
    const root = mkdtempSync(join(parent, `${id}-`)),
      workspace = join(root, 'candidate');
    t.diagnostic(`verifier calibration only; retained fixtures and immutable reports: ${root}`);
    const run = (args, cwd = process.cwd()) =>
      spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 15000 });
    const prepared = run([script, 'prepare', id, workspace]);
    assert.equal(prepared.status, 0, prepared.stderr);
    const baseline = new Map(
      Object.keys(control.healthy).map((path) => [path, readFileSync(join(workspace, path), 'utf8')]),
    );
    const verify = (label, expected) => {
      const path = join(root, `${label}.json`);
      const result = run([script, 'verify', id, workspace, path]);
      assert.equal(result.status, expected === 'PASS' ? 0 : 1, `${result.stdout}\n${result.stderr}`);
      const report = JSON.parse(readFileSync(path, 'utf8'));
      assert.equal(report.status, expected);
      assert.equal(report.scriptSha256.length, 64);
      return report;
    };
    const publicBefore = run(['--test', 'test/public.test.mjs'], workspace);
    assert.equal(publicBefore.status, 0, publicBefore.stdout);
    verify('seed', 'FAIL');
    Object.entries(control.healthy).forEach(([path, content]) => writeFileSync(join(workspace, path), content));
    assert.equal(run(['--test', 'test/public.test.mjs'], workspace).status, 0);
    verify('healthy', 'PASS');
    const protectedPath = join(workspace, 'test/public.test.mjs'),
      publicSource = readFileSync(protectedPath, 'utf8');
    writeFileSync(protectedPath, '// forbidden removal of public tests\n');
    assert.match(verify('scope-escape', 'FAIL').error, /超出允许范围/);
    writeFileSync(protectedPath, publicSource);
    Object.entries(control.partial).forEach(([path, content]) => {
      const partial =
        id === 'Q01-A' ? baseline.get(path).replace('ttlMs / 1000', 'ttlMs') : (content ?? baseline.get(path));
      writeFileSync(join(workspace, path), partial);
    });
    verify('incomplete', 'FAIL');
    const duplicate = run([script, 'prepare', id, workspace]);
    assert.notEqual(duplicate.status, 0, 'prepare must not overwrite an existing evaluation workspace');
    assert.equal(readFileSync(protectedPath, 'utf8'), publicSource);
  });
}
