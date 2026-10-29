#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseOfflinePluginBundle } from '../packages/api/src/domains/plugin/manager/offline-plugin-bundle-schema.ts';

/** Explicit build staging only; an existing different bundle is never replaced. */
export async function prepareOfflinePluginBundle(output, archives) {
  if (!isAbsolute(output) || !archives.length || archives.length > 64)
    throw new Error('Expected absolute staging output and 1–64 .tgz archives');
  const inputs = await Promise.all(
    archives.map(async (archive) => {
      const bytes = await readFile(archive);
      const metadata = (name) =>
        JSON.parse(
          execFileSync('tar', ['-xOf', resolve(archive), `package/${name}`], {
            encoding: 'utf8',
            windowsHide: true,
            maxBuffer: 1024 * 1024,
          }),
        );
      const manifest = metadata('manifest.json');
      const pkg = metadata('package.json');
      if (pkg.version !== manifest.version) throw new Error('Package and manifest version disagree');
      const dependencies = [pkg.dependencies, pkg.optionalDependencies].flatMap((value) =>
        value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [],
      );
      if (dependencies.length) {
        const contents = execFileSync('tar', ['-tf', resolve(archive)], {
          encoding: 'utf8',
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        });
        if (!contents.split(/\r?\n/).some((name) => name.startsWith('package/node_modules/')))
          throw new Error('Offline packages must include shipped runtime dependencies');
      }
      const hex = createHash('sha512').update(bytes).digest('hex');
      return {
        source: resolve(archive),
        bytes,
        entry: {
          pluginId: manifest.pluginId,
          packageName: pkg.name,
          version: manifest.version,
          packageDigest: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
          archive: `${hex}.tgz`,
          enabled: true,
        },
      };
    }),
  );
  const bundle = parseOfflinePluginBundle({ schemaVersion: 1, plugins: inputs.map((i) => i.entry) });
  await mkdir(output, { recursive: true });
  for (const input of inputs) {
    const target = join(output, input.entry.archive);
    await copyFile(input.source, target, constants.COPYFILE_EXCL).catch(async (error) => {
      if (error.code !== 'EEXIST') throw error;
      if (!(await readFile(target)).equals(input.bytes)) throw new Error('Existing offline archive differs');
    });
  }
  const text = `${JSON.stringify(bundle, null, 2)}\n`;
  const target = join(output, 'bundle.json');
  await writeFile(target, text, { flag: 'wx' }).catch(async (error) => {
    if (error.code !== 'EEXIST') throw error;
    if ((await readFile(target, 'utf8')) !== text)
      throw new Error('Existing offline bundle differs; use a new staging directory');
  });
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [output, ...archives] = process.argv.slice(2);
  console.log(await prepareOfflinePluginBundle(output, archives));
}
