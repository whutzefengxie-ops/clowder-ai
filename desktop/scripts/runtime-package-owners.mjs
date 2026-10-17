import fs from 'node:fs';
import path from 'node:path';
import { packageSignature } from './runtime-web-inputs.mjs';

export function rootModuleNames(modules) {
  if (!fs.existsSync(modules)) return [];
  return fs.readdirSync(modules, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || (!entry.isDirectory() && !entry.isSymbolicLink())) return [];
    return entry.name.startsWith('@')
      ? fs.readdirSync(path.join(modules, entry.name)).map((name) => `${entry.name}/${name}`)
      : [entry.name];
  });
}

/**
 * Sharp publishes one optional native package per OS/architecture. Next's
 * trace can mention packages that were present in the lock graph but are not
 * installed for the current build platform. They cannot be runtime owners on
 * this platform and must not make an otherwise valid frozen export fail.
 */
function isNonTargetSharpOptional(name) {
  if (!name.startsWith('@img/sharp-')) return false;
  const target = process.platform === 'win32' ? 'win32' : process.platform;
  return !name.includes(`-${target}-`) && !name.endsWith(`-${target}`);
}

/** Ambiguous matches retain every original owner; no package identity is merged. */
export function tracedOwners(workspace, records) {
  const modules = path.join(workspace, 'node_modules');
  const matches = new Map(records.map((record) => [record.signature, new Set()]));
  const packageRoot = path.join(workspace, 'packages');
  const moduleRoots = [
    modules,
    ...fs.readdirSync(packageRoot).map((name) => path.join(packageRoot, name, 'node_modules')),
  ];
  const owners = moduleRoots.flatMap((directory) =>
    rootModuleNames(directory).map((name) => path.join(directory, name)),
  );
  for (const root of owners) {
    const pending = [root],
      seen = new Set();
    while (pending.length) {
      const directory = fs.realpathSync(pending.pop());
      if (!directory.startsWith(workspace + path.sep)) throw new Error('External traced package owner');
      if (seen.has(directory)) continue;
      seen.add(directory);
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
      matches.get(packageSignature(manifest))?.add(root);
      const nested = path.join(directory, 'node_modules');
      pending.push(...rootModuleNames(nested).map((name) => path.join(nested, name)));
    }
  }
  for (const [signature, owners] of matches) {
    if (owners.size) continue;
    const name = JSON.parse(signature)[0];
    if (isNonTargetSharpOptional(name)) continue;
    throw new Error(`No frozen owner for traced package: ${name}`);
  }
  return [...new Set([...matches.values()].flatMap((owners) => [...owners]))];
}
