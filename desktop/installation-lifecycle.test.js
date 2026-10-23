const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { createWindowRecoveryController } = require('./window-recovery');

test('second-instance shutdown accepts only the same installation and user-data identity', () => {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const start = source.indexOf("app.on('second-instance'");
  const end = source.indexOf("\napp.on('ready'", start);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'install-identity-'));
  try {
    const root = path.join(base, 'install');
    const userData = path.join(base, 'instance');
    fs.mkdirSync(root);
    fs.mkdirSync(userData);
    let handler,
      quits = 0;
    const context = {
      app: {
        on: (_name, callback) => {
          handler = callback;
        },
        getPath: () => userData,
      },
      PROJECT_ROOT: root,
      QUIT_FOR_UPDATE_ARG: '--quit-owned-installation',
      dbg: () => {},
      quitApp: () => {
        quits++;
      },
      windowRecovery: createWindowRecoveryController({
        getState: () => ({ phase: 'ready', mainWindow: null, splashWindow: null, services: null, isQuitting: false }),
        createMainWindow: async () => {},
        quitArg: '--quit-owned-installation',
        isShutdownRequest: (...args) => require('./installation-lifecycle').isInstallationShutdownRequest(...args),
        projectRoot: root,
        getUserDataRoot: () => userData,
        quitApp: () => {
          quits++;
        },
        dbg: () => {},
      }),
    };
    vm.runInNewContext(source.slice(start, end), context);
    const args = ['exe', '--quit-owned-installation'];
    handler(null, args, '', { installRoot: path.join(base, 'other'), userDataRoot: userData });
    handler(null, args, '', { installRoot: root, userDataRoot: path.join(base, 'other-data') });
    handler(null, args, '', undefined);
    handler(null, ['exe', '--quit-for-update'], '', { installRoot: root, userDataRoot: userData });
    assert.equal(quits, 0, 'foreign or missing identity cannot shut down this app');
    handler(null, ['exe', '--quit-owned-installation'], '', { installRoot: root, userDataRoot: userData });
    assert.equal(quits, 1);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('second-instance renderer recreation reports failures instead of creating an unhandled rejection', async () => {
  const failure = new Error('controlled renderer load failure');
  let reported;
  const controller = createWindowRecoveryController({
    getState: () => ({ phase: 'ready', mainWindow: null, splashWindow: null, services: {}, isQuitting: false }),
    createMainWindow: async () => {
      throw failure;
    },
    quitArg: '--quit-owned-installation',
    isShutdownRequest: () => false,
    projectRoot: '/tmp/install',
    getUserDataRoot: () => '/tmp/user-data',
    quitApp: () => {},
    dbg: () => {},
    onRecoveryError: (error) => {
      reported = error;
    },
  });
  controller.handleSecondInstance(['clowder-ai.exe'], undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reported, failure);
});

function mockedInstallInspection({
  candidateName,
  candidatePath,
  unreadable = false,
  inspectOnly = true,
  delayedExit = false,
  waitAcknowledgesExit = true,
}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'install-enumeration-'));
  const appDir = path.join(base, 'install');
  fs.mkdirSync(appDir);
  fs.writeFileSync(path.join(appDir, 'probe.exe'), 'Only filename inventory is used; this fixture is never executed.');
  const marker = path.join(base, 'unexpected-stop');
  const waitMarker = path.join(base, 'owned-process-waited');
  const production = fs.readFileSync(path.join(__dirname, 'scripts/stop-installed-desktop.ps1'), 'utf8');
  const imageCall = '[InstallPathIdentity]::ProcessImage($candidate.Id)';
  assert.equal(production.split(imageCall).length, 2, 'replace only the native image lookup for fictitious PIDs');
  const fixtureScript = path.join(base, 'stop-with-fixture-image.ps1');
  fs.writeFileSync(fixtureScript, production.replace(imageCall, '$candidate.Path'));
  const quote = (value) => `'${value.replace(/'/g, "''")}'`;
  const wrapper = path.join(base, 'inspect.ps1');
  fs.writeFileSync(
    wrapper,
    [
      `$global:fixtureProcess = [pscustomobject]@{ Id = 2147483000; ProcessName = ${quote(candidateName)} }`,
      '$global:fixtureVisible = $true',
      unreadable
        ? "$global:fixtureProcess | Add-Member ScriptProperty Path { throw 'Controlled protected process path' }"
        : `$global:fixtureProcess | Add-Member NoteProperty Path ${quote(delayedExit ? path.join(appDir, 'probe.exe') : (candidatePath ?? path.join(base, 'missing.exe')))}`,
      'function Get-Process { [CmdletBinding()] param([int]$Id) if ($global:fixtureVisible) { $global:fixtureProcess } }',
      'function Stop-Process { [CmdletBinding()] param([Parameter(ValueFromPipeline)]$InputObject, [switch]$Force) process {',
      `  [IO.File]::WriteAllText(${quote(marker)}, 'called')`,
      delayedExit
        ? "  if (-not [object]::ReferenceEquals(@($InputObject)[0], $global:fixtureProcess)) { throw 'Wrong stop object' }"
        : "  throw 'No process may be stopped by this fixture'",
      '} }',
      'function Wait-Process { [CmdletBinding()] param([Parameter(ValueFromPipeline)]$InputObject, [int]$Timeout) process {',
      "  if (@($InputObject).Count -ne 1 -or -not [object]::ReferenceEquals(@($InputObject)[0], $global:fixtureProcess)) { throw 'Wrong wait object' }",
      `  if ($Timeout -ne 5 -or -not (Test-Path -LiteralPath ${quote(marker)})) { throw 'Wait must follow stop and be bounded' }`,
      `  [IO.File]::WriteAllText(${quote(waitMarker)}, 'called')`,
      ...(waitAcknowledgesExit ? ['$global:fixtureVisible = $false'] : []),
      '} }',
      `& ${quote(fixtureScript)} -AppDir ${quote(appDir)} -WaitSeconds 0 ${inspectOnly ? '-InspectOnly' : ''}`,
      'exit $LASTEXITCODE',
    ].join('\r\n'),
  );
  try {
    let status = 0,
      stderr = '';
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: 'pipe',
        timeout: 15000,
      });
    } catch (error) {
      status = error.status;
      stderr = error.stderr?.toString() ?? '';
    }
    return { status, stderr, stopped: fs.existsSync(marker), waited: fs.existsSync(waitMarker) };
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test(
  'Windows inspection ignores unrelated process paths that cannot be canonicalized',
  { skip: process.platform !== 'win32' },
  () => {
    const result = mockedInstallInspection({ candidateName: 'unrelated-protected-process' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stopped, false);
  },
);

test(
  'Windows inspection never accesses unrelated protected process Path getters',
  { skip: process.platform !== 'win32' },
  () => {
    const result = mockedInstallInspection({ candidateName: 'unrelated-protected-process', unreadable: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stopped, false);
  },
);

test(
  'Windows cleanup reports unresolved live candidates without stopping them or claiming success',
  { skip: process.platform !== 'win32' },
  () => {
    for (const unreadable of [false, true]) {
      const result = mockedInstallInspection({ candidateName: 'probe', unreadable, inspectOnly: false });
      assert.equal(result.status, 1, 'an unresolved candidate is not proof that the installation stopped');
      assert.equal(result.stopped, false);
    }
  },
);

test(
  'Windows cleanup waits for the captured owned process to exit after stop',
  { skip: process.platform !== 'win32' },
  () => {
    const result = mockedInstallInspection({ candidateName: 'probe', inspectOnly: false, delayedExit: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stopped, true);
    assert.equal(result.waited, true);
  },
);

test(
  'Windows cleanup still fails if the captured process remains after the bounded wait',
  { skip: process.platform !== 'win32' },
  () => {
    const result = mockedInstallInspection({
      candidateName: 'probe',
      inspectOnly: false,
      delayedExit: true,
      waitAcknowledgesExit: false,
    });
    assert.equal(result.status, 1, 'a stop request and expired wait are not proof of exit');
    assert.equal(result.stopped, true);
    assert.equal(result.waited, true);
  },
);

test(
  'Windows cleanup stops a test-owned install process and preserves its sibling control',
  { skip: process.platform !== 'win32' },
  async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'install-stop-'));
    const root = path.join(base, 'install');
    const sibling = path.join(base, 'install-other');
    const children = [];
    try {
      for (const dir of [root, sibling]) {
        fs.mkdirSync(dir);
        const executable = path.join(dir, 'probe.exe');
        fs.copyFileSync(process.execPath, executable);
        const child = spawn(executable, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true });
        await new Promise((resolve, reject) => {
          child.once('spawn', resolve);
          child.once('error', reject);
        });
        children.push(child);
      }
      const script = path.join(__dirname, 'scripts/stop-installed-desktop.ps1');
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-AppDir', root];
      assert.equal(
        JSON.parse(
          execFileSync('powershell.exe', [...args, '-InspectOnly'], { encoding: 'utf8', windowsHide: true }).trim(),
        ),
        children[0].pid,
      );
      const alias = path.join(base, 'alias');
      fs.symlinkSync(root, alias, 'junction');
      assert.equal(
        JSON.parse(
          execFileSync('powershell.exe', [...args.slice(0, -1), alias, '-InspectOnly'], {
            encoding: 'utf8',
            windowsHide: true,
          }).trim(),
        ),
        children[0].pid,
      );
      try {
        execFileSync('powershell.exe', [...args, '-WaitSeconds', '0'], { timeout: 10000, windowsHide: true });
      } catch (error) {
        const source = fs.readFileSync(script, 'utf8');
        const quote = (value) => `'${value.replace(/'/g, "''")}'`;
        const diagnostic = path.join(base, 'failed-stop-state.ps1');
        fs.writeFileSync(
          diagnostic,
          [
            "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)",
            source.slice(source.indexOf('Add-Type -TypeDefinition'), source.indexOf('$installRoot =')),
            `$prefix=[InstallPathIdentity]::Resolve(${quote(root)}).TrimEnd([char]92)+[char]92`,
            `@(foreach($probeId in @(${children.map((child) => child.pid).join(',')})){`,
            '$p=Get-Process -Id $probeId -ErrorAction SilentlyContinue;$exited=$null;$image=$null;$failure=$null;$owned=$false',
            'if($p){try{$exited=$p.HasExited}catch{};try{$image=[InstallPathIdentity]::ProcessImage($probeId)}catch{$failure=$_.Exception.Message}}',
            'if($image){try{$owned=[InstallPathIdentity]::Resolve($image).StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)}catch{}}',
            '[pscustomobject]@{pid=$probeId;listed=[bool]$p;HasExited=$exited;image=$image;owned=$owned;readError=$failure}',
            '})|ConvertTo-Json -Depth 4 -Compress',
          ].join('\r\n'),
        );
        const state = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', diagnostic], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 10000,
        });
        console.error('Owned stop failure state:', {
          status: error.status,
          stderr: error.stderr?.toString(),
          probePids: children.map((child) => child.pid),
          stateStatus: state.status,
          state: state.stdout,
          stateError: state.stderr || state.error?.message,
        });
        throw error;
      }
      await new Promise((resolve) => {
        if (children[0].exitCode !== null) resolve();
        else children[0].once('exit', resolve);
      });
      assert.doesNotThrow(() => process.kill(children[1].pid, 0), 'sibling installation remains running');
    } finally {
      for (const child of children) if (child.exitCode === null) child.kill();
      await Promise.all(
        children.map((child) =>
          child.exitCode !== null ? Promise.resolve() : new Promise((resolve) => child.once('exit', resolve)),
        ),
      );
      fs.rmSync(base, { recursive: true, force: true });
    }
  },
);

