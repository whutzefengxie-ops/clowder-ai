import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseOfflinePluginBundle } from '../packages/api/src/domains/plugin/manager/offline-plugin-bundle-schema.ts';
import { projectDeploymentProfiles, resolveDeploymentDefaults } from '../packages/shared/src/deployment-defaults.ts';
import { prepareOfflinePluginBundle } from './prepare-offline-plugin-bundle.mjs';

const entry = {
  pluginId: 'test.offline',
  packageName: '@test/offline',
  version: '1.0.0',
  packageDigest: `sha512-${Buffer.alloc(64).toString('base64')}`,
  archive: 'one.tgz',
  enabled: true,
};
test('offline bundle rejects unbounded, duplicate, escaping or unauthorized metadata at its boundary', () => {
  assert.deepEqual(parseOfflinePluginBundle({ schemaVersion: 1, plugins: [entry] }).plugins, [entry]);
  const values = [
    { ...entry, archive: '../escape.tgz' },
    { ...entry, archive: 'D:/escape.tgz' },
    { ...entry, packageDigest: `sha512-${'A'.repeat(85)}B==` },
    { ...entry, grant: ['*'] },
    { ...entry, packageName: 'not a package' },
    { ...entry, enabled: 'yes' },
  ];
  values.forEach((value) => assert.throws(() => parseOfflinePluginBundle({ schemaVersion: 1, plugins: [value] })));
  assert.throws(() => parseOfflinePluginBundle({ schemaVersion: 1, plugins: [entry, entry] }));
  assert.throws(() => parseOfflinePluginBundle({ schemaVersion: 1, plugins: [], command: 'bad' }));
});

test('offline selection survives only its selected deployment profile and cannot escape the runtime root', async () => {
  const file = JSON.parse(
    await readFile(new URL('../packages/shared/src/deployment-profiles.json', import.meta.url), 'utf8'),
  );
  const name = file.activeProfile;
  assert.equal(resolveDeploymentDefaults(file).offlinePluginBundle, undefined);
  file.profiles[name].offlinePluginBundle = 'packages/api/offline-plugins/bundle.json';
  assert.equal(
    projectDeploymentProfiles(file, name).profiles[name].offlinePluginBundle,
    'packages/api/offline-plugins/bundle.json',
  );
  for (const path of ['../bundle.json', '/absolute.json', 'C:/bad.json', 'a/../bundle.json', 'a\\bundle.json']) {
    file.profiles[name].offlinePluginBundle = path;
    assert.throws(() => resolveDeploymentDefaults(file));
  }
});

test('staging hashes actual archives, is idempotent and refuses to overwrite a different bundle', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'offline-stage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pkg = join(root, 'package');
  await mkdir(pkg);
  await writeFile(join(pkg, 'manifest.json'), JSON.stringify({ pluginId: entry.pluginId, version: entry.version }));
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: entry.packageName, version: entry.version }));
  const archive = join(root, 'test.tgz');
  execFileSync('tar', ['-czf', archive, '-C', root, 'package'], { windowsHide: true });
  const output = join(root, 'staging');
  const path = await prepareOfflinePluginBundle(output, [archive]);
  const original = await readFile(path);
  const bundle = JSON.parse(original);
  assert.equal(
    bundle.plugins[0].packageDigest,
    `sha512-${createHash('sha512')
      .update(await readFile(archive))
      .digest('base64')}`,
  );
  assert.deepEqual(await readFile(join(output, bundle.plugins[0].archive)), await readFile(archive));
  await prepareOfflinePluginBundle(output, [archive]);
  assert.deepEqual(await readFile(path), original);
  await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@test/other', version: entry.version }));
  execFileSync('tar', ['-czf', archive, '-C', root, 'package'], { windowsHide: true });
  await assert.rejects(prepareOfflinePluginBundle(output, [archive]), /Existing offline bundle differs/);
  assert.deepEqual(await readFile(path), original);
  await writeFile(
    join(pkg, 'package.json'),
    JSON.stringify({ name: entry.packageName, version: entry.version, dependencies: { missing: '1.0.0' } }),
  );
  execFileSync('tar', ['-czf', archive, '-C', root, 'package'], { windowsHide: true });
  await assert.rejects(
    prepareOfflinePluginBundle(join(root, 'incomplete-staging'), [archive]),
    /shipped runtime dependencies/,
  );
});
