import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { AgentPaneRegistry } from '../dist/domains/terminal/agent-pane-registry.js';
import { createTmuxSpawnOverride, spawnCliInTmux } from '../dist/domains/terminal/tmux-agent-spawner.js';
import { TmuxGateway } from '../dist/domains/terminal/tmux-gateway.js';

describe('spawnCliInTmux', () => {
  const WORKTREE = `test-agent-spawn-${Date.now()}`;
  let gateway;

  before(() => {
    gateway = new TmuxGateway();
  });

  after(async () => {
    await gateway.destroyServer(WORKTREE);
  });

  it('yields NDJSON events from a simple echo command', async () => {
    const events = [];
    // echo command that outputs two JSON lines
    const gen = spawnCliInTmux(
      {
        command: '/bin/sh',
        args: ['-c', 'echo \'{"type":"init","id":"t1"}\'; echo \'{"type":"done"}\''],
        worktreeId: WORKTREE,
        invocationId: 'test-inv-1',
        cwd: '/tmp',
      },
      { tmuxGateway: gateway },
    );

    for await (const event of gen) {
      events.push(event);
    }

    // First event should be pane creation metadata
    const paneEvent = events.find((e) => e.__tmuxPaneCreated);
    assert.ok(paneEvent, 'should yield __tmuxPaneCreated event');
    assert.ok(paneEvent.paneId, 'paneId should be set');
    assert.equal(paneEvent.worktreeId, WORKTREE);

    // Should have our two JSON events
    const jsonEvents = events.filter((e) => e.type);
    assert.ok(jsonEvents.length >= 2, `expected >=2 JSON events, got ${jsonEvents.length}`);
    assert.equal(jsonEvents[0].type, 'init');
    assert.equal(jsonEvents[0].id, 't1');
    assert.equal(jsonEvents[1].type, 'done');
  });

  it('reports non-zero exit code via __cliError', async () => {
    const events = [];
    const gen = spawnCliInTmux(
      {
        command: '/bin/sh',
        args: ['-c', 'echo \'{"type":"start"}\'; exit 42'],
        worktreeId: WORKTREE,
        invocationId: 'test-inv-2',
        cwd: '/tmp',
      },
      { tmuxGateway: gateway },
    );

    for await (const event of gen) {
      events.push(event);
    }

    const errEvent = events.find((e) => e.__cliError);
    assert.ok(errEvent, 'should yield __cliError on non-zero exit');
    assert.equal(errEvent.exitCode, 42);
  });

  it('exit code 0 does not yield __cliError', async () => {
    const events = [];
    const gen = spawnCliInTmux(
      {
        command: '/bin/sh',
        args: ['-c', 'echo \'{"type":"ok"}\'; exit 0'],
        worktreeId: WORKTREE,
        invocationId: 'test-inv-3',
        cwd: '/tmp',
      },
      { tmuxGateway: gateway },
    );

    for await (const event of gen) {
      events.push(event);
    }

    const errEvent = events.find((e) => e.__cliError);
    assert.equal(errEvent, undefined, 'should NOT yield __cliError on exit 0');
  });

  it('sets environment variables in pane', async () => {
    const events = [];
    const gen = spawnCliInTmux(
      {
        command: '/bin/sh',
        args: ['-c', 'echo "{\\"val\\":\\"$TEST_VAR\\"}"'],
        worktreeId: WORKTREE,
        invocationId: 'test-inv-4',
        cwd: '/tmp',
        env: { TEST_VAR: 'hello-tmux' },
      },
      { tmuxGateway: gateway },
    );

    for await (const event of gen) {
      events.push(event);
    }

    const valEvent = events.find((e) => e.val);
    assert.ok(valEvent, 'should have event with val field');
    assert.equal(valEvent.val, 'hello-tmux');
  });

  it('pane has remain-on-exit set', async () => {
    // Create an agent pane and verify remain-on-exit
    const paneId = await gateway.createAgentPane(WORKTREE, { cwd: '/tmp' });
    assert.ok(paneId, 'pane should be created');

    // Check tmux option
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const exec = promisify(execFile);
    const sock = gateway.socketName(WORKTREE);
    const { stdout } = await exec('tmux', ['-L', sock, 'show-option', '-t', paneId, 'remain-on-exit']);
    assert.match(stdout.trim(), /on/, 'remain-on-exit should be on');
  });
});

describe('createTmuxSpawnOverride', () => {
  const WORKTREE = `test-override-${Date.now()}`;
  let gateway;
  let registry;

  before(() => {
    gateway = new TmuxGateway();
    registry = new AgentPaneRegistry();
  });

  after(async () => {
    await gateway.destroyServer(WORKTREE);
  });

  it('override yields events and registers pane in AgentPaneRegistry', async () => {
    const invocationId = 'override-inv-1';
    const override = createTmuxSpawnOverride(WORKTREE, invocationId, 'test-user', gateway, registry);

    const events = [];
    for await (const event of override({
      command: '/bin/sh',
      args: ['-c', 'echo \'{"type":"hello"}\''],
    })) {
      events.push(event);
    }

    // Should have yielded events including __tmuxPaneCreated
    const paneEvent = events.find((e) => e.__tmuxPaneCreated);
    assert.ok(paneEvent, 'should yield __tmuxPaneCreated');

    // AgentPaneRegistry should have the pane registered
    const pane = registry.getByInvocation(invocationId);
    assert.ok(pane, 'pane should be registered');
    assert.equal(pane.worktreeId, WORKTREE);
    assert.equal(pane.status, 'running'); // markDone called by invoke-single-cat.ts, not override
  });

  it('override works without AgentPaneRegistry', async () => {
    const override = createTmuxSpawnOverride(WORKTREE, 'override-inv-2', 'test-user', gateway);

    const events = [];
    for await (const event of override({
      command: '/bin/sh',
      args: ['-c', 'echo \'{"type":"ok"}\''],
    })) {
      events.push(event);
    }

    const jsonEvents = events.filter((e) => e.type === 'ok');
    assert.equal(jsonEvents.length, 1);
  });
});
