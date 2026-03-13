/**
 * CLI Process Spawner
 * 通用 CLI 子进程管理器，处理生命周期、超时和清理
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { resolveCliTimeoutMs } from './cli-timeout.js';
import type { ChildProcessLike, CliSpawnOptions, SpawnFn } from './cli-types.js';
import { isParseError, parseNDJSON } from './ndjson-parser.js';

type CliErrorReasonCode = 'invalid_thinking_signature';

function classifyKnownCliStderr(stderr: string): CliErrorReasonCode | undefined {
  if (/Invalid [`'"]?signature[`'"]? in [`'"]?thinking[`'"]? block/i.test(stderr)) {
    return 'invalid_thinking_signature';
  }
  return undefined;
}

/** Grace period between SIGTERM and SIGKILL */
export const KILL_GRACE_MS = 3_000;

/**
 * Options for spawnCli (dependency injection for testing)
 */
export interface CliSpawnerDeps {
  /** Inject a custom spawn function (for testing) */
  spawnFn?: SpawnFn;
}

function buildChildEnv(overrides?: Record<string, string | null>): NodeJS.ProcessEnv {
  if (!overrides) return process.env;
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete merged[key];
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

/**
 * Spawns a CLI process and yields parsed NDJSON events from stdout.
 *
 * Handles: NDJSON parsing, stderr buffering (for debug logging only),
 * timeout with SIGTERM->SIGKILL, AbortSignal, cleanup on generator return,
 * zombie prevention.
 *
 * On non-zero exit: yields `{ __cliError, exitCode, signal, message }`.
 *   No exceptions — callers that want to suppress specific exit codes
 *   should handle `isCliError()` events in their own loop.
 * On timeout: yields `{ __cliTimeout, timeoutMs, message }`.
 * Note: `message` is sanitized for user display; raw stderr is logged to
 * console only (never exposed to users).
 *
 * On spawn error (e.g. ENOENT): throws.
 */
export async function* spawnCli(
  options: CliSpawnOptions,
  deps?: CliSpawnerDeps,
): AsyncGenerator<unknown, void, undefined> {
  const doSpawn: SpawnFn = deps?.spawnFn ?? defaultSpawn;
  // Default timeout is configurable via CLI_TIMEOUT_MS env var; 0 disables timeout.
  const timeoutMs = resolveCliTimeoutMs(options.timeoutMs);

  const child = doSpawn(options.command, options.args, {
    cwd: options.cwd,
    env: buildChildEnv(options.env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Buffer stderr for error reporting (handler attached after resetTimeout is defined)
  let stderrBuffer = '';

  // Track child exit state (P1: prevents PID reuse kills)
  let childExited = false;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;

  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', (code, signal) => {
      childExited = true;
      exitCode = code;
      exitSignal = signal;
      resolve();
    });
  });

  // Handle spawn errors (P2: ENOENT for command-not-found)
  let spawnError: Error | undefined;
  child.once('error', (err: Error) => {
    spawnError = err;
  });

  let killed = false;
  let timedOut = false;
  let escalationTimer: ReturnType<typeof setTimeout> | undefined;

  function killChild(): void {
    if (killed || childExited) return;
    killed = true;
    child.kill('SIGTERM');
    escalationTimer = setTimeout(() => {
      child.kill('SIGKILL');
    }, KILL_GRACE_MS);
    escalationTimer.unref();
    child.on('exit', () => {
      if (escalationTimer !== undefined) clearTimeout(escalationTimer);
    });
  }

  // Timeout (distinct from user cancel via AbortSignal)
  // Reset on any output — only triggers if CLI goes completely silent
  // timeoutMs = 0 disables timeout (rely on user cancel)
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  const resetTimeout = (): void => {
    if (timeoutMs === 0) return; // Disabled
    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, timeoutMs);
    timeoutTimer.unref();
  };
  if (timeoutMs > 0) resetTimeout(); // Start initial timeout only if enabled

  // Attach stderr handler now that resetTimeout is defined
  // Reset timeout on stderr activity — CLI is alive (working on tools, thinking, etc.)
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
    resetTimeout();
  });

  // AbortSignal
  const abortHandler = (): void => killChild();
  if (options.signal) {
    if (options.signal.aborted) {
      killChild();
    } else {
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }
  }

  // Zombie prevention (P1: guard with childExited to prevent PID reuse kills)
  const exitHandler = (): void => {
    if (!childExited && child.pid !== undefined) {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        // Process already gone
      }
    }
  };
  process.on('exit', exitHandler);

  try {
    if (!child.stdout) {
      throw new Error(`CLI process ${options.command} has no stdout`);
    }

    // Throw on spawn error before iterating
    if (spawnError) {
      throw spawnError;
    }

    for await (const event of parseNDJSON(child.stdout)) {
      if (spawnError) throw spawnError;
      // Reset timeout on any output — CLI is still alive
      resetTimeout();
      if (isParseError(event)) {
        const parseErr = event as { line: string };
        console.error(`[cli-spawn] JSON parse error from ${options.command}: ${parseErr.line}`);
        continue;
      }
      yield event;
    }

    // Check for spawn error that arrived during/after iteration
    if (spawnError) throw spawnError;

    // Wait for child to fully exit after stdout closes
    await exitPromise;

    // Yield error on abnormal exit (only if WE didn't kill it)
    // Covers both non-zero exitCode AND external signal kills
    if (!killed && (exitCode !== 0 || exitSignal !== null)) {
      const reasonCode = classifyKnownCliStderr(stderrBuffer);
      // Log stderr for debugging (never expose to users — may contain thinking/traces)
      if (stderrBuffer.trim()) {
        console.error(`[cli-spawn] ${options.command} stderr (debug only):\n${stderrBuffer.trim().slice(-1000)}`);
      }
      yield {
        __cliError: true,
        exitCode,
        signal: exitSignal,
        // Sanitized message — no raw stderr exposed to users
        message: `CLI 异常退出 (code: ${exitCode ?? 'null'}, signal: ${exitSignal ?? 'none'})`,
        command: options.command,
        ...(reasonCode ? { reasonCode } : {}),
      };
    }

    // Yield timeout error (distinct from user cancel which stays silent)
    if (timedOut) {
      // Log stderr for debugging (never expose to users)
      if (stderrBuffer.trim()) {
        console.error(
          `[cli-spawn] ${options.command} stderr on timeout (debug only):\n${stderrBuffer.trim().slice(-1000)}`,
        );
      }
      yield {
        __cliTimeout: true,
        timeoutMs,
        // Sanitized message — no raw stderr exposed to users
        message: `CLI 响应超时 (${Math.round(timeoutMs / 1000)}s)`,
        command: options.command,
      };
    }
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (escalationTimer !== undefined) clearTimeout(escalationTimer);
    if (options.signal) {
      options.signal.removeEventListener('abort', abortHandler);
    }
    process.off('exit', exitHandler);
    killChild();
  }
}

/**
 * Type guard for CLI error objects (abnormal exit or external signal kill)
 * Note: `message` is sanitized for user display; raw stderr is logged to console only.
 */
export function isCliError(value: unknown): value is {
  __cliError: true;
  exitCode: number | null;
  signal: string | null;
  message: string;
  command: string;
  reasonCode?: CliErrorReasonCode;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__cliError' in value &&
    (value as Record<string, unknown>).__cliError === true
  );
}

/**
 * Type guard for CLI timeout objects (process killed due to timeout)
 * Note: `message` is sanitized for user display; raw stderr is logged to console only.
 */
export function isCliTimeout(
  value: unknown,
): value is { __cliTimeout: true; timeoutMs: number; message: string; command: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__cliTimeout' in value &&
    (value as Record<string, unknown>).__cliTimeout === true
  );
}

/**
 * Default spawn function wrapping child_process.spawn
 */
function defaultSpawn(
  command: string,
  args: readonly string[],
  options: {
    cwd?: string | undefined;
    env?: NodeJS.ProcessEnv | undefined;
    stdio: ['ignore', 'pipe', 'pipe'];
  },
): ChildProcessLike {
  return nodeSpawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio,
  });
}
