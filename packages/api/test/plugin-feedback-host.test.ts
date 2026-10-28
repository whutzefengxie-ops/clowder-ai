import assert from 'node:assert/strict';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { CliRawArchive } from '../src/domains/cats/services/session/CliRawArchive.js';
import {
  currentPluginOwnerRequestContext,
  withPluginOwnerRequest,
  withPluginOwnerWebhook,
} from '../src/domains/plugin/carrier/plugin-owner-request-context.js';
import type { PluginRuntimeAdmission } from '../src/domains/plugin/carrier/runtime-carrier.js';
import { DeclaredPluginUi } from '../src/domains/plugin/declared/declared-plugin-ui.js';
import { diagnosticDestination } from '../src/domains/plugin/host-surface/plugin-diagnostic-destination.js';
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

async function asOwner<T>(run: () => Promise<T>): Promise<T> {
  return withPluginOwnerRequest(
    {
      pluginId: 'official.fixture',
      contributionId: 'open',
      userId: 'fixture-owner',
      operation: 'write',
      signal: new AbortController().signal,
      requestIdentity: {
        requestId: 'fixture-request',
        transportRequestId: 'fixture',
        method: 'POST',
        declaredPath: '/ui',
        path: '/ui',
        bodyDigest: 'fixture',
        queryDigest: 'fixture',
      },
    },
    () => withPluginOwnerWebhook('official.fixture', 'open', 'fixture', false, () => {}, run),
  );
}

test('diagnostic confirmation names actual compatible endpoint or explicitly unknown native destination', () => {
  const result = diagnosticDestination('openai', {
    id: 'proxy',
    displayName: 'Company account',
    authType: 'api_key',
    baseUrl: 'https://compat.example.test/v1',
  });
  assert.match(result, /Company account.*https:\/\/compat.example.test/);
  const overridden = diagnosticDestination(
    'openai',
    { id: 'proxy', authType: 'api_key' },
    { OPENAI_BASE_URL: 'https://user:secret@other.example.test/v1?token=secret' },
  );
  assert.match(overridden, /https:\/\/other.example.test/);
  assert.ok(!overridden.includes('secret'));
  assert.match(diagnosticDestination('anthropic', null), /目的地未知/);
});

test('diagnosis uses the real raw-archive ID boundary and rejects changed destination consent', async () => {
  let revision = 'first';
  let calls = 0;
  const port = createPluginDiagnosticsHost(
    'fixture',
    {
      projectRoot: () => '/not-read',
      clients: () => [
        {
          id: 'configured',
          label: 'configured',
          provider: 'compatible protocol',
          model: 'fixture',
          destination: 'https://compat.example.test',
          revision,
          options: {},
          service: {
            supportsFeedbackDiagnostics: () => true,
            async *invoke(_prompt, options) {
              calls++;
              assert.ok(options?.invocationId);
              new CliRawArchive().getPath(options.invocationId);
              yield { type: 'text', catId: 'fixture', content: 'bounded report', timestamp: Date.now() };
              yield { type: 'done', catId: 'fixture', timestamp: Date.now() };
            },
          },
        },
      ],
    },
    async () => {},
  );
  const input = {
    clientId: 'configured',
    clientRevision: 'first',
    prompt: 'sanitized',
    instructions: 'recipe',
    signal: new AbortController().signal,
  };
  assert.equal(await asOwner(() => port.analyze(input)), 'bounded report');
  revision = 'changed';
  await assert.rejects(
    asOwner(() => port.analyze(input)),
    /目的地.*变化/,
  );
  assert.equal(calls, 1);
});

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
    port.analyze({
      clientId: 'forged',
      clientRevision: 'forged',
      prompt: 'x',
      instructions: 'x',
      signal: new AbortController().signal,
    }),
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
