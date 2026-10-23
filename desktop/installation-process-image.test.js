const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

function inspectCandidate({ unavailableModulePath = false, inaccessibleImage = false }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-image-query-'));
  try {
    const install = path.join(root, 'install');
    fs.mkdirSync(install);
    fs.writeFileSync(path.join(install, 'powershell.exe'), 'Inert filename inventory, never executed.');
    const quote = (value) => `'${value.replace(/'/g, "''")}'`;
    const wrapper = path.join(root, 'inspect.ps1');
    fs.writeFileSync(
      wrapper,
      [
        "$ErrorActionPreference = 'Stop'",
        inaccessibleImage
          ? "$global:fixtureProcess = [pscustomobject]@{ Id = 2147483000; ProcessName = 'powershell' }"
          : "$global:fixtureProcess = [pscustomobject]@{ Id = $PID; ProcessName = 'powershell' }",
        unavailableModulePath
          ? "$global:fixtureProcess | Add-Member ScriptProperty Path { throw 'Module enumeration denied' } -Force"
          : `$global:fixtureProcess | Add-Member NoteProperty Path ${quote(path.join(install, 'powershell.exe'))} -Force`,
        'function Get-Process { [CmdletBinding()] param([int]$Id) $global:fixtureProcess }',
        "function Stop-Process { throw 'Inspection must never stop any process' }",
        `if (-not (Test-Path -LiteralPath ${quote(install)})) { throw 'Inspection fixture directory missing' }`,
        `& ${quote(path.join(__dirname, 'scripts/stop-installed-desktop.ps1'))} -AppDir ${quote(install)} -InspectOnly`,
        'exit $LASTEXITCODE',
      ].join('\r\n'),
    );
    return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test(
  'limited image lookup excludes a real unrelated process when module Path is unavailable',
  { skip: process.platform !== 'win32' },
  () => {
    const result = inspectCandidate({ unavailableModulePath: true });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '', 'the unrelated PowerShell image is outside the installation');
  },
);

test(
  'module Path cannot substitute for the native process image ownership boundary',
  { skip: process.platform !== 'win32' },
  () => {
    const result = inspectCandidate({});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '', 'an in-root module Path does not make an unrelated image owned');
  },
);

test(
  'failed limited image lookup for a candidate still reported live refuses inspection',
  { skip: process.platform !== 'win32' },
  () => {
    const result = inspectCandidate({ inaccessibleImage: true });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Cannot verify candidate executable/);
  },
);
