/**
 * TmuxAgentSpawner — runs CLI agents inside tmux panes with FIFO-based NDJSON streaming.
 *
 * 单源双消费: tmux pane (agent CLI | tee $FIFO)
 *   FIFO → parseNDJSON → yield events (机器侧)
 *   node-pty attach → WebSocket → xterm.js (人类侧, read-only)
 */

import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolveCliTimeoutMs } from '../../utils/cli-timeout.js';
import type { CliSpawnOptions } from '../../utils/cli-types.js';
import { isParseError, parseNDJSON } from '../../utils/ndjson-parser.js';
import type { SpawnCliOverride } from '../cats/services/types.js';
import type { AgentPaneRegistry } from './agent-pane-registry.js';
import type { TmuxGateway } from './tmux-gateway.js';

const execAsync = promisify(execFile);

export interface TmuxSpawnOptions extends CliSpawnOptions {
  worktreeId: string;
  invocationId: string;
}

export interface TmuxSpawnResult {
  paneId: string;
}
export interface TmuxSpawnDeps {
  tmuxGateway: TmuxGateway;
}

/** Escape for single-quoted shell: ' → '"'"' */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\"'\"'")}'`;
}

/** Build: set -o pipefail; command args 2>&1 | tee $FIFO; echo "EXIT:$?" > $EXIT_FILE */
function buildPaneCommand(opts: TmuxSpawnOptions, fifoPath: string, exitFilePath: string): string {
  const parts = [shellEscape(opts.command), ...opts.args.map(shellEscape)];
  // pipefail ensures $? reflects the CLI exit code, not tee's
  return `set -o pipefail; ${parts.join(' ')} 2>&1 | tee ${shellEscape(fifoPath)}; echo "EXIT:$?" > ${shellEscape(exitFilePath)}`;
}

