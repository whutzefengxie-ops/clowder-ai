import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Materialize only links inside the frozen workspace; reject external/cyclic inputs. */
export function materialize(from, to, workspace, ancestors = new Set()) {
  const real = !ancestors.size || fs.lstatSync(from).isSymbolicLink() ? fs.realpathSync(from) : path.resolve(from);
  if (!inside(workspace, real)) throw new Error(`External packaging link: ${from}`);
  const stat = fs.statSync(real);
  if (!stat.isDirectory()) {
    fs.copyFileSync(real, to);
    return;
  }
  if (ancestors.has(real)) throw new Error(`Cyclic packaging link: ${from}`);
  const next = new Set(ancestors).add(real);
  fs.mkdirSync(to, { recursive: true });
  const manifest = path.join(real, 'package.json');
  const omitSendTests =
    fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name === '@fastify/send';
  for (const name of fs.readdirSync(real)) {
    // Hoisted layout contains no virtual store; its .bin symlinks are not runtime inputs.
    if (name === '.bin' || name === '.pnpm') continue;
    // Published test fixtures include snowman filenames that crash Windows BSD tar.
    // This package's production entry/exports do not reference its test directory.
    if (omitSendTests && name === 'test') continue;
    materialize(path.join(real, name), path.join(to, name), workspace, next);
  }
}

export function exportFrozenRuntime(workspace, out, packages, lockFile) {
  workspace = fs.realpathSync(workspace);
  const lockHash = hash(lockFile);
  if (hash(path.join(workspace, 'pnpm-lock.yaml')) !== lockHash) throw new Error('Frozen workspace lock changed');
  if (fs.existsSync(out)) throw new Error(`Output must be new: ${out}`);
  fs.mkdirSync(out, { recursive: true });
  for (const name of packages) {
    const source = path.join(workspace, 'packages', name);
    const destination = path.join(out, name);
    fs.mkdirSync(destination);
    for (const entry of fs.readdirSync(source)) {
      if (['node_modules', '.next', '.cache'].includes(entry)) continue;
      materialize(path.join(source, entry), path.join(destination, entry), workspace);
    }
    // The entire frozen production graph is retained, including nested peer versions.
    // Workspace links in the hoisted tree become ordinary files within this output.
    const ownModules = path.join(source, 'node_modules');
    exportModules(path.join(workspace, 'node_modules'), ownModules, path.join(destination, 'node_modules'), workspace);
    fs.writeFileSync(path.join(destination, '.runtime-lock.json'), JSON.stringify({ lockHash, node: process.version }));
  }
  return { lockHash, packages };
}

/** A package override replaces the entire module, never overlays old private peers. */
export function exportModules(rootModules, ownModules, destination, workspace) {
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync(rootModules)) {
    if (name.startsWith('.')) continue;
    const source = path.join(rootModules, name);
    if (name.startsWith('@')) {
      fs.mkdirSync(path.join(destination, name), { recursive: true });
      for (const child of fs.readdirSync(source)) {
        if (fs.existsSync(path.join(ownModules, name, child))) continue;
        materialize(path.join(source, child), path.join(destination, name, child), workspace);
      }
    } else if (!fs.existsSync(path.join(ownModules, name))) {
      materialize(source, path.join(destination, name), workspace);
    }
  }
  if (fs.existsSync(ownModules)) materialize(ownModules, destination, workspace);
}
