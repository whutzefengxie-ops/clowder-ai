import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { MessageStore } from '../dist/domains/cats/services/stores/ports/MessageStore.js';
import { PLUGIN_HOST_ENTRIES } from '../dist/domains/plugin/host-inventory/plugin-host-layout.js';
import {
  createDormantPluginRuntimeComposition,
  createPluginManagerRuntimeComposition,
  FilesystemBuiltinPluginPackageMaterializer,
} from '../dist/domains/plugin/index.js';
import { prepareInitialPluginInstallation } from '../dist/domains/plugin/manager/initial-plugin-installation.js';
import { prepareOfflineHostInitialPlugins } from '../dist/domains/plugin/manager/offline-plugin-bundle.js';

async function fixture(t, shipped = false) {
  const root = await mkdtemp(join(tmpdir(), 'offline-closure-'));
  const pkg = join(root, 'package');
  await mkdir(join(pkg, 'dist'), { recursive: true });
  const manifest = {
    pluginId: 'test.offline-deps',
    version: '1.0.0',
    contractVersion: '0.1.0',
    name: 'Offline dependency fixture',
    features: [{ id: 'core', name: 'Core', resources: [] }],
    runtime: { transport: 'builtin', entrypoint: 'dist/entrypoint.js' },
  };
  const dependencies = { 'example-dep': '1.0.0' };
  const metadata = { name: '@test/offline-deps', version: '1.0.0', type: 'module', dependencies };
  await writeFile(join(pkg, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(pkg, 'package.json'), JSON.stringify(metadata));
  await writeFile(
    join(pkg, 'dist/entrypoint.js'),
    "import 'example-dep'; export default {create(){return {start(){return {actions:{},stop(){}}}}}}",
  );
  await writeFile(
    join(pkg, 'npm-shrinkwrap.json'),
    JSON.stringify({
      name: metadata.name,
      version: metadata.version,
      lockfileVersion: 3,
      packages: {
        '': metadata,
        'node_modules/example-dep': {
          version: '1.0.0',
          resolved: 'https://registry.npmjs.org/example-dep/-/example-dep-1.0.0.tgz',
          integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
        },
      },
    }),
  );
  if (shipped) {
    await mkdir(join(pkg, 'node_modules/example-dep'), { recursive: true });
    await writeFile(
      join(pkg, 'node_modules/example-dep/package.json'),
      '{"name":"example-dep","version":"1.0.0","main":"index.js"}',
    );
    await writeFile(join(pkg, 'node_modules/example-dep/index.js'), 'module.exports = {};');
  }
  const archive = join(root, 'plugin.tgz');
  execFileSync('tar', ['-czf', archive, '-C', root, 'package'], { windowsHide: true });
  const entry = {
    pluginId: manifest.pluginId,
    version: metadata.version,
    packageName: metadata.name,
    packageDigest: `sha512-${createHash('sha512')
      .update(await readFile(archive))
      .digest('base64')}`,
    archive: 'plugin.tgz',
    enabled: true,
  };
  const bundlePath = join(root, 'bundle.json');
  await writeFile(bundlePath, JSON.stringify({ schemaVersion: 1, plugins: [entry] }));
  let installs = 0,
    catalogReads = 0;
  const runtimes = [];
  const makeHost = () => {
    let materializer;
    const runtime = createDormantPluginRuntimeComposition({
      projectRoot: join(root, 'project'),
      messageStore: new MessageStore(),
      builtinPackages: { resolve: (input) => materializer.resolve(input) },
    });
    materializer = new FilesystemBuiltinPluginPackageMaterializer({
      packagesRoot: runtime.paths.packagesRoot,
      installDependencies: async () => {
        installs++;
        throw new Error('registry install intercepted');
      },
    });
    const managerRuntime = createPluginManagerRuntimeComposition({
      runtime,
      catalogManifests: [],
      catalogProvider: {
        snapshot: async () => {
          catalogReads++;
          throw new Error('catalog intercepted');
        },
      },
    });
    runtimes.push(runtime);
    return { runtime, managerRuntime };
  };
  const { runtime, managerRuntime } = makeHost();
  t.after(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.shutdown('test_complete')));
    await rm(root, { recursive: true, force: true });
  });
  const failures = [];
  const options = { bundlePath, runtime, managerRuntime, onFailure: (_id, error) => failures.push(error) };
  return { entry, archive, options, failures, makeHost, installs: () => installs, catalogReads: () => catalogReads };
}

test('offline package lacking shipped runtime dependencies is rejected before inventory and never installs from registry', async (t) => {
  const f = await fixture(t);
  await (await prepareOfflineHostInitialPlugins(f.options)).activate();
  assert.equal((await f.options.runtime.inventoryStore.snapshot()).instances.length, 0);
  assert.equal(f.installs(), 0);
  assert.match(f.failures[0].message, /offline.*dependenc|shipped.*dependenc/i);
});

test('an already prepared receipt still cannot trigger a registry install after offline startup resumes', async (t) => {
  const f = await fixture(t);
  const { runtime, managerRuntime } = f.options;
  // Simulate a previous admission interrupted before activation, through the real journal writer.
  await prepareInitialPluginInstallation({
    statePath: join(dirname(runtime.paths.inventorySnapshotPath), PLUGIN_HOST_ENTRIES.initialInstallation),
    inventory: runtime.inventoryStore,
    loadSelection: async () => ({ schemaVersion: 1, plugins: [f.entry] }),
    loadReleases: async () => [{ ...f.entry, catalogId: f.entry.pluginId }],
    installer: { install: () => managerRuntime.localAdmission.install({ kind: 'local-archive', path: f.archive }) },
    reconcile: (id, instance) => managerRuntime.configuration.reconcile(id, instance),
    activate: async () => {},
    onFailure: (_id, error) => {
      throw error;
    },
  });
  await (await prepareOfflineHostInitialPlugins(f.options)).activate();
  assert.equal(f.installs(), 0);
  assert.equal(f.catalogReads(), 0);
  assert.match(f.failures[0].message, /offline.*dependenc|shipped.*dependenc/i);
});

test('a shipped dependency executes through offline activation and restart without a registry install', async (t) => {
  const f = await fixture(t, true);
  await (await prepareOfflineHostInitialPlugins(f.options)).activate();
  const { runtime, managerRuntime } = f.options;
  assert.equal((await managerRuntime.manager.getLocal(f.entry.pluginId)).plugin.intent, 'enabled');
  assert.equal(f.failures.length, 0);
  await runtime.shutdown('test_restart');
  const restarted = f.makeHost();
  await restarted.runtime.recoverAfterRestart();
  await restarted.runtime.lifecycle.drainRestartRecovery();
  const recovered = (await restarted.managerRuntime.manager.getLocal(f.entry.pluginId)).plugin;
  assert.equal(recovered.intent, 'enabled');
  assert.equal((await restarted.runtime.inventoryStore.snapshot()).instances[0].runtimeState, 'healthy');
  assert.equal(f.installs(), 0);
  assert.equal(f.catalogReads(), 0);
});
