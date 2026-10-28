import assert from 'node:assert/strict';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { currentPluginOwnerRequestContext } from '../src/domains/plugin/carrier/plugin-owner-request-context.js';
import type { PluginRuntimeAdmission } from '../src/domains/plugin/carrier/runtime-carrier.js';
import { DeclaredPluginUi } from '../src/domains/plugin/declared/declared-plugin-ui.js';
import { collectDiagnosticLogs } from '../src/domains/plugin/host-surface/plugin-diagnostic-logs.js';
import { createPluginDiagnosticsHost } from '../src/domains/plugin/host-surface/plugin-diagnostics.js';
import { pluginUiRoutes } from '../src/routes/plugin/plugin-ui-routes.js';

const admission = {
  instance: { pluginInstanceId: 'fixture' },
  packageRecord: {
    pluginId: 'official.fixture',
    manifest: {
      contributions: [
        { type: 'ui', id: 'open', kind: 'command', action: { method: 'panel' } },
        {
          type: 'ui',
          id: 'entry',
          kind: 'slot-item',
          label: '问题反馈',
          command: 'open',
          group: 'activity-bar.bottom',
        },
        { type: 'ui', id: 'unrelated', kind: 'slot-item', label: 'Other', command: 'open', group: 'composer.actions' },
      ],
    },
  },
} as unknown as PluginRuntimeAdmission;

test('installed UI dispatch derives owner facts, rejects anonymous/stale calls and fences retained authority', async () => {
  let retained: ReturnType<typeof currentPluginOwnerRequestContext>;
  let calls = 0;
  const ui = new DeclaredPluginUi(async (id, method) => {
    calls++;
    retained = currentPluginOwnerRequestContext(id);
    assert.equal(method, 'panel');
    assert.equal(retained?.userId, 'fixture-owner');
    return { html: '<p>panel</p>' };
  });
  ui.activate(admission);
  const generation = ui.list()[0]!.generation;
  assert.equal(ui.list().length, 1);
  await assert.rejects(ui.call('fixture', 'open', generation, {}), /owner request/);
  const app = Fastify();
  app.decorateRequest('sessionUserId', undefined);
  app.addHook('onRequest', async (request) => {
    if (request.headers['x-fixture-owner']) request.sessionUserId = 'fixture-owner';
  });
  await app.register(pluginUiRoutes, { ui });
  try {
    const url = '/api/plugin-ui/fixture/open';
    const payload = { generation, input: { op: 'open', userId: 'forged' } };
    assert.ok([401, 403].includes((await app.inject({ method: 'POST', url, payload })).statusCode));
    const result = await app.inject({
      method: 'POST',
      url,
      payload,
      headers: { 'x-fixture-owner': 'yes', origin: 'http://localhost:5173' },
    });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(calls, 1);
    await assert.rejects(retained!.assertCurrent(), /no longer current/);
    ui.deactivate('fixture');
    assert.deepEqual(ui.list(), []);
    ui.activate(admission);
    const stale = await app.inject({
      method: 'POST',
      url,
      payload,
      headers: { 'x-fixture-owner': 'yes', origin: 'http://localhost:5173' },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(calls, 1);
  } finally {
    await app.close();
  }
});

test('diagnostics are inaccessible outside an owner HTTP activation', async () => {
  const port = createPluginDiagnosticsHost(
    'fixture',
    { projectRoot: () => '/not-read', clients: () => [] },
    async () => {},
  );
  await assert.rejects(port.describe(), /用户在插件面板/);
  await assert.rejects(port.collect(), /用户在插件面板/);
  await assert.rejects(
    port.analyze({ clientId: 'forged', prompt: 'x', instructions: 'x', signal: new AbortController().signal }),
    /用户在插件面板/,
  );
});

test('collector excludes old/info/non-JSON logs and unselected credential/history files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'feedback-logs-test-'));
  const now = Date.now();
  const selected = join(root, 'api.log');
  const secret = join(root, 'auth.json');
  await writeFile(
    selected,
    [
      { time: now - 1000, level: 50, msg: 'timeout', err: { code: 'E_TIMEOUT', stack: 'private-stack-canary' } },
      { time: now - 1000, level: 30, msg: 'info-canary' },
      { time: now - 3600000, level: 50, msg: 'old-canary' },
    ]
      .map((v) => JSON.stringify(v))
      .join('\n') + '\nraw-auth-canary',
  );
  await writeFile(secret, 'credential-file-canary');
  try {
    const result = await collectDiagnosticLogs(root, now);
    assert.match(result, /E_TIMEOUT/);
    for (const value of [
      'private-stack-canary',
      'info-canary',
      'old-canary',
      'raw-auth-canary',
      'credential-file-canary',
    ])
      assert.ok(!result.includes(value));
  } finally {
    await unlink(selected);
    await unlink(secret);
    await rmdir(root);
  }
});