/** Read exit code sentinel file with retry (race: FIFO EOF before file write) */
async function readExitCode(path: string, retries = 5): Promise<number | null> {
  const { readFile } = await import('node:fs/promises');
  for (let i = 0; i < retries; i++) {
    try {
      const match = /^EXIT:(\d+)$/.exec((await readFile(path, 'utf-8')).trim());
      if (match) return Number(match[1]);
    } catch {
      /* not yet written */
    }
    if (i < retries - 1) await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

/**
 * Spawn a CLI agent inside a tmux pane and yield NDJSON events via FIFO.
 * Same event format as spawnCli() — callers are agnostic to execution mode.
 */
export async function* spawnCliInTmux(
  options: TmuxSpawnOptions,
  deps: TmuxSpawnDeps,
): AsyncGenerator<unknown, TmuxSpawnResult, undefined> {
  const { tmuxGateway } = deps;
  const timeoutMs = resolveCliTimeoutMs(options.timeoutMs);

  const tmpDir = await mkdtemp(join(tmpdir(), `catcafe-agent-${options.invocationId}-`));
  const fifoPath = join(tmpDir, 'output.fifo');
  const exitFilePath = join(tmpDir, 'exit-code');
  await execAsync('mkfifo', [fifoPath]);

  const paneId = await tmuxGateway.createAgentPane(options.worktreeId, {
    ...(options.cwd ? { cwd: options.cwd } : {}),
  });

  // Inject environment variables into pane shell
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      if (value !== null && value !== undefined) {
        await tmuxGateway.execInPane(options.worktreeId, paneId, `export ${key}=${shellEscape(value)}`);
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  await tmuxGateway.execInPane(options.worktreeId, paneId, buildPaneCommand(options, fifoPath, exitFilePath));
  // Set read-only AFTER command starts (select-pane -d blocks send-keys if set before)
  await tmuxGateway.setPaneReadOnly(options.worktreeId, paneId, true);
  yield { __tmuxPaneCreated: true, paneId, worktreeId: options.worktreeId } as unknown;

  let timedOut = false;
  let killed = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  const killAgent = async (): Promise<void> => {
    if (killed) return;
    killed = true;
    const sock = tmuxGateway.socketName(options.worktreeId);
    const bin = tmuxGateway.tmuxBin;
    // Phase 1: Send C-c (graceful interrupt)
    try {
      await execAsync(bin, ['-L', sock, 'send-keys', '-t', paneId, 'C-c', '']);
    } catch {
      /* pane already dead — nothing to kill */
      return;
    }
    // Phase 2: Wait 3s grace, then force kill-pane if still alive
    await new Promise((r) => setTimeout(r, 3000));
    try {
      // Check if pane still exists before killing
      await execAsync(bin, ['-L', sock, 'list-panes', '-t', paneId]);
      await execAsync(bin, ['-L', sock, 'kill-pane', '-t', paneId]);
    } catch {
      /* pane exited during grace period — expected */
    }
  };

  const resetTimeout = (): void => {
    if (timeoutMs === 0) return;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = setTimeout(async () => {
      timedOut = true;
      await killAgent();
    }, timeoutMs);
    if (timeoutTimer && typeof timeoutTimer === 'object' && 'unref' in timeoutTimer) {
      timeoutTimer.unref();
    }
  };
  if (timeoutMs > 0) resetTimeout();

  const abortHandler = (): void => {
    killAgent().catch(() => {});
  };
  if (options.signal) {
    if (options.signal.aborted) await killAgent();
    else options.signal.addEventListener('abort', abortHandler, { once: true });
  }

  try {
    const fifoStream = createReadStream(fifoPath, { encoding: 'utf-8' });
    for await (const event of parseNDJSON(fifoStream)) {
      resetTimeout();
      if (isParseError(event)) {
        console.error(`[tmux-agent] JSON parse error: ${(event as { line: string }).line}`);
        continue;
      }
      yield event;
    }

    const exitCode = await readExitCode(exitFilePath);
    if (!killed && exitCode !== null && exitCode !== 0) {
      yield {
        __cliError: true,
        exitCode,
        signal: null,
        message: `CLI 异常退出 (code: ${exitCode}, tmux pane: ${paneId})`,
        command: options.command,
      };
    }
    if (timedOut) {
      yield {
        __cliTimeout: true,
        timeoutMs,
        message: `CLI 响应超时 (${Math.round(timeoutMs / 1000)}s, tmux pane: ${paneId})`,
        command: options.command,
      };
    }
    return { paneId };
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (options.signal) options.signal.removeEventListener('abort', abortHandler);
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Create a SpawnCliOverride that routes agent execution through tmux panes.
 * Called per-invocation in invoke-single-cat.ts when tmux is available.
 */
export function createTmuxSpawnOverride(
  worktreeId: string,
  invocationId: string,
  userId: string,
  tmuxGateway: TmuxGateway,
  agentPaneRegistry?: AgentPaneRegistry,
): SpawnCliOverride {
  return async function* tmuxOverride(cliOpts: CliSpawnOptions) {
    await tmuxGateway.ensureServer(worktreeId);
    const gen = spawnCliInTmux({ ...cliOpts, worktreeId, invocationId }, { tmuxGateway });

    let paneId: string | undefined;
    try {
      for (;;) {
        const { value, done } = await gen.next();
        if (done) {
          paneId = (value as TmuxSpawnResult | undefined)?.paneId ?? paneId;
          break;
        }
        // Intercept __tmuxPaneCreated to register with AgentPaneRegistry
        const ev = value as Record<string, unknown>;
        if (ev.__tmuxPaneCreated && typeof ev.paneId === 'string') {
          paneId = ev.paneId;
          agentPaneRegistry?.register(invocationId, worktreeId, paneId, userId);
        }
        yield value;
      }
    } catch (err) {
      agentPaneRegistry?.markCrashed(invocationId, err instanceof Error ? err.message : null);
      throw err;
    }
  };
}
