import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  getDefaultP0FailClosedSettings,
  shouldFailClosedForFreshness,
  triggerP0ReimportIfNeeded,
} from '../dist/domains/cats/services/hindsight-import/p0-freshness-guard.js';

function createFreshness(status, reason = undefined) {
  return {
    status,
    checkedAt: new Date('2026-02-14T12:00:00.000Z').toISOString(),
    ...(reason ? { reason } : {}),
  };
}

test('shouldFailClosedForFreshness only blocks stale by default', () => {
  assert.equal(shouldFailClosedForFreshness(createFreshness('fresh')), false);
  assert.equal(shouldFailClosedForFreshness(createFreshness('unknown', 'watermark_missing')), false);
  assert.equal(shouldFailClosedForFreshness(createFreshness('stale', 'commit_mismatch')), true);
});

test('triggerP0ReimportIfNeeded triggers command when stale commit mismatch', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'cat-cafe-freshness-guard-'));
  const commands = [];
  const now = new Date('2026-02-14T13:00:00.000Z');

  const result = await triggerP0ReimportIfNeeded({
    freshness: createFreshness('stale', 'commit_mismatch'),
    repoRoot,
    now: () => now,
    statePath: 'tmp/reimport-state.json',
    runCommand: (command, cwd) => {
      commands.push({ command, cwd });
    },
    settings: {
      enabled: true,
      cooldownMs: 10 * 60 * 1000,
      command: 'pnpm --filter @cat-cafe/api hindsight:import:p0 -- --all',
    },
  });

  assert.equal(result.status, 'triggered');
  assert.equal(commands.length, 1);
  assert.equal(commands[0].cwd, repoRoot);
});

test('triggerP0ReimportIfNeeded respects cooldown window', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'cat-cafe-freshness-guard-cooldown-'));
  let commandCount = 0;
  const statePath = 'tmp/reimport-state.json';

  await triggerP0ReimportIfNeeded({
    freshness: createFreshness('stale', 'commit_mismatch'),
    repoRoot,
    now: () => new Date('2026-02-14T13:00:00.000Z'),
    statePath,
    runCommand: () => {
      commandCount += 1;
    },
    settings: {
      enabled: true,
      cooldownMs: 10 * 60 * 1000,
      command: 'pnpm --filter @cat-cafe/api hindsight:import:p0 -- --all',
    },
  });

  const second = await triggerP0ReimportIfNeeded({
    freshness: createFreshness('stale', 'commit_mismatch'),
    repoRoot,
    now: () => new Date('2026-02-14T13:05:00.000Z'),
    statePath,
    runCommand: () => {
      commandCount += 1;
    },
    settings: {
      enabled: true,
      cooldownMs: 10 * 60 * 1000,
      command: 'pnpm --filter @cat-cafe/api hindsight:import:p0 -- --all',
    },
  });

  assert.equal(second.status, 'cooldown');
  assert.equal(commandCount, 1);
});

test('triggerP0ReimportIfNeeded returns disabled when auto trigger is off', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'cat-cafe-freshness-guard-disabled-'));

  const result = await triggerP0ReimportIfNeeded({
    freshness: createFreshness('stale', 'commit_mismatch'),
    repoRoot,
    settings: {
      enabled: false,
      cooldownMs: 10 * 60 * 1000,
      command: 'pnpm --filter @cat-cafe/api hindsight:import:p0 -- --all',
    },
  });

  assert.equal(result.status, 'disabled');
});

test('getDefaultP0FailClosedSettings deduplicates status list from env', () => {
  const prevStatuses = process.env.HINDSIGHT_P0_FAIL_CLOSED_STATUSES;
  process.env.HINDSIGHT_P0_FAIL_CLOSED_STATUSES = 'stale,unknown,stale';

  const settings = getDefaultP0FailClosedSettings(process.env);

  if (prevStatuses === undefined) delete process.env.HINDSIGHT_P0_FAIL_CLOSED_STATUSES;
  else process.env.HINDSIGHT_P0_FAIL_CLOSED_STATUSES = prevStatuses;

  assert.deepEqual(settings.statuses, ['stale', 'unknown']);
});
