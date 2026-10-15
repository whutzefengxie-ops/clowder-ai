import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('isolated DSH snapshot retains ACP connection and live installed cache without copying history or replacing config', async () => {
  const { snapshotDshTestConnection } = await import('./scripts/snapshot-dsh-test-connection.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-connection-'));
  try {
    const source = path.join(root, 'source'),
      target = path.join(root, 'isolated');
    const write = (rel, value) => {
      const file = path.join(source, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, value);
    };
    write('.dsh/profiles/acp/package.json', '{"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-acp-app"]}}}');
    write('.dsh/profiles/acp/cordis.yml', 'test-only connection');
    write('.dsh/sessions/user-history', 'never copy');
    fs.mkdirSync(path.join(source, 'AppData/Local/npm-cache/_npx'), { recursive: true });
    snapshotDshTestConnection({
      sourceHome: source,
      targetHome: target,
      npmCache: path.join(source, 'AppData/Local/npm-cache'),
    });
    assert.equal(fs.readFileSync(path.join(target, '.dsh/profiles/acp/cordis.yml'), 'utf8'), 'test-only connection');
    assert.equal(fs.existsSync(path.join(target, '.dsh/sessions')), false);
    write(
      'AppData/Local/npm-cache/_npx/new-install/node_modules/@deepseek-ai/dsh/package.json',
      '{"name":"@deepseek-ai/dsh"}',
    );
    assert.equal(
      fs.existsSync(
        path.join(target, 'AppData/Local/npm-cache/_npx/new-install/node_modules/@deepseek-ai/dsh/package.json'),
      ),
      true,
    );
    fs.writeFileSync(path.join(target, '.dsh/profiles/acp/cordis.yml'), 'user-edited');
    snapshotDshTestConnection({
      sourceHome: source,
      targetHome: target,
      npmCache: path.join(source, 'AppData/Local/npm-cache'),
    });
    assert.equal(fs.readFileSync(path.join(target, '.dsh/profiles/acp/cordis.yml'), 'utf8'), 'user-edited');
    assert.equal(fs.readFileSync(path.join(source, '.dsh/profiles/acp/cordis.yml'), 'utf8'), 'test-only connection');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