test('installer and uninstaller use the same installation-scoped shutdown script', () => {
  const installer = fs.readFileSync(path.join(__dirname, 'installer/cat-cafe.iss'), 'utf8');
  const identityGate = fs.readFileSync(path.join(__dirname, 'installer/installation-identity.iss'), 'utf8');
  assert.doesNotMatch(installer, /Stop-Process -Name/);
  assert.match(installer, /\[UninstallRun\][\s\S]*stop-installed-desktop\.ps1/);
  assert.match(installer, /#include "installation-identity\.iss"/);
  assert.match(identityGate, /PrepareToInstall[\s\S]*stop-installed-desktop\.ps1/);
  const script = fs.readFileSync(path.join(__dirname, 'scripts/stop-installed-desktop.ps1'), 'utf8');
  assert.match(script, /StartsWith\(\$installPrefix, \[System\.StringComparison\]::OrdinalIgnoreCase\)/);
  assert.match(script, /--quit-owned-installation/);
  assert.doesNotMatch(script, /ArgumentList '--quit-for-update'/);
  const outgoing = script.match(/ArgumentList '([^']+)'/)[1];
  assert.equal(
    ['exe', outgoing].includes('--quit-for-update'),
    false,
    'old receiver cannot interpret the new request as legacy quit',
  );
  assert.doesNotMatch(script, /Stop-Process -Name/);
});

