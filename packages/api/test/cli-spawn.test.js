/**
 * CLI Spawn Tests
 * 测试 CLI 子进程管理器
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mock, test } from 'node:test';

const { spawnCli, isCliError, isCliTimeout, KILL_GRACE_MS } = await import('../dist/utils/cli-spawn.js');

/** Helper: collect all items from async iterable */
async function collect(iterable) {
  const items = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

/**
 * Create a mock child process for testing.
 * @param {{ exitOnKill?: boolean, exitCode?: number }} opts
 *   exitOnKill: if true (default), killing closes stdout and emits exit.
 *   exitCode: the code to emit on exit (default null for signal kills).
 */
function createMockProcess(opts = {}) {
  const { exitOnKill = true, exitCode = null } = opts;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter();
  const proc = {
    stdout,
    stderr,
    pid: 12345,
    exitCode: null,
    kill: mock.fn((signal) => {
      if (exitOnKill) {
        process.nextTick(() => {
          if (!stdout.destroyed) stdout.end();
          emitter.emit('exit', exitCode, signal || 'SIGTERM');
        });
      }
      return true;
    }),
    on: (event, listener) => {
      emitter.on(event, listener);
      return proc;
    },
    once: (event, listener) => {
      emitter.once(event, listener);
      return proc;
    },
    // Expose emitter for manual event emission in tests
    _emitter: emitter,
  };
  return proc;
}

/** Create a mock SpawnFn that returns the given mock process */
function createMockSpawnFn(mockProcess) {
  return mock.fn(() => mockProcess);
}

test('spawnCli yields parsed JSON events from stdout', async () => {
  const proc = createMockProcess();
  const spawnFn = createMockSpawnFn(proc);

  const promise = collect(spawnCli({ command: 'test-cli', args: ['--json'] }, { spawnFn }));

  proc.stdout.write('{"type":"start","id":"123"}\n');
  proc.stdout.write('{"type":"message","text":"hello"}\n');
  proc.stdout.end();
  // Emit clean exit
  proc._emitter.emit('exit', 0, null);

  const results = await promise;

  assert.equal(results.length, 2);
  assert.deepEqual(results[0], { type: 'start', id: '123' });
  assert.deepEqual(results[1], { type: 'message', text: 'hello' });

  // Verify spawn was called with correct args
  assert.equal(spawnFn.mock.callCount(), 1);
  assert.equal(spawnFn.mock.calls[0].arguments[0], 'test-cli');
  assert.deepEqual(spawnFn.mock.calls[0].arguments[1], ['--json']);
});

test('spawnCli does not yield stderr data', async () => {
  const proc = createMockProcess();
  const spawnFn = createMockSpawnFn(proc);

  const promise = collect(spawnCli({ command: 'test-cli', args: [] }, { spawnFn }));

  proc.stderr.write('DEBUG: some warning\n');
  proc.stdout.write('{"type":"ok"}\n');
  proc.stdout.end();
  proc._emitter.emit('exit', 0, null);

  const results = await promise;
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], { type: 'ok' });
});

test('spawnCli skips parse errors in stdout', async () => {
  const proc = createMockProcess();
  const spawnFn = createMockSpawnFn(proc);

  // Suppress console.error for this test
  const originalError = console.error;
  console.error = mock.fn();

  const promise = collect(spawnCli({ command: 'test-cli', args: [] }, { spawnFn }));

  proc.stdout.write('{"valid":true}\n');
  proc.stdout.write('not-json-line\n');
  proc.stdout.write('{"also":"valid"}\n');
  proc.stdout.end();
  proc._emitter.emit('exit', 0, null);

  const results = await promise;

  assert.equal(results.length, 2);
  assert.deepEqual(results[0], { valid: true });
  assert.deepEqual(results[1], { also: 'valid' });

  // Verify parse error was logged
  assert.ok(console.error.mock.callCount() > 0);

  console.error = originalError;
});

test('spawnCli kills process on timeout', async () => {
  const proc = createMockProcess();
  const spawnFn = createMockSpawnFn(proc);

  const promise = collect(spawnCli({ command: 'test-cli', args: [], timeoutMs: 50 }, { spawnFn }));

  // Don't write anything to stdout - let it timeout
  // Wait for timeout to fire, then close stdout
  await new Promise((resolve) => setTimeout(resolve, 100));
  proc.stdout.end();

  await promise;

  // Verify kill was called
  assert.ok(proc.kill.mock.callCount() >= 1);
  assert.equal(proc.kill.mock.calls[0].arguments[0], 'SIGTERM');
});

