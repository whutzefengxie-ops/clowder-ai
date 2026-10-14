const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

test(
  'installer hook sync targets an explicit owned profile, including original-user execution',
  { skip: process.platform !== 'win32' },
  () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-profile-'));
    const profile = path.join(base, 'profile');
    const result = path.join(base, 'target.json');
    fs.mkdirSync(path.join(base, 'scripts'), { recursive: true });
    fs.mkdirSync(profile);
    fs.writeFileSync(
      path.join(base, 'scripts/sync-agent-hooks-offline.mjs'),
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify(process.argv.slice(2)));`,
    );
    try {
      const run = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(__dirname, 'scripts/post-install-offline.ps1'),
          '-AppDir',
          base,
          '-AgentHooksOnly',
          '-UserProfileRoot',
          profile,
        ],
        { encoding: 'utf8', windowsHide: true },
      );
      assert.equal(run.status, 0, run.stderr);
      const args = JSON.parse(fs.readFileSync(result, 'utf8'));
      assert.equal(args[0], '--project-root');
      assert.equal(args[2], '--target-root');
      assert.equal(args.length, 4);
      // Windows PowerShell expands a short 8.3 TEMP spelling to the same long path.
      const identity = (directory) => {
        const stat = fs.statSync(directory, { bigint: true });
        return { device: stat.dev, inode: stat.ino };
      };
      assert.deepEqual(identity(args[1]), identity(base));
      assert.deepEqual(identity(args[3]), identity(profile));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  },
);
