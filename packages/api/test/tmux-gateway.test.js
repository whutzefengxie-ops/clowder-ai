import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { TmuxGateway } from '../dist/domains/terminal/tmux-gateway.js';

describe('TmuxGateway', () => {
  const TEST_WORKTREE = `test-gw-${Date.now()}`;
  let gateway;

  before(() => {
    gateway = new TmuxGateway();
  });

  after(async () => {
    await gateway.destroyServer(TEST_WORKTREE);
  });

  it('socketName returns catcafe-prefixed name', () => {
    assert.equal(gateway.socketName('foo'), 'catcafe-foo');
  });

  it('ensureServer creates tmux server and returns socket name', async () => {
    const sock = await gateway.ensureServer(TEST_WORKTREE);
    assert.equal(sock, `catcafe-${TEST_WORKTREE}`);
  });

  it('createPane creates a pane and returns pane ID', async () => {
    const paneId = await gateway.createPane(TEST_WORKTREE, {
      cols: 80,
      rows: 24,
      cwd: '/tmp',
    });
    assert.ok(paneId, 'pane ID should be non-empty');
    assert.match(paneId, /^%\d+$/);
  });

  it('listPanes returns at least one pane', async () => {
    const panes = await gateway.listPanes(TEST_WORKTREE);
    assert.ok(panes.length >= 1);
    assert.ok(panes[0].paneId.startsWith('%'));
    assert.ok(panes[0].panePid > 0);
    assert.ok(panes[0].paneWidth > 0);
    assert.ok(panes[0].paneHeight > 0);
  });

  it('resizePane executes without error', async () => {
    const panes = await gateway.listPanes(TEST_WORKTREE);
    const paneId = panes[0].paneId;
    // tmux resize-pane is constrained by window size, so we just verify no throw
    await gateway.resizePane(TEST_WORKTREE, paneId, 60, 20);

    const updated = await gateway.listPanes(TEST_WORKTREE);
    const resized = updated.find((p) => p.paneId === paneId);
    assert.ok(resized, 'pane should still exist after resize');
  });

  it('sendKeys sends command to pane and capturePane reads output', async () => {
    const panes = await gateway.listPanes(TEST_WORKTREE);
    const paneId = panes[0].paneId;

    await gateway.sendKeys(TEST_WORKTREE, paneId, 'echo tmux-gateway-test-marker');
    // Give shell time to process
    await new Promise((r) => setTimeout(r, 600));

    const output = await gateway.capturePane(TEST_WORKTREE, paneId);
    assert.ok(
      output.includes('tmux-gateway-test-marker'),
      `output should contain marker, got: ${output.substring(0, 200)}`,
    );
  });

  it('killPane removes a specific pane', async () => {
    // Re-create server for this test
    await gateway.ensureServer(TEST_WORKTREE);
    const paneId = await gateway.createPane(TEST_WORKTREE, { cols: 80, rows: 24, cwd: '/tmp' });
    const before = await gateway.listPanes(TEST_WORKTREE);
    assert.ok(before.some((p) => p.paneId === paneId));

    await gateway.killPane(TEST_WORKTREE, paneId);
    // Small delay for tmux to process
    await new Promise((r) => setTimeout(r, 100));
    const after = await gateway.listPanes(TEST_WORKTREE);
    assert.ok(!after.some((p) => p.paneId === paneId), 'killed pane should be gone');
  });

  it('killPane on non-existent pane does not throw', async () => {
    await gateway.killPane(TEST_WORKTREE, '%9999');
    // Should not throw
  });

  it('destroyServer kills the tmux server', async () => {
    await gateway.destroyServer(TEST_WORKTREE);
    const panes = await gateway.listPanes(TEST_WORKTREE);
    assert.equal(panes.length, 0);
  });

  it('destroyServer on non-existent server does not throw', async () => {
    await gateway.destroyServer('nonexistent-server-xyz');
    // Should not throw
  });

  it('listPanes on non-existent server returns empty', async () => {
    const panes = await gateway.listPanes('nonexistent-server-xyz');
    assert.deepEqual(panes, []);
  });
});
