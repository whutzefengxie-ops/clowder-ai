import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FilePluginInventoryStore } from '../dist/domains/plugin/host-inventory/stores.js';

test('a second live API cannot mutate an owned inventory; same-process services share the writer', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'inventory-writer-')), 'inventory.json');
  await new FilePluginInventoryStore(path).transaction(() => {});
  await new FilePluginInventoryStore(path).transaction(() => {});
  const module = new URL('../dist/domains/plugin/host-inventory/stores.js', import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const {FilePluginInventoryStore}=await import(${JSON.stringify(module)});try{await new FilePluginInventoryStore(process.argv[1]).transaction(()=>{throw new Error('MUTATION REACHED')});process.exit(2)}catch(e){console.log(e.message);process.exit(e.message.includes('live API writer')?0:3)}`,
      path,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(child.status, 0, child.stderr + child.stdout);
  assert.match(child.stdout, /live API writer/);
});
