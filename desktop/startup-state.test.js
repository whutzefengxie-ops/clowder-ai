const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createStartupReporter } = require('./startup-state');
test('a supervisor can read terminal failure before any UI action, without stale process identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-state-'));
  try {
    const report = createStartupReporter(root);
    report('starting');
    report('failed', 'API exited before ready');
    const state = JSON.parse(fs.readFileSync(path.join(root, 'startup-state.json')));
    assert.equal(state.phase, 'failed');
    assert.equal(state.pid, process.pid);
    assert.equal(state.message, 'API exited before ready');
    assert.ok(state.updatedAt >= state.startedAt);
    const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
    const startupFailure = main.slice(main.indexOf('startAll() FAILED:'), main.indexOf("app.on('window-all-closed'"));
    assert.match(startupFailure, /reportStartup\('failed'/);
    assert.doesNotMatch(startupFailure, /showErrorBox/);
    assert.match(startupFailure, /await dialog.showMessageBox/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
