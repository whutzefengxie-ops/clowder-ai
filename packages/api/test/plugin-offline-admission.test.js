import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MessageStore } from '../dist/domains/cats/services/stores/ports/MessageStore.js';
import {
  createDormantPluginRuntimeComposition,
  createPluginManagerRuntimeComposition,
} from '../dist/domains/plugin/index.js';
import {
  prepareOfflineHostInitialPlugins,
  resolveOfflinePluginBundlePath,
} from '../dist/domains/plugin/manager/offline-plugin-bundle.js';

test('explicit offline path overrides edition data; relative explicit input cannot silently switch to public discovery', () => {
  const root = join(tmpdir(), 'runtime');
  const own = join(tmpdir(), 'own-bundle.json');
  assert.equal(resolveOfflinePluginBundlePath(own, 'offline/bundle.json', root), own);
  assert.equal(
    resolveOfflinePluginBundlePath(undefined, 'offline/bundle.json', root),
    join(root, 'offline/bundle.json'),
  );
  assert.equal(resolveOfflinePluginBundlePath(undefined, undefined, root), undefined);
  assert.throws(() => resolveOfflinePluginBundlePath('', 'offline/bundle.json', root));
  assert.throws(() => resolveOfflinePluginBundlePath('missing.json', undefined, root));
});

test('production offline admission verifies digest and package identity before inventory, retries and preserves owner intent', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'offline-admission-'));
  const runtime = createDormantPluginRuntimeComposition({
    projectRoot: join(root, 'project'),
    messageStore: new MessageStore(),
  });
  t.after(async () => {
    await runtime.shutdown('test_complete');
    await rm(root, { recursive: true, force: true });
  });
  let network = 0;
  const managerRuntime = createPluginManagerRuntimeComposition({
    runtime,
    catalogManifests: [],
    catalogProvider: {
      snapshot: async () => {
        network++;
        throw new Error('unexpected network');
      },
    },
  });
  const pkg = join(root, 'package');
  await mkdir(pkg);
  await writeFile(
    join(pkg, 'manifest.json'),
    JSON.stringify({
      pluginId: 'test.offline',
      version: '1.0.0',
      contractVersion: '0.1.0',
      name: 'Offline fixture',
      features: [{ id: 'core', name: 'Core', resources: [] }],
    }),
  );
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@test/offline', version: '1.0.0' }));
  const archive = join(root, 'plugin.tgz');
  execFileSync('tar', ['-czf', archive, '-C', root, 'package'], { windowsHide: true });
  const bytes = await readFile(archive);
  const digest = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const entry = {
    pluginId: 'test.offline',
    version: '1.0.0',
    packageName: '@test/offline',
    packageDigest: digest,
    archive: 'plugin.tgz',
    enabled: true,
  };
  const bundlePath = join(root, 'bundle.json');
  const writeBundle = (patch = {}) =>
    writeFile(bundlePath, JSON.stringify({ schemaVersion: 1, plugins: [{ ...entry, ...patch }] }));
  const failures = [];
  const prepare = () =>
    prepareOfflineHostInitialPlugins({
      bundlePath,
      runtime,
      managerRuntime,
      onFailure: (_id, error) => failures.push(error),
    });
  await writeBundle({ packageName: '@test/wrong' });
  await (await prepare()).activate();
  assert.equal((await runtime.inventoryStore.snapshot()).instances.length, 0);
  assert.equal(failures.length, 1);
  assert.match(failures[0].message, /identity|match/i);
  await writeBundle({ version: '2.0.0' });
  await (await prepare()).activate();
  assert.equal((await runtime.inventoryStore.snapshot()).instances.length, 0);
  assert.match(failures.at(-1).message, /journal-pinned/);
  await writeBundle();
  await writeFile(archive, Buffer.from('corrupted archive'));
  await (await prepare()).activate();
  assert.equal((await runtime.inventoryStore.snapshot()).instances.length, 0);
  assert.equal(failures.length, 3);
  assert.equal(failures.at(-1).code, 'PACKAGE_DIGEST_MISMATCH');
  await writeFile(archive, bytes);
  await (await prepare()).activate();
  const plugin = (await managerRuntime.manager.getLocal(entry.pluginId)).plugin;
  assert.equal(plugin.intent, 'enabled');
  await managerRuntime.manager.setEnabled(entry.pluginId, {
    enabled: false,
    expectedRevision: plugin.lifecycleRevision,
  });
  await (await prepare()).activate();
  assert.equal((await managerRuntime.manager.getLocal(entry.pluginId)).plugin.intent, 'disabled');
  await managerRuntime.manager.uninstall(entry.pluginId, {
    expectedRevision: (await managerRuntime.manager.getLocal(entry.pluginId)).plugin.lifecycleRevision,
  });
  await (await prepare()).activate();
  assert.ok((await runtime.inventoryStore.snapshot()).instances.every((i) => i.lifecycleState === 'retired'));
  assert.equal(network, 0);
  await assert.rejects(
    prepareOfflineHostInitialPlugins({
      bundlePath: join(root, 'missing.json'),
      runtime,
      managerRuntime,
      onFailure() {},
    }),
    { code: 'ENOENT' },
  );
  assert.equal(network, 0);
});
