import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { deploymentValues, prepareIntranetDeployment } from './lib/prepare-intranet-deployment.mjs';

function fixture(contents = '# keep my settings\r\nAUTH_TOKEN=opaque-test-value\r\n') {
  const root = mkdtempSync(join(tmpdir(), 'intranet-prepare-'));
  mkdirSync(join(root, 'packages/api'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'cat-cafe' }));
  writeFileSync(join(root, 'packages/api/package.json'), JSON.stringify({ name: '@cat-cafe/api' }));
  writeFileSync(join(root, '.env'), contents);
  const calls = [];
  const options = {
    hostRoot: root,
    deploymentEnv: { CAT_CAFE_DATA_DIR: join(root, 'private data') },
    appendAudit: async (input) => {
      calls.push(input);
    },
  };
  return { root, calls, options, read: () => readFileSync(join(root, '.env'), 'utf8') };
}

test('one explicit preparation preserves existing bytes and credentials; successful repeat does not probe or rewrite', async () => {
  const f = fixture();
  const original = f.read();
  const result = await prepareIntranetDeployment(f.options);
  assert.equal(result.status, 'prepared');
  assert.ok(f.read().startsWith(original));
  assert.equal(deploymentValues(f.read()).CAT_CAFE_WINDOWS_ACP_BOOTSTRAP_MODE, 'trusted-host');
  assert.equal(deploymentValues(f.read()).CAT_CAFE_ACP_BOOTSTRAP_CONFIG_AUDIT_MODE, 'warn-bootstrap-root');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].event.type, 'host.deployment.audit-readiness');
  assert.ok(!JSON.stringify(f.calls).includes('opaque-test-value'));
  const saved = f.read();
  assert.equal((await prepareIntranetDeployment(f.options)).status, 'unchanged');
  assert.equal(f.read(), saved);
  assert.equal(f.calls.length, 1);
});

test('a failed actual audit append leaves .env unchanged and succeeds after the writer is repaired', async () => {
  const f = fixture();
  const previous = f.read();
  await assert.rejects(
    prepareIntranetDeployment({
      ...f.options,
      appendAudit: async () => {
        throw Object.assign(new Error('blocked'), { code: 'EPERM' });
      },
    }),
  );
  assert.equal(f.read(), previous);
  await prepareIntranetDeployment(f.options);
  assert.equal(f.calls.length, 1);
});

test('explicit strict/required and audit paths win; an existing implicit audit directory is retained', async () => {
  const f = fixture('CAT_CAFE_WINDOWS_ACP_BOOTSTRAP_MODE=strict\nCAT_CAFE_ACP_BOOTSTRAP_CONFIG_AUDIT_MODE=required\n');
  const old = join(f.root, 'packages/api/data/audit-logs');
  mkdirSync(old, { recursive: true });
  const result = await prepareIntranetDeployment(f.options);
  assert.equal(result.auditDirectory, old);
  assert.match(f.read(), /BOOTSTRAP_MODE=strict/);
  assert.match(f.read(), /AUDIT_MODE=required/);
  const second = fixture('AUDIT_LOG_DIR=./already-selected\n');
  assert.equal(
    (await prepareIntranetDeployment(second.options)).auditDirectory,
    join(second.root, 'packages/api/already-selected'),
  );
  assert.match(second.read(), /AUDIT_LOG_DIR=.\/already-selected/);
});

test('a conflicting file edit is kept; retry reuses an already written preparation event', async () => {
  const f = fixture();
  await assert.rejects(
    prepareIntranetDeployment({
      ...f.options,
      beforeCommit: async () => {
        writeFileSync(join(f.root, '.env'), f.read() + 'MANUAL_SETTING=preserved\n');
      },
    }),
    /changed|conflict/i,
  );
  assert.match(f.read(), /MANUAL_SETTING=preserved/);
  assert.equal(f.calls.length, 1);
  await prepareIntranetDeployment(f.options);
  assert.equal(f.calls.length, 1);
  assert.match(f.read(), /MANUAL_SETTING=preserved/);
});

test('an uncertain append is reconciled from its preparation id rather than writing a duplicate', async () => {
  const f = fixture();
  let seen;
  await assert.rejects(
    prepareIntranetDeployment({
      ...f.options,
      appendAudit: async (input) => {
        seen = input.event.data.preparationId;
        throw new Error('receipt lost after append');
      },
    }),
  );
  await prepareIntranetDeployment({ ...f.options, lookupAudit: async ({ preparationId }) => preparationId === seen });
  assert.equal(f.calls.length, 0);
});

