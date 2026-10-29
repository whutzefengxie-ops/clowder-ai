/**
 * S3 (W1 save CAS): global client-settings revisions on GET /api/config and
 * expectedRevision enforcement on PATCH /api/config.
 *
 * Formal writers (`x-clowder-formal-edit: 1`) must carry the revision they read;
 * legacy writers without the marker keep the transitional blind-write behavior.
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import Fastify from 'fastify';
import { configStore } from '../src/config/ConfigStore.js';
import { configRoutes } from '../src/routes/config.js';

const USER_HEADER = { 'x-cat-cafe-user': 'config-admin' };
const FORMAL_HEADER = { ...USER_HEADER, 'x-clowder-formal-edit': '1' };
const MEMBER_EDITOR_KEYS = ['cli.codexSandboxMode', 'cli.codexApprovalPolicy', 'codex.execution.authMode'];

type App = ReturnType<typeof Fastify>;

describe('GET/PATCH /api/config write revisions', () => {
  let app: App | undefined;

  afterEach(async () => {
    configStore.reset();
    await app?.close();
    app = undefined;
  });

  async function setup(): Promise<App> {
    const projectRoot = mkdtempSync(join(tmpdir(), 'config-cas-'));
    app = Fastify();
    await app.register(configRoutes, { projectRoot });
    await app.ready();
    return app;
  }

  async function readConfig(): Promise<{ config: Record<string, unknown>; writeRevisions: Record<string, string> }> {
    assert.ok(app);
    const response = await app.inject({ method: 'GET', url: '/api/config' });
    assert.equal(response.statusCode, 200, response.payload);
    return response.json();
  }

  async function patch(payload: Record<string, unknown>, headers: Record<string, string> = USER_HEADER) {
    assert.ok(app);
    return app.inject({ method: 'PATCH', url: '/api/config', headers, payload });
  }

  it('GET returns a stable write revision per member-editor key', async () => {
    const current = await setup();
    const first = await readConfig();
    assert.deepEqual(Object.keys(first.writeRevisions).sort(), [...MEMBER_EDITOR_KEYS].sort());
    for (const key of MEMBER_EDITOR_KEYS) assert.equal(typeof first.writeRevisions[key], 'string');
    const second = await readConfig();
    assert.deepEqual(second.writeRevisions, first.writeRevisions);
    assert.equal(typeof current, 'object');
  });

  it('formal write without expectedRevision returns 428 and does not write', async () => {
    await setup();
    const before = await readConfig();
    const response = await patch({ key: 'cli.codexSandboxMode', value: 'danger-full-access' }, FORMAL_HEADER);
    assert.equal(response.statusCode, 428, response.payload);
    assert.equal(response.json().code, 'config_revision_required');
    const after = await readConfig();
    assert.deepEqual(after.config.cli, before.config.cli);
  });

  it('stale expectedRevision returns 409 with the current revision and does not write', async () => {
    await setup();
    const before = await readConfig();
    const response = await patch(
      { key: 'cli.codexSandboxMode', value: 'danger-full-access', expectedRevision: 'stale-revision' },
      FORMAL_HEADER,
    );
    assert.equal(response.statusCode, 409, response.payload);
    const body = response.json();
    assert.equal(body.code, 'config_revision_conflict');
    assert.equal(body.revision, before.writeRevisions['cli.codexSandboxMode']);
    const after = await readConfig();
    assert.deepEqual(after.config.cli, before.config.cli);
  });

  it('matching expectedRevision writes the value and returns the new revision', async () => {
    await setup();
    const before = await readConfig();
    const beforeValue = before.config.cli as { codexSandboxMode: string };
    const target = beforeValue.codexSandboxMode === 'danger-full-access' ? 'workspace-write' : 'danger-full-access';
    const response = await patch(
      {
        key: 'cli.codexSandboxMode',
        value: target,
        expectedRevision: before.writeRevisions['cli.codexSandboxMode'],
      },
      FORMAL_HEADER,
    );
    assert.equal(response.statusCode, 200, response.payload);
    const after = await readConfig();
    assert.equal(after.config.cli.codexSandboxMode, target);
    assert.equal(response.json().revision, after.writeRevisions['cli.codexSandboxMode']);
    assert.notEqual(after.writeRevisions['cli.codexSandboxMode'], before.writeRevisions['cli.codexSandboxMode']);
    // Sibling settings keep their revisions.
    assert.equal(after.writeRevisions['cli.codexApprovalPolicy'], before.writeRevisions['cli.codexApprovalPolicy']);
    assert.equal(after.writeRevisions['codex.execution.authMode'], before.writeRevisions['codex.execution.authMode']);
  });

  it('legacy writers without the formal header still blind-write (transitional compatibility)', async () => {
    await setup();
    const response = await patch({ key: 'cli.codexApprovalPolicy', value: 'never' });
    assert.equal(response.statusCode, 200, response.payload);
    const after = await readConfig();
    assert.equal(after.config.cli.codexApprovalPolicy, 'never');
  });

  it('a stale revision on the legacy path still reports a conflict instead of overwriting', async () => {
    await setup();
    const before = await readConfig();
    await patch({ key: 'cli.codexSandboxMode', value: 'workspace-write' });
    const response = await patch({
      key: 'cli.codexSandboxMode',
      value: 'danger-full-access',
      expectedRevision: before.writeRevisions['cli.codexSandboxMode'],
    });
    assert.equal(response.statusCode, 409, response.payload);
    assert.equal(response.json().code, 'config_revision_conflict');
    const after = await readConfig();
    assert.equal(after.config.cli.codexSandboxMode, 'workspace-write');
  });
});
