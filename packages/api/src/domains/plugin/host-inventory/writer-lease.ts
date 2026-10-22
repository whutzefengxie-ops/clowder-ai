import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { PluginInventoryError } from './types.js';

const owned = new Map<string, { path: string; contents: string }>();

function live(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

/** File inventory is a single live API writer. Read-only snapshots do not claim ownership. */
export function requireInventoryWriterLease(inventoryPath: string): void {
  mkdirSync(dirname(inventoryPath), { recursive: true, mode: 0o700 });
  const parent = statSync(dirname(inventoryPath), { bigint: true });
  const filename = process.platform === 'win32' ? basename(inventoryPath).toLowerCase() : basename(inventoryPath);
  const key = createHash('sha256').update(`${parent.dev}:${parent.ino}:${filename}`).digest('hex').slice(0, 24);
  const held = owned.get(key);
  if (held) {
    if (readFileSync(held.path, 'utf8') !== held.contents)
      throw new Error('Plugin inventory writer lease changed; restart the Host before retrying');
    return;
  }
  const directory = join(dirname(inventoryPath), '.plugin-inventory-writers', key);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Plugin inventory writer directory must not be linked');
  const path = join(directory, `${process.pid}-${randomUUID()}.json`);
  const contents = JSON.stringify({ schemaVersion: 1, pid: process.pid });
  writeFileSync(path, contents, { flag: 'wx', mode: 0o600 });
  let accepted = false;
  try {
    for (const entry of readdirSync(directory)) {
      const otherPath = join(directory, entry);
      if (otherPath === path) continue;
      try {
        const stat = lstatSync(otherPath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid writer lease');
        const other: unknown = JSON.parse(readFileSync(otherPath, 'utf8'));
        if (
          !other ||
          typeof other !== 'object' ||
          !('pid' in other) ||
          !Number.isSafeInteger(other.pid) ||
          Number(other.pid) <= 0
        )
          throw new Error('Invalid writer lease');
        if (live(Number(other.pid)))
          throw new PluginInventoryError(
            'INVENTORY_INVARIANT',
            'Plugin inventory already has a live API writer; use one Host API per inventory before retrying',
          );
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
        throw error;
      }
    }
    owned.set(key, { path, contents });
    accepted = true;
  } finally {
    if (!accepted && existsSync(path)) unlinkSync(path);
  }
}

process.once('exit', () => {
  for (const { path, contents } of owned.values()) {
    try {
      if (readFileSync(path, 'utf8') === contents) unlinkSync(path);
    } catch {
      /* Never remove another writer's record. */
    }
  }
});
