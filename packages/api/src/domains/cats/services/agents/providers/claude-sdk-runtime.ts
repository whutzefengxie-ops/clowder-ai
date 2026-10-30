import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname } from 'node:path';
import { formatCliNotFoundError, resolveCliCommand } from '../../../../../utils/cli-resolve.js';
import { findSystemNode, resolveCmdShimScript } from '../../../../../utils/cli-spawn-win.js';

/** Discovery never starts a model or installs software. Shared with native CLI discovery. */
export function captureClaudeSdkRuntime(command = 'claude') {
  const selected = resolveCliCommand(command);
  if (!selected) throw new Error(`claude_runtime_missing: ${formatCliNotFoundError('claude')}`);
  const entry = /\.(?:cmd|bat)$/i.test(selected) ? resolveCmdShimScript(selected) : selected;
  if (!entry) throw new Error('claude_runtime_invalid_shim: 请重新安装 Claude Code 或提供可解析的客户端入口。');
  const path = realpathSync(entry);
  const executable = /\.[cm]?js$/i.test(path) ? findSystemNode() : undefined;
  if (/\.[cm]?js$/i.test(path) && !executable) throw new Error('claude_runtime_node_missing: 请安装 Node.js。');
  const probe = spawnSync(executable ?? path, [...(executable ? [path] : []), '--version'], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  const version = probe.status === 0 ? probe.stdout.match(/^(\d+\.\d+\.\d+)\s+\(Claude Code\)/m)?.[1] : undefined;
  if (!version) throw new Error('claude_runtime_version_failed: 无法核验外部 Claude Code 版本，请检查或更新客户端。');
  return Object.freeze({
    path,
    ...(executable ? { executable } : {}),
    version,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  });
}

/** Do not substitute a newly discovered installation after admission. */
export function verifyClaudeSdkRuntime(runtime: ReturnType<typeof captureClaudeSdkRuntime>) {
  if (createHash('sha256').update(readFileSync(runtime.path)).digest('hex') !== runtime.sha256)
    throw new Error('claude_runtime_changed: Claude Code 在准入后发生变化，请重新发起任务。');
}

/** Conversation and model discovery must drive the same selected program. */
export function claudeSdkRuntimeOptions(runtime: ReturnType<typeof captureClaudeSdkRuntime>, env: NodeJS.ProcessEnv) {
  verifyClaudeSdkRuntime(runtime);
  if (!runtime.executable) return { pathToClaudeCodeExecutable: runtime.path, env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  return {
    pathToClaudeCodeExecutable: runtime.path,
    executable: 'node' as const,
    env: { ...env, [pathKey]: [dirname(runtime.executable), env[pathKey]].filter(Boolean).join(delimiter) },
  };
}
