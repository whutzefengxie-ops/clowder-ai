import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HostInventoryControlPlane, MemoryPluginInventoryStore } from '../dist/domains/plugin/index.js';
import { prepareInitialPluginInstallation } from '../dist/domains/plugin/manager/initial-plugin-installation.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'offline-initial-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inventory = new MemoryPluginInventoryStore();
  const control = new HostInventoryControlPlane(inventory);
  const entries = ['first', 'second'].map((id) => ({
    catalogId: id,
    pluginId: `test.${id}`,
    version: '1.0.0',
    packageDigest: `sha512-${Buffer.alloc(64, id.length).toString('base64')}`,
  }));
  const installed = [],
    activated = [],
    failures = [];
  let failSecond = false;
  let networkReads = 0;
  const options = {
    statePath: join(root, 'initial.json'),
    inventory,
    catalog: {
      snapshot: async () => {
        networkReads++;
        throw new Error('network must not be consulted');
      },
    },
    loadReleases: async () => entries,
    loadSelection: async () => ({
      schemaVersion: 1,
      plugins: entries.map((entry) => ({ pluginId: entry.pluginId, enabled: true })),
    }),
    installer: {
      install: async (id, release) => {
        const entry = entries.find((entry) => entry.catalogId === id);
        assert.deepEqual(release, { version: entry.version, packageDigest: entry.packageDigest });
        if (id === 'second' && failSecond) throw new Error('archive temporarily unavailable');
        installed.push(id);
        return control.installPackage({
          manifest: {
            pluginId: entry.pluginId,
            version: entry.version,
            contractVersion: '0.1.0',
            name: id,
            features: [{ id: 'core', name: 'Core', resources: [] }],
          },
          computedPackageDigest: entry.packageDigest,
          expectedPackageDigest: entry.packageDigest,
          packagePluginId: entry.pluginId,
        });
      },
    },
    activate: async (pluginId, instanceId) => {
      activated.push([pluginId, instanceId]);
    },
    onFailure: (pluginId, error) => {
      failures.push([pluginId, String(error)]);
    },
  };
  return {
    options,
    inventory,
    installed,
    activated,
    failures,
    networkReads: () => networkReads,
    failSecond: (value) => {
      failSecond = value;
    },
    journal: async () => JSON.parse(await readFile(options.statePath, 'utf8')),
  };
}

test('offline first start uses pinned local releases and the existing deferred activation journal without a catalog read', async (t) => {
  const f = await fixture(t);
  const ready = await prepareInitialPluginInstallation(f.options);
  assert.deepEqual(f.installed, ['first', 'second']);
  assert.equal(f.networkReads(), 0);
  assert.equal(f.activated.length, 0);
  await ready.activate();
  assert.equal(f.activated.length, 2);
  assert.equal(f.networkReads(), 0);
  assert.ok((await f.journal()).plugins.every((entry) => entry.done));
});

test('offline partial failure retries only the unfinished package and owner uninstall intent still wins', async (t) => {
  const f = await fixture(t);
  f.failSecond(true);
  await (await prepareInitialPluginInstallation(f.options)).activate();
  assert.deepEqual(f.installed, ['first']);
  assert.equal(f.failures.length, 1);
  f.failSecond(false);
  await (await prepareInitialPluginInstallation(f.options)).activate();
  assert.deepEqual(f.installed, ['first', 'second']);
  const journal = await f.journal();
  assert.ok(journal.plugins.every((entry) => entry.done));
  await f.inventory.transaction((tx) =>
    tx.instances
      .list()
      .forEach((instance) => tx.instances.put({ ...instance, lifecycleState: 'retired', retiredAt: Date.now() })),
  );
  await (await prepareInitialPluginInstallation(f.options)).activate();
  assert.deepEqual(f.installed, ['first', 'second']);
  assert.equal(f.networkReads(), 0);
});

test('an offline default cannot override a lifecycle change between preparation and activation', async (t) => {
  const f = await fixture(t);
  const ready = await prepareInitialPluginInstallation(f.options);
  await f.inventory.transaction((tx) => {
    const first = tx.instances.list()[0];
    tx.instances.put({ ...first, lifecycleRevision: first.lifecycleRevision + 1 });
  });
  await ready.activate();
  assert.deepEqual(
    f.activated.map(([id]) => id),
    ['test.second'],
  );
  assert.equal(f.networkReads(), 0);
});
