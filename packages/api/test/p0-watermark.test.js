import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  evaluateP0Freshness,
  readP0SyncWatermark,
  writeP0SyncWatermark,
} from '../dist/domains/cats/services/hindsight-import/p0-watermark.js';

test('writeP0SyncWatermark persists and readP0SyncWatermark restores payload', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'cat-cafe-watermark-'));
  const importedAt = new Date('2026-02-14T12:00:00.000Z').toISOString();
  const expected = {
    version: 1,
    bankId: 'cat-cafe-shared',
    sourceCommit: 'abc1234',
    importedAt,
    sourceCount: 10,
    chunkCount: 111,
    sourcePaths: ['docs/decisions/005-hindsight-integration-decisions.md'],
  };

  const path = await writeP0SyncWatermark(repoRoot, expected, 'tmp/p0-watermark.json');
  const raw = await readFile(path, 'utf8');
  assert.ok(raw.includes('"sourceCommit": "abc1234"'));

  const restored = await readP0SyncWatermark(repoRoot, 'tmp/p0-watermark.json');
  assert.deepEqual(restored, expected);
});

test('evaluateP0Freshness returns stale when git head differs from watermark commit', () => {
  const freshness = evaluateP0Freshness('def5678', {
    version: 1,
    bankId: 'cat-cafe-shared',
    sourceCommit: 'abc1234',
    importedAt: new Date('2026-02-14T12:00:00.000Z').toISOString(),
    sourceCount: 10,
    chunkCount: 111,
    sourcePaths: [],
  });

  assert.equal(freshness.status, 'stale');
  assert.equal(freshness.headCommit, 'def5678');
  assert.equal(freshness.watermarkCommit, 'abc1234');
  assert.equal(freshness.reason, 'commit_mismatch');
});

test('evaluateP0Freshness returns fresh when git head matches watermark commit', () => {
  const freshness = evaluateP0Freshness('abc1234', {
    version: 1,
    bankId: 'cat-cafe-shared',
    sourceCommit: 'abc1234',
    importedAt: new Date('2026-02-14T12:00:00.000Z').toISOString(),
    sourceCount: 10,
    chunkCount: 111,
    sourcePaths: [],
  });

  assert.equal(freshness.status, 'fresh');
  assert.equal(freshness.headCommit, 'abc1234');
  assert.equal(freshness.watermarkCommit, 'abc1234');
  assert.equal(freshness.reason, 'commit_match');
});

test('evaluateP0Freshness returns unknown when git head is unavailable', () => {
  const freshness = evaluateP0Freshness(null, {
    version: 1,
    bankId: 'cat-cafe-shared',
    sourceCommit: 'abc1234',
    importedAt: new Date('2026-02-14T12:00:00.000Z').toISOString(),
    sourceCount: 10,
    chunkCount: 111,
    sourcePaths: [],
  });

  assert.equal(freshness.status, 'unknown');
  assert.equal(freshness.reason, 'head_unavailable');
});

test('evaluateP0Freshness returns unknown when watermark is missing', () => {
  const freshness = evaluateP0Freshness('abc1234', null);

  assert.equal(freshness.status, 'unknown');
  assert.equal(freshness.headCommit, 'abc1234');
  assert.equal(freshness.reason, 'watermark_missing');
});
