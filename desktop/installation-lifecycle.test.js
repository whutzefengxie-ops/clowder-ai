const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { spawn, execFileSync } = require('node:child_process');

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
      QUIT_FOR_UPDATE_ARG: '--quit-for-update',
      dbg: () => {},
      quitApp: () => {
        quits++;
      },
      mainWindow: null,
      isInstallationShutdownRequest: (...args) =>
        require('./installation-lifecycle').isInstallationShutdownRequest(...args),
    };
    vm.runInNewContext(source.slice(start, end), context);
    const args = ['exe', '--quit-for-update'];
    handler(null, args, '', { installRoot: path.join(base, 'other'), userDataRoot: userData });
    handler(null, args, '', { installRoot: root, userDataRoot: path.join(base, 'other-data') });
    handler(null, args, '', undefined);
    assert.equal(quits, 0, 'foreign or missing identity cannot shut down this app');
    handler(null, args, '', { installRoot: root, userDataRoot: userData });
    assert.equal(quits, 1);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

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
        JSON.parse(execFileSync('powershell.exe', [...args, '-InspectOnly'], { encoding: 'utf8' }).trim()),
        children[0].pid,
      );
      execFileSync('powershell.exe', [...args, '-WaitSeconds', '0'], { timeout: 10000 });
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
  assert.doesNotMatch(installer, /Stop-Process -Name/);
  assert.match(installer, /\[UninstallRun\][\s\S]*stop-installed-desktop\.ps1/);
  assert.match(installer, /PrepareToInstall[\s\S]*stop-installed-desktop\.ps1/);
  const script = fs.readFileSync(path.join(__dirname, 'scripts/stop-installed-desktop.ps1'), 'utf8');
  assert.match(script, /StartsWith\(\$installPrefix, \[System\.StringComparison\]::OrdinalIgnoreCase\)/);
  assert.match(script, /--quit-for-update/);
  assert.doesNotMatch(script, /Stop-Process -Name/);
});