test('CLI_TIMEOUT_MS=0 disables timeout (no auto-kill on silence)', async () => {
  const saved = process.env.CLI_TIMEOUT_MS;
  process.env.CLI_TIMEOUT_MS = '0';
  try {
    const proc = createMockProcess();
    const spawnFn = createMockSpawnFn(proc);

    const promise = collect(spawnCli({ command: 'test-cli', args: [] }, { spawnFn }));

    // Wait longer than our typical small timeout values; should NOT auto-kill
    await new Promise((resolve) => setTimeout(resolve, 120));

    proc.stdout.end();
    proc._emitter.emit('exit', 0, null);

    await promise;

    assert.equal(proc.kill.mock.callCount(), 0, 'should not kill when timeout is disabled');
  } finally {
    if (saved === undefined) {
      delete process.env.CLI_TIMEOUT_MS;
    } else {
      process.env.CLI_TIMEOUT_MS = saved;
    }
  }
});

test('spawnCli uses 5 minute fallback timeout when CLI_TIMEOUT_MS is unset', async () => {
  const savedEnv = process.env.CLI_TIMEOUT_MS;
  delete process.env.CLI_TIMEOUT_MS;

  const proc = createMockProcess();
  const spawnFn = createMockSpawnFn(proc);
  const originalSetTimeout = global.setTimeout;
  const delays = [];

  global.setTimeout = (_handler, delay, ...args) => {
    delays.push(delay);
    return originalSetTimeout(() => {}, 0, ...args);
  };

  try {
    const promise = collect(spawnCli({ command: 'test-cli', args: [] }, { spawnFn }));

    proc.stdout.end();
    proc._emitter.emit('exit', 0, null);
    await promise;

    assert.ok(delays.length > 0);
    assert.equal(delays[0], 300000);
  } finally {
    global.setTimeout = originalSetTimeout;
    if (savedEnv === undefined) {
      delete process.env.CLI_TIMEOUT_MS;
    } else {
      process.env.CLI_TIMEOUT_MS = savedEnv;
    }
  }
});

test('spawnCli resets timeout on stderr activity (CLI alive signal)', async () => {
  const proc = createMockProcess();
  const spawnFn = createMockSpawnFn(proc);

  const promise = collect(spawnCli({ command: 'test-cli', args: [], timeoutMs: 50 }, { spawnFn }));

  // Keep the process "alive" with stderr output so it doesn't timeout
  await new Promise((resolve) => setTimeout(resolve, 20));
  proc.stderr.write('thinking...\n');
  await new Promise((resolve) => setTimeout(resolve, 20));
  proc.stderr.write('still working...\n');
  await new Promise((resolve) => setTimeout(resolve, 20));

  proc.stdout.write('{"type":"ok"}\n');
  proc.stdout.end();
  proc._emitter.emit('exit', 0, null);

  const results = await promise;

  assert.equal(proc.kill.mock.callCount(), 0, 'should not kill while stderr is active');
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], { type: 'ok' });
});

test('spawnCli kills process on abort signal', async () => {
  const proc = createMockProcess();
  const spawnFn = createMockSpawnFn(proc);
  const controller = new AbortController();

  const promise = collect(spawnCli({ command: 'test-cli', args: [], signal: controller.signal }, { spawnFn }));

  // Write one event then abort
  proc.stdout.write('{"type":"first"}\n');
  controller.abort();

  // Close stdout after abort
  await new Promise((resolve) => setTimeout(resolve, 50));
  proc.stdout.end();

  const results = await promise;

  // Should have the first event
  assert.ok(results.length >= 1);
  assert.deepEqual(results[0], { type: 'first' });

  // Verify kill was called
  assert.ok(proc.kill.mock.callCount() >= 1);
});

test('spawnCli cleans up on consumer break (early return)', async () => {
  const proc = createMockProcess();
  const spawnFn = createMockSpawnFn(proc);

  // Write data before iterating so the loop has something to break on
  proc.stdout.write('{"type":"first"}\n');
  proc.stdout.write('{"type":"second"}\n');

  const results = [];
  for await (const event of spawnCli({ command: 'test-cli', args: [] }, { spawnFn })) {
    results.push(event);
    if (results.length === 1) break; // Consumer stops early
  }

  assert.equal(results.length, 1);
  assert.deepEqual(results[0], { type: 'first' });

  // Verify kill was called (cleanup via finally)
  assert.ok(proc.kill.mock.callCount() >= 1);
});

test('spawnCli passes cwd and env to spawn', async () => {
  const proc = createMockProcess();
  const spawnFn = createMockSpawnFn(proc);

  const promise = collect(
    spawnCli(
      {
        command: 'claude',
        args: ['-p', 'hello'],
        cwd: '/some/project',
        env: { CUSTOM_VAR: 'value' },
      },
      { spawnFn },
    ),
  );

  proc.stdout.end();
  proc._emitter.emit('exit', 0, null);
  await promise;

  const spawnCall = spawnFn.mock.calls[0];
  assert.equal(spawnCall.arguments[0], 'claude');
  assert.deepEqual(spawnCall.arguments[1], ['-p', 'hello']);
  assert.equal(spawnCall.arguments[2].cwd, '/some/project');
  assert.equal(spawnCall.arguments[2].env.CUSTOM_VAR, 'value');
});