test('post-install launch runs as the original user after an elevated installation', () => {
  const installer = fs.readFileSync(path.join(__dirname, 'installer/cat-cafe.iss'), 'utf8');
  const launch = installer.match(
    /; Offer to launch after interactive install[\s\S]*?Description: "Launch \{#MyAppName\}";[^\r\n]+/,
  );
  assert.ok(launch, 'production installer must keep a post-install launch entry');
  assert.match(launch[0], /Flags: postinstall nowait skipifsilent runasoriginaluser/);
});

test('installer uses the Windows Program Files default and does not bake a truncated path', () => {
  const installer = fs.readFileSync(path.join(__dirname, 'installer/cat-cafe.iss'), 'utf8');
  assert.match(installer, /DefaultDirName=\{autopf\}\\ClowderAI/);
  assert.doesNotMatch(installer, /DefaultDirName=.*C:\\Program(?:\\|$)/i);
});

test('isolated install records host client homes without copying credentials', () => {
  const script = fs.readFileSync(path.join(__dirname, 'scripts/configure-desktop-instance.ps1'), 'utf8');
  assert.match(script, /client-homes\.json/);
  for (const key of ['claude', 'codex', 'dsh', 'kimi', 'pi']) assert.match(script, new RegExp(`\\b${key}\\s*=`));
  assert.match(script, /Test-Path -LiteralPath \$target/);
  assert.match(script, /Move-Item -LiteralPath \$temporary -Destination \$target/);
  assert.doesNotMatch(script, /Copy-Item[^\r\n]+\.credentials|auth\.json/);
});