test('invalid/duplicate keys, local overrides and linked targets are refused without changing the original file', async () => {
  for (const contents of [
    'CAT_CAFE_WINDOWS_ACP_BOOTSTRAP_MODE=typo\n',
    'AUDIT_LOG_DIR=\n',
    'CAT_CAFE_WINDOWS_ACP_BOOTSTRAP_MODE=strict\nCAT_CAFE_WINDOWS_ACP_BOOTSTRAP_MODE=trusted-host\n',
  ]) {
    const f = fixture(contents);
    await assert.rejects(prepareIntranetDeployment(f.options));
    assert.equal(f.read(), contents);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  writeFileSync(join(f.root, '.env.local'), 'CAT_CAFE_WINDOWS_ACP_BOOTSTRAP_MODE=strict\n');
  await assert.rejects(prepareIntranetDeployment(f.options), /env.local/);
  assert.equal(f.calls.length, 0);
  const target = fixture();
  const alias = `${target.root}-alias`;
  symlinkSync(target.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(prepareIntranetDeployment({ ...target.options, hostRoot: alias }), /linked/);
  assert.equal(target.calls.length, 0);
});

test('intranet template contains only the two reviewed policy keys and values', () => {
  const template = readFileSync(new URL('../.env.intranet.example', import.meta.url), 'utf8');
  assert.deepEqual(deploymentValues(template), {
    CAT_CAFE_WINDOWS_ACP_BOOTSTRAP_MODE: 'trusted-host',
    CAT_CAFE_ACP_BOOTSTRAP_CONFIG_AUDIT_MODE: 'warn-bootstrap-root',
  });
  for (const line of template.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#')))
    assert.match(line, /^CAT_CAFE_(WINDOWS_ACP_BOOTSTRAP_MODE|ACP_BOOTSTRAP_CONFIG_AUDIT_MODE)=/);
});

test('crash recovery retains a verified stale lock, never removes a live owner or changes .env on refusal', async () => {
  const f = fixture();
  mkdirSync(join(f.root, '.cat-cafe'));
  const lock = join(f.root, '.cat-cafe/deployment-preparation.lock');
  writeFileSync(lock, JSON.stringify({ pid: process.pid }));
  const original = f.read();
  await assert.rejects(prepareIntranetDeployment({ ...f.options, recoverStaleLock: true }), /live/);
  assert.equal(f.read(), original);
  writeFileSync(lock, JSON.stringify({ pid: 2147483646 }));
  await prepareIntranetDeployment({ ...f.options, recoverStaleLock: true });
  assert.equal(f.calls.length, 1);
});

test('invalid UTF-8 configuration is rejected byte-for-byte without a probe', async () => {
  const f = fixture();
  const previous = Buffer.from([0x41, 0x3d, 0xff, 0x0a]);
  writeFileSync(join(f.root, '.env'), previous);
  await assert.rejects(prepareIntranetDeployment(f.options), /encod|UTF|valid/i);
  assert.deepEqual(readFileSync(join(f.root, '.env')), previous);
  assert.equal(f.calls.length, 0);
});

test(
  'production Windows PowerShell dotenv loaders preserve a prepared Unicode directory after restart',
  { skip: process.platform !== 'win32' },
  async () => {
    const f = fixture('# 保留配置\r\n');
    const result = await prepareIntranetDeployment({
      ...f.options,
      deploymentEnv: { CAT_CAFE_DATA_DIR: join(f.root, '中文 用户') },
    });
    const source = readFileSync(new URL('./start-windows.ps1', import.meta.url), 'utf8');
    const loader = source.slice(
      source.indexOf('# -- Load .env'),
      source.indexOf('function Preserve-ServiceFlagForApiLifecycle'),
    );
    const ps = `$ProgressPreference='SilentlyContinue'; [Console]::InputEncoding=[Text.Encoding]::UTF8; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ProjectRoot=[Console]::In.ReadToEnd(); function Write-Ok($v){}; function Write-Warn($v){}; ${loader}\n$env:AUDIT_LOG_DIR`;
    for (let i = 0; i < 2; i++) {
      const directory = execFileSync(
        'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
        { input: f.root, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      assert.equal(directory.replaceAll('\\', '/'), result.auditDirectory.replaceAll('\\', '/'));
    }
    assert.match(source, /Get-Content \$envFile -Encoding UTF8/g);
  },
);
