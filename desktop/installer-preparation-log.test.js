const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const compiler = [
  process.env.ISCC_EXE,
  'C:\\Program Files\\Inno Setup 7\\ISCC.exe',
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
].find((candidate) => candidate && fs.existsSync(candidate));

test(
  'native Setup records the actual identity-helper error before refusing installation',
  { skip: process.platform !== 'win32' || !compiler ? 'Requires Windows and native Inno' : false },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pr1519-prepare-log-'));
    try {
      const source = fs.readFileSync(path.join(__dirname, 'installer/cat-cafe.iss'), 'utf8');
      const output = source.slice(
        source.indexOf('procedure ExtractionOutput'),
        source.indexOf('function ShouldAutoLaunch'),
      );
      const prepare = source.slice(source.indexOf('function PrepareToInstall'));
      const helper = path.join(root, 'configure-desktop-instance.ps1');
      // Only the helper result is a fault fixture; execute the production Pascal gate.
      fs.writeFileSync(helper, "[Console]::Error.WriteLine('PR1519_EXPECTED_IDENTITY_FAILURE'); exit 73\n");
      const script = path.join(root, 'probe.iss');
      fs.writeFileSync(
        script,
        `[Setup]
AppName=PR1519 Preparation Log Probe
AppVersion=1.0.0
DefaultDirName=${path.join(root, 'program')}
CreateAppDir=no
Uninstallable=no
PrivilegesRequired=lowest
UsePreviousAppDir=no
OutputDir=${root}
OutputBaseFilename=probe
Compression=none
SetupLogging=yes
[Files]
Source: "${helper}"; Flags: dontcopy
[Code]
#include "${path.join(__dirname, 'installer/runtime-failure.iss')}"
${output}
${prepare}
`,
        'utf8',
      );
      const compiled = spawnSync(compiler, ['/Q', script], { encoding: 'utf8', timeout: 30000, windowsHide: true });
      assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
      const log = path.join(root, 'setup.log');
      const installed = spawnSync(
        path.join(root, 'probe.exe'),
        ['/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${log}`],
        { encoding: 'utf8', timeout: 30000, windowsHide: true },
      );
      assert.equal(installed.status, 7, installed.stdout + installed.stderr);
      const recorded = fs.readFileSync(log, 'utf8');
      assert.match(recorded, /Unable to preserve the target installation identity/);
      assert.match(
        recorded,
        /PR1519_EXPECTED_IDENTITY_FAILURE/,
        'Setup must retain the helper stderr, not only a generic error',
      );
      assert.equal(fs.existsSync(path.join(root, 'program')), false);
    } finally {
      assert.equal(path.dirname(root), os.tmpdir());
      assert.match(path.basename(root), /^pr1519-prepare-log-/);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
