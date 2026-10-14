const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { extractRuntimeArchive } = require('./scripts/extract-runtime-archive.cjs');
const npmCli = path.join(
  path.dirname(process.execPath),
  process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js',
);
const tar = createRequire(npmCli)('tar');

test('keeps Unicode runtime files and fails on missing/unknown payloads', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-extraction-'));
  try {
    const input = path.join(root, 'input');
    fs.mkdirSync(path.join(input, '中文目录'), { recursive: true });
    fs.writeFileSync(path.join(input, '中文目录/snow ☃.txt'), 'unicode witness');
    fs.writeFileSync(path.join(input, 'Clowder AI.exe'), 'entry witness');
    fs.mkdirSync(path.join(root, 'bundled/archives'), { recursive: true });
    await tar.c({ file: path.join(root, 'bundled/archives/electron.tar.gz'), gzip: true, cwd: input }, ['.']);
    const events = [];
    await extractRuntimeArchive(root, 'electron.tar.gz', tar, { onProgress: (event) => events.push(event) });
    assert.equal(events[0]?.status, 'start');
    assert.equal(events.at(-1)?.status, 'complete');
    assert.ok(events.at(-1).entries >= 3);
    assert.equal(fs.readFileSync(path.join(root, 'desktop-dist/中文目录/snow ☃.txt'), 'utf8'), 'unicode witness');
    await assert.rejects(extractRuntimeArchive(root, 'unknown.tar.gz', tar), /Unknown/);
    await assert.rejects(extractRuntimeArchive(root, 'deploy-api.tar.gz', tar), /ENOENT/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer extracts bundled Node first and stops on any extraction error', () => {
  const script = fs.readFileSync(path.join(__dirname, 'installer/cat-cafe.iss'), 'utf8');
  assert.ok(
    script.indexOf("AfterInstall: ExtractRuntimeArchive('node.tar.gz')") <
      script.indexOf("AfterInstall: ExtractRuntimeArchive('deploy-api.tar.gz')"),
  );
  assert.match(script, /ExitCode <> 0[\s\S]*RaiseException/);
  assert.match(script, /extract-runtime-archive\.cjs/);
});

test('an existing entry cannot make a newly incomplete upgrade archive succeed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-upgrade-'));
  try {
    const input = path.join(root, 'input');
    fs.mkdirSync(input);
    fs.writeFileSync(path.join(input, 'NOTICE.txt'), 'new payload');
    fs.mkdirSync(path.join(root, 'desktop-dist'));
    const entry = path.join(root, 'desktop-dist/Clowder AI.exe');
    fs.writeFileSync(entry, 'existing installation');
    fs.mkdirSync(path.join(root, 'bundled/archives'), { recursive: true });
    await tar.c({ file: path.join(root, 'bundled/archives/electron.tar.gz'), gzip: true, cwd: input }, ['.']);
    await assert.rejects(extractRuntimeArchive(root, 'electron.tar.gz', tar), /Incomplete runtime archive/);
    assert.equal(fs.readFileSync(entry, 'utf8'), 'existing installation');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
