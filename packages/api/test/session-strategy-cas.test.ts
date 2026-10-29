/**
 * S2 (W1 save CAS): session-strategy route revision enforcement.
 *
 * Formal writers (`x-clowder-formal-edit: 1`) must carry the revision they read;
 * legacy writers without the marker keep the transitional blind-write behavior.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { catRegistry } from '@cat-cafe/shared';
import Fastify from 'fastify';
import { loadCatConfig, toAllCatConfigs } from '../src/config/cat-config-loader.js';
import { _clearRuntimeOverrides, getRuntimeOverride } from '../src/config/session-strategy-overrides.js';
import { sessionStrategyConfigRoutes } from '../src/routes/session-strategy-config.js';

const USER_HEADER = { 'x-cat-cafe-user': 'test-user' };
const FORMAL_HEADER = { ...USER_HEADER, 'x-clowder-formal-edit': '1' };

const AVAILABLE_CAPABILITY = {
  provider: 'test',
  carrier: 'test',
  reportsRuntimeWindow: true,
  authoritativeUsage: true,
  usageTelemetry: 'available',
  nativeWindowControl: false,
  nativeCompressionControl: true,
  observesCompression: true,
  reason: 'test capability',
};

function makeTemplate() {
  return {
    version: 2,
    breeds: [
      {
        id: 'ragdoll',
        catId: 'opus',
        name: '布偶猫',
        displayName: '布偶猫',
        avatar: '/avatars/opus.png',
        color: { primary: '#9B7EBD', secondary: '#E8DFF5' },
        mentionPatterns: ['@opus'],
        roleDescription: '架构师',
        defaultVariantId: 'opus-default',
        variants: [
          {
            id: 'opus-default',
            clientId: 'anthropic',
            defaultModel: 'claude-sonnet-4-5-20250929',
            mcpSupport: true,
            cli: { command: 'claude', outputFormat: 'stream-json' },
          },
        ],
      },
      {
        id: 'codex',
        catId: 'codex',
        name: '缅因猫',
        displayName: '缅因猫',
        avatar: '/avatars/codex.png',
        color: { primary: '#123456', secondary: '#abcdef' },
        mentionPatterns: ['@codex'],
        roleDescription: '审查',
        defaultVariantId: 'codex-default',
        variants: [
          {
            id: 'codex-default',
            clientId: 'openai',
            defaultModel: 'gpt-5.4',
            mcpSupport: true,
            cli: { command: 'codex', outputFormat: 'json' },
          },
        ],
      },
    ],
    roster: {
      opus: { family: 'ragdoll', roles: ['architect'], lead: true, available: true, evaluation: 'primary' },
      codex: { family: 'codex', roles: ['review'], lead: false, available: true, evaluation: 'secondary' },
    },
    reviewPolicy: {
      requireDifferentFamily: true,
      preferActiveInThread: true,
      preferLead: true,
      excludeUnavailable: true,
    },
  };
}

async function setup() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'session-strategy-cas-'));
  const templatePath = join(projectRoot, 'cat-template.json');
  writeFileSync(templatePath, JSON.stringify(makeTemplate(), null, 2));
  process.env.CAT_TEMPLATE_PATH = templatePath;
  catRegistry.reset();
  for (const [id, config] of Object.entries(toAllCatConfigs(loadCatConfig(templatePath)))) {
    catRegistry.register(id, config);
  }
  const app = Fastify();
  await app.register(sessionStrategyConfigRoutes, {
    resolveContextCapability: () => AVAILABLE_CAPABILITY,
  });
  return app;
}

async function readRevision(app: ReturnType<typeof Fastify>): Promise<string> {
  const response = await app.inject({ method: 'GET', url: '/api/config/session-strategy/opus' });
  assert.equal(response.statusCode, 200);
  return response.json().revision;
}

describe('GET /api/config/session-strategy/:catId', () => {
  it('returns the same entry/revision as the list read, and 404 for unknown cats', async () => {
    const app = await setup();
    const list = await app.inject({ method: 'GET', url: '/api/config/session-strategy' });
    const listEntry = list.json().cats.find((cat: { catId: string }) => cat.catId === 'opus');
    const single = await app.inject({ method: 'GET', url: '/api/config/session-strategy/opus' });
    assert.equal(single.statusCode, 200, single.payload);
    assert.equal(single.json().revision, listEntry.revision);
    assert.equal(single.json().effective.strategy, listEntry.effective.strategy);
    assert.equal(single.json().catId, 'opus');
    const missing = await app.inject({ method: 'GET', url: '/api/config/session-strategy/unknown-cat' });
    assert.equal(missing.statusCode, 404, missing.payload);
    await app.close();
  });
});

describe('PATCH /api/config/session-strategy/:catId CAS', () => {
  let app: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    _clearRuntimeOverrides();
    app = await setup();
  });

  afterEach(async () => {
    await app.close();
    _clearRuntimeOverrides();
  });

  it('GET returns a stable revision for an unchanged strategy', async () => {
    const first = await readRevision(app);
    const second = await readRevision(app);
    assert.equal(typeof first, 'string');
    assert.equal(second, first);
  });

  it('formal write without expectedRevision returns 428 and does not write', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/config/session-strategy/opus',
      headers: FORMAL_HEADER,
      payload: { strategy: 'compress' },
    });
    assert.equal(response.statusCode, 428, response.payload);
    assert.equal(response.json().code, 'session_strategy_revision_required');
    assert.equal(getRuntimeOverride('opus'), undefined);
  });

  it('stale expectedRevision returns 409 with the current revision and effective config, and does not write', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/config/session-strategy/opus',
      headers: FORMAL_HEADER,
      payload: { strategy: 'compress', expectedRevision: 'stale-revision' },
    });
    assert.equal(response.statusCode, 409, response.payload);
    const body = response.json();
    assert.equal(body.code, 'session_strategy_revision_conflict');
    assert.equal(body.revision, await readRevision(app));
    assert.equal(body.effective.strategy, 'handoff');
    assert.equal(getRuntimeOverride('opus'), undefined);
  });

  it('matching expectedRevision writes the override and returns a new revision', async () => {
    const revision = await readRevision(app);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/config/session-strategy/opus',
      headers: FORMAL_HEADER,
      payload: { strategy: 'compress', expectedRevision: revision },
    });
    assert.equal(response.statusCode, 200, response.payload);
    const body = response.json();
    assert.equal(body.effective.strategy, 'compress');
    assert.notEqual(body.revision, revision);
    assert.equal(body.revision, await readRevision(app));
    assert.equal(body.override.strategy, 'compress');
    // The CAS precondition must never leak into the persisted override.
    assert.equal('expectedRevision' in body.override, false);
    assert.equal(getRuntimeOverride('opus')?.strategy, 'compress');
  });

  it('rejects a non-string expectedRevision with 400', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/config/session-strategy/opus',
      headers: FORMAL_HEADER,
      payload: { strategy: 'compress', expectedRevision: 42 },
    });
    assert.equal(response.statusCode, 400, response.payload);
    assert.match(response.json().error, /expectedRevision/);
  });

  it('legacy writers without the formal header still blind-write (transitional compatibility)', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/config/session-strategy/opus',
      headers: USER_HEADER,
      payload: { strategy: 'compress' },
    });
    assert.equal(response.statusCode, 200, response.payload);
    assert.equal(response.json().effective.strategy, 'compress');
    assert.equal(getRuntimeOverride('opus')?.strategy, 'compress');
  });

  it('a stale writer without the formal header cannot do more than blind-write (documented transitional risk)', async () => {
    // Precondition: legacy writers were never required to hold a revision, so this
    // change intentionally preserves their old behavior. The formal UI is the one
    // that gets 428/409 enforcement.
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/config/session-strategy/opus',
      headers: USER_HEADER,
      payload: { strategy: 'handoff', expectedRevision: 'stale-revision' },
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, 'session_strategy_revision_conflict');
  });
});
