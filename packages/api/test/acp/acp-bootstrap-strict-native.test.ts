import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensureWindowsAcpBootstrapDirectories } from '../../src/domains/cats/services/agents/providers/acp/acp-bootstrap-windows-directory.ts';

test(
  'a missing Unicode ancestor is reported as a readable structured rejection',
  { skip: process.platform !== 'win32' },
  () => {
    const missing = join(tmpdir(), `不存在-${randomUUID()}`);
    assert.throws(
      () => ensureWindowsAcpBootstrapDirectories(join(missing, 'private'), join(missing, 'private', 'cwd')),
      (error: unknown) =>
        error instanceof Error && error.message.includes('directory does not exist') && error.message.includes(missing),
    );
    assert.equal(existsSync(missing), false);
  },
);

test(
  'strict admission rejects SUBST roots that hide the physical ancestor chain',
  { skip: process.platform !== 'win32' },
  () => {
    const parent = mkdtempSync(join(tmpdir(), 'acp-strict-alias-'));
    const drive = ['Z:', 'Y:', 'X:', 'W:'].find((candidate) => !existsSync(`${candidate}\\`));
    assert.ok(drive, 'a free drive letter is required for the disposable SUBST fixture');
    let mapped = false;
    try {
      const script = `$ErrorActionPreference='Stop'; $p=[Console]::In.ReadToEnd();
      $acl=[Security.AccessControl.DirectorySecurity]::new(); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;
      $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false);
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'));
      [IO.Directory]::SetAccessControl($p,$acl)`;
      execFileSync(
        join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { input: parent, windowsHide: true },
      );
      execFileSync('subst.exe', [drive, parent], { windowsHide: true });
      mapped = true;
      const root = `${drive}\\bootstrap`;
      assert.throws(
        () => ensureWindowsAcpBootstrapDirectories(root, join(root, 'cwd')),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'PARENT_VOLUME',
      );
      assert.equal(
        existsSync(join(parent, 'bootstrap')),
        false,
        'alias must reject before creating any bootstrap directory',
      );
    } finally {
      if (mapped) {
        const mapping = execFileSync('subst.exe', { encoding: 'utf8', windowsHide: true });
        assert.ok(
          mapping
            .split(/\r?\n/)
            .some(
              (line) =>
                line.toLowerCase().startsWith(drive!.toLowerCase()) &&
                line.toLowerCase().endsWith(`=> ${parent.toLowerCase()}`),
            ),
          'only remove the mapping created by this test',
        );
        execFileSync('subst.exe', [drive!, '/D'], { windowsHide: true });
      }
      assert.match(parent, /acp-strict-alias-[^\\/]+$/);
      rmSync(parent, { recursive: true });
    }
  },
);