test('spawnCli removes inherited env vars when override is null', async () => {
  const saved = process.env.SPAWN_DELETE_ME;
  process.env.SPAWN_DELETE_ME = 'secret-value';

  const proc = createMockProcess();
  const spawnFn = createMockSpawnFn(proc);
  const promise = collect(
    spawnCli(
      {
        command: 'claude',
        args: ['-p', 'hello'],
        env: { SPAWN_DELETE_ME: null, KEEP_ME: '1' },
      },
      { spawnFn },
    ),
  );

  proc.stdout.end();
  proc._emitter.emit('exit', 0, null);
  await promise;

  const env = spawnFn.mock.calls[0].arguments[2].env;
  assert.equal(env.SPAWN_DELETE_ME, undefined);
  assert.equal(Object.hasOwn(env, 'SPAWN_DELETE_ME'), false);
  assert.equal(env.KEEP_ME, '1');

  if (saved === undefined) delete process.env.SPAWN_DELETE_ME;
  else process.env.SPAWN_DELETE_ME = saved;
});

test('spawnCli handles already-aborted signal', async () => {
  const proc = createMockProcess();
  const spawnFn = createMockSpawnFn(proc);
  const controller = new AbortController();
  controller.abort(); // Already aborted

  const promise = collect(spawnCli({ command: 'test-cli', args: [], signal: controller.signal }, { spawnFn }));

  proc.stdout.end();
  await promise;

  // Verify kill was called immediately
  assert.ok(proc.kill.mock.callCount() >= 1);
});

test('spawnCli handles empty stdout', async () => {
  const proc = createMockProcess();
  const spawnFn = createMockSpawnFn(proc);

  const promise = collect(spawnCli({ command: 'test-cli', args: [] }, { spawnFn }));

  proc.stdout.end();
  proc._emitter.emit('exit', 0, null);
  const results = await promise;

  assert.equal(results.length, 0);
});

// === New tests for 缅因猫 review findings ===

test('spawnCli yields __cliError on non-zero exit code >= 2 (stderr sanitized)', async () => {
  const proc = createMockProcess({ exitOnKill: false });
  const spawnFn = createMockSpawnFn(proc);

  const promise = collect(spawnCli({ command: 'test-cli', args: [] }, { spawnFn }));

  proc.stdout.write('{"type":"partial"}\n');
  proc.stderr.write('Error: something went wrong\n');
  proc.stdout.end();
  // Exit code 2 is always a hard error (not soft-exited)
  proc._emitter.emit('exit', 2, null);

  const results = await promise;

  assert.equal(results.length, 2);
  assert.deepEqual(results[0], { type: 'partial' });

  // Second result should be the CLI error with sanitized message
  assert.equal(isCliError(results[1]), true);
  assert.equal(results[1].exitCode, 2);
  assert.equal(results[1].command, 'test-cli');
  assert.ok(results[1].message.includes('code: 2'));
  assert.ok(!results[1].stderr, 'stderr should not be exposed to users');
});

test('spawnCli yields __cliError for exit code 1 even with valid output (no soft exit in spawnCli)', async () => {
  const proc = createMockProcess({ exitOnKill: false });
  const spawnFn = createMockSpawnFn(proc);

  const promise = collect(spawnCli({ command: 'codex', args: ['exec'] }, { spawnFn }));

  // spawnCli always reports non-zero exit as error — soft exit handling
  // is the caller's responsibility (e.g. CodexAgentService)
  proc.stdout.write('{"type":"review","text":"NEEDS_FIX"}\n');
  proc.stdout.end();
  proc._emitter.emit('exit', 1, null);

  const results = await promise;

  assert.equal(results.length, 2);
  assert.deepEqual(results[0], { type: 'review', text: 'NEEDS_FIX' });
  assert.equal(isCliError(results[1]), true);
  assert.equal(results[1].exitCode, 1);
});

test('spawnCli yields __cliError when killed by external signal (stderr sanitized)', async () => {
  const proc = createMockProcess({ exitOnKill: false });
  const spawnFn = createMockSpawnFn(proc);

  const promise = collect(spawnCli({ command: 'test-cli', args: [] }, { spawnFn }));

  proc.stderr.write('Killed by OOM\n');
  proc.stdout.end();
  // External signal kill: exitCode=null, signal=SIGKILL
  proc._emitter.emit('exit', null, 'SIGKILL');

  const results = await promise;

  assert.equal(results.length, 1);
  assert.equal(isCliError(results[0]), true);
  assert.equal(results[0].exitCode, null);
  assert.equal(results[0].signal, 'SIGKILL');
  assert.equal(results[0].command, 'test-cli');
  // message is sanitized — no raw stderr exposed (contains signal info, not raw stderr)
  assert.ok(results[0].message.includes('SIGKILL'));
  assert.ok(!results[0].stderr, 'stderr should not be exposed to users');
});

