import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBinaryRoot } from '../../../../../config/capabilities/capability-orchestrator.js';
import { MCP_CALLBACK_ENV_KEYS } from '../../../../../config/capabilities/mcp-constants.js';
import { resolveKimiRuntimePaths } from '../../../../../utils/kimi-cli-runtime.js';
import { resolveProviderMcpConfig } from './provider-mcp-config.js';

export interface KimiMcpLease {
  env: Record<string, string>;
  dispose(): Promise<void>;
}

/** Kimi Code has no invoke-time MCP flag: lend it a native project config.
 * Keep the original file intact under a recoverable name until the client exits.
 * A second invocation must not replace the first invocation's capability surface.
 */
export async function prepareKimiMcpConfig(input: {
  callbackEnv?: Record<string, string>;
  workingDirectory?: string;
  mcpServerPath?: string;
}): Promise<KimiMcpLease> {
  const noop: KimiMcpLease = { env: {}, dispose: async () => {} };
  if (!input.callbackEnv?.CAT_CAFE_CAT_ID || input.mcpServerPath === '') return noop;
  if (!input.workingDirectory) throw new Error('Kimi MCP injection requires an explicit working directory');
  const binaryRoot = resolveBinaryRoot(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../../..'));
  const servers = await resolveProviderMcpConfig({
    ...input,
    callbackEnv: input.callbackEnv,
    mcpServerPath: input.mcpServerPath ?? join(binaryRoot, 'packages/mcp-server/dist/index.js'),
    provider: 'kimi',
  });
  // MCP children inherit this invocation's environment. Never persist callback credentials.
  for (const entry of Object.values(servers)) {
    if (entry.env && typeof entry.env === 'object') {
      const env = { ...(entry.env as Record<string, string>) };
      for (const key of MCP_CALLBACK_ENV_KEYS) delete env[key];
      entry.env = env;
    }
  }
  // Project entries shadow native HOME entries. Explicitly block native-only
  // servers so the managed invocation cannot bypass the capability registry.
  const nativeFile = join(resolveKimiRuntimePaths(input.callbackEnv).shareDir, 'mcp.json');
  const nativeRaw = await readFile(nativeFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (nativeRaw) {
    const native = JSON.parse(nativeRaw) as { mcpServers?: Record<string, unknown> };
    for (const name of Object.keys(native.mcpServers ?? {})) {
      if (!(name in servers)) servers[name] = { enabled: false };
    }
  }
  const directory = join(input.workingDirectory, '.kimi-code');
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Refusing a linked Kimi MCP directory');
  const file = join(directory, 'mcp.json');
  const lock = join(directory, '.clowder-mcp.lock');
  const backup = join(directory, `.clowder-mcp-original-${randomUUID()}.json`);
  const handle = await open(lock, 'wx', 0o600).catch(() => {
    throw new Error(`Kimi MCP workspace is in use or requires recovery: ${lock}`);
  });
  let original = false;
  let installed = false;
  const rendered = `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, file, backup }));
    await handle.close();
    const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (stat) {
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) {
        throw new Error('Refusing a linked or non-file Kimi MCP configuration');
      }
      await rename(file, backup);
      original = true;
    }
    await writeFile(file, rendered, { flag: 'wx', mode: 0o600 });
    installed = true;
  } catch (error) {
    await handle.close().catch(() => {});
    if (original && !installed) {
      const occupied = await lstat(file).catch((failure: NodeJS.ErrnoException) => {
        if (failure.code !== 'ENOENT') throw failure;
        return null;
      });
      if (occupied)
        throw new Error(`Kimi MCP installation conflicted; original preserved at ${backup}`, { cause: error });
      await rename(backup, file);
    }
    await unlink(lock);
    throw error;
  }
  let disposed = false;
  return {
    // Only the capability set resolved by Clowder is written to this project file.
    // This trust applies to the managed child process, never to the user's native HOME.
    env: { KIMI_CODE_TRUST_WORKSPACE: '1' },
    async dispose() {
      if (disposed) return;
      if ((await readFile(file, 'utf8')) !== rendered) {
        throw new Error(`Kimi MCP configuration changed during invocation; original preserved at ${backup}`);
      }
      await unlink(file);
      if (original) await rename(backup, file);
      await unlink(lock);
      disposed = true;
    },
  };
}
