import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { exportFrozenRuntime, materialize } from './scripts/frozen-runtime-export.mjs';

test('exports frozen nested/peer versions and workspace packages as portable real files', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'frozen-export-'));
  const workspace = path.join(base, 'workspace');
  const file = (relative, value) => {
    const target = path.join(workspace, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  };
  try {
    file('pnpm-lock.yaml', 'locked fixture');
    file('packages/api/package.json', '{"name":"api"}');
    file('packages/api/dist/index.cjs', 'module.exports = require("nested")');
    file('packages/shared/package.json', '{"name":"@cat-cafe/shared","main":"index.cjs"}');
    file('packages/shared/index.cjs', 'module.exports = 7');
    file('node_modules/@fastify/send/package.json', '{"name":"@fastify/send","main":"index.cjs"}');
    file('node_modules/@fastify/send/index.cjs', 'module.exports = 5');
    file('node_modules/@fastify/send/test/fixtures/snow \u2603/index.txt', 'fixture only');
    file('node_modules/nested/package.json', '{"name":"nested","version":"1.0.0","main":"index.cjs"}');
    file('node_modules/nested/index.cjs', 'module.exports = require("peer")');
    file('node_modules/peer/package.json', '{"name":"peer","version":"1.0.0","main":"index.cjs"}');
    file('node_modules/peer/index.cjs', 'module.exports = 1');
    file('node_modules/nested/node_modules/peer/package.json', '{"name":"peer","version":"2.0.0","main":"index.cjs"}');
    file('node_modules/nested/node_modules/peer/index.cjs', 'module.exports = 2');
    file('node_modules/override/package.json', '{"name":"override","main":"index.cjs"}');
    file('node_modules/override/index.cjs', 'module.exports = require("peer")');
    file('node_modules/override/node_modules/peer/package.json', '{"name":"peer","main":"index.cjs"}');
    file('node_modules/override/node_modules/peer/index.cjs', 'module.exports = 99');
    file('packages/api/node_modules/override/package.json', '{"name":"override","main":"index.cjs"}');
    file('packages/api/node_modules/override/index.cjs', 'module.exports = require("peer")');
    fs.mkdirSync(path.join(workspace, 'node_modules/@cat-cafe'));
    fs.symlinkSync(
      path.join(workspace, 'packages/shared'),
      path.join(workspace, 'node_modules/@cat-cafe/shared'),
      'junction',
    );
    const out = path.join(base, 'output');
    exportFrozenRuntime(workspace, out, ['api'], path.join(workspace, 'pnpm-lock.yaml'));
    const moved = path.join(base, 'moved');
    fs.renameSync(out, moved);
    const require = createRequire(path.join(moved, 'api/package.json'));
    assert.equal(require('./dist/index.cjs'), 2);
    assert.equal(require('@cat-cafe/shared'), 7);
    assert.equal(require('@fastify/send'), 5);
    assert.equal(fs.existsSync(path.join(moved, 'api/node_modules/@fastify/send/test')), false);
    assert.equal(require('override'), 1, 'private version must not inherit another version leftover peers');
    assert.equal(fs.lstatSync(path.join(moved, 'api/node_modules/@cat-cafe/shared')).isSymbolicLink(), false);
    assert.throws(
      () => exportFrozenRuntime(workspace, moved, ['api'], path.join(workspace, 'pnpm-lock.yaml')),
      /must be new/,
    );
    file('pnpm-lock.yaml', 'drift');
    fs.writeFileSync(path.join(base, 'source-lock'), 'locked fixture');
    assert.throws(
      () => exportFrozenRuntime(workspace, path.join(base, 'drift'), ['api'], path.join(base, 'source-lock')),
      /lock changed/,
    );
    fs.symlinkSync(os.tmpdir(), path.join(workspace, 'escape'), 'junction');
    assert.throws(() => materialize(path.join(workspace, 'escape'), path.join(base, 'bad'), workspace), /External/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