test('spawnCli yields __cliTimeout (not __cliError) on timeout kill', async () => {
  const proc = createMockProcess();
  const spawnFn = createMockSpawnFn(proc);

  const promise = collect(spawnCli({ command: 'test-cli', args: [], timeoutMs: 50 }, { spawnFn }));

  // Let timeout fire and kill the process
  await new Promise((resolve) => setTimeout(resolve, 100));
  proc.stdout.end();

  const results = await promise;

  // Should NOT contain a __cliError (we killed it via timeout)
  const hasCliError = results.some((r) => isCliError(r));
  assert.equal(hasCliError, false);

  // Should contain a __cliTimeout instead
  const hasTimeout = results.some((r) => isCliTimeout(r));
  assert.equal(hasTimeout, true);

  const timeout = results.find((r) => isCliTimeout(r));
  assert.equal(timeout.timeoutMs, 50);
  assert.equal(timeout.command, 'test-cli');
});

test('isCliError type guard works correctly', () => {
  assert.equal(isCliError({ __cliError: true, exitCode: 1, message: 'CLI 异常退出', command: 'x' }), true);
  assert.equal(isCliError({ __cliError: false }), false);
  assert.equal(isCliError({ type: 'message' }), false);
  assert.equal(isCliError(null), false);
  assert.equal(isCliError('string'), false);
});

test('isCliTimeout type guard works correctly', () => {
  assert.equal(isCliTimeout({ __cliTimeout: true, timeoutMs: 300000, message: 'CLI 响应超时', command: 'x' }), true);
  assert.equal(isCliTimeout({ __cliTimeout: false }), false);
  assert.equal(isCliTimeout({ __cliError: true }), false);
  assert.equal(isCliTimeout(null), false);
  assert.equal(isCliTimeout('string'), false);
});

test('AbortSignal cancel does NOT yield __cliTimeout', async () => {
  const proc = createMockProcess();
  const spawnFn = createMockSpawnFn(proc);
  const controller = new AbortController();

  const promise = collect(spawnCli({ command: 'test-cli', args: [], signal: controller.signal }, { spawnFn }));

  // Cancel via AbortSignal (not timeout)
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 50));
  proc.stdout.end();

  const results = await promise;

  const hasTimeout = results.some((r) => isCliTimeout(r));
  assert.equal(hasTimeout, false, 'User cancel should not yield __cliTimeout');
  const hasCliError = results.some((r) => isCliError(r));
  assert.equal(hasCliError, false, 'User cancel should not yield __cliError');
});

test('spawnCli escalates SIGTERM to SIGKILL after grace period', async () => {
  // Create a stubborn process that does NOT exit on SIGTERM
  const proc = createMockProcess({ exitOnKill: false });
  const spawnFn = createMockSpawnFn(proc);

  const promise = collect(spawnCli({ command: 'stubborn-cli', args: [], timeoutMs: 50 }, { spawnFn }));

  // Wait for timeout to fire SIGTERM
  await new Promise((resolve) => setTimeout(resolve, 100));

  // First kill should be SIGTERM
  assert.ok(proc.kill.mock.callCount() >= 1);
  assert.equal(proc.kill.mock.calls[0].arguments[0], 'SIGTERM');

  // Wait for KILL_GRACE_MS to elapse for escalation
  await new Promise((resolve) => setTimeout(resolve, KILL_GRACE_MS + 100));

  // Should have escalated to SIGKILL
  const killCalls = proc.kill.mock.calls;
  const signals = killCalls.map((c) => c.arguments[0]);
  assert.ok(signals.includes('SIGKILL'), `Expected SIGKILL in signals: ${signals}`);

  // Now actually exit the process so the generator resolves
  proc.stdout.end();
  proc._emitter.emit('exit', null, 'SIGKILL');

  await promise;
});

test('spawnCli handles spawn error (e.g. command not found)', async () => {
  const proc = createMockProcess({ exitOnKill: false });
  const spawnFn = createMockSpawnFn(proc);

  const gen = spawnCli({ command: 'nonexistent-command', args: [] }, { spawnFn });

  // Emit error before any stdout data
  process.nextTick(() => {
    const err = new Error('spawn nonexistent-command ENOENT');
    err.code = 'ENOENT';
    proc._emitter.emit('error', err);
    proc.stdout.end();
    proc._emitter.emit('exit', null, null);
  });

  await assert.rejects(
    async () => {
      for await (const _ of gen) {
        /* consume */
      }
    },
    (err) => {
      assert.ok(err.message.includes('ENOENT'));
      return true;
    },
  );
});
