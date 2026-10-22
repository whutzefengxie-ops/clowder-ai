import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertPlainPath(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Refusing linked deployment path: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (dirname(current) === current) break;
  }
}

export function readOptional(path) {
  assertPlainPath(path);
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Same-volume replace; Windows ReplaceFile preserves the replaced file's security descriptor. */
export function atomicWrite(path, contents, expected) {
  assertPlainPath(path);
  if (expected !== undefined && readOptional(path) !== expected)
    throw new Error('Deployment file changed; retry preparation');
  const temporary = `${path}.prepare-${randomUUID()}`;
  const fd = openSync(temporary, 'wx', existsSync(path) ? lstatSync(path).mode & 0o777 : 0o600);
  try {
    writeFileSync(fd, contents, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    if (readOptional(path) !== expected) throw new Error('Deployment file changed; retry preparation');
    if (process.platform === 'win32' && expected !== undefined) {
      const script =
        "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $p=[Console]::In.ReadToEnd()|ConvertFrom-Json; [IO.File]::Replace([string]$p.source,[string]$p.target,[System.Management.Automation.Language.NullString]::Value)";
      execFileSync(
        join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        {
          input: JSON.stringify({ source: temporary, target: path }),
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
    } else renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export async function defaultPreparationAdapters(hostRoot) {
  const fromApi = (relative) => import(pathToFileURL(join(hostRoot, 'packages/api/dist', relative)).href);
  const [{ EventAuditLog }, { resolveCatCafeDataRoot }] = await Promise.all([
    fromApi('domains/cats/services/orchestration/EventAuditLog.js'),
    fromApi('utils/cli-process-ownership.js'),
  ]).catch(() => {
    throw new Error(
      'Build the target Host API before preparing its deployment; no deployment configuration was changed',
    );
  });
  const writer = (auditDirectory) => new EventAuditLog({ auditDir: auditDirectory });
  return {
    resolveDataRoot: resolveCatCafeDataRoot,
    appendAudit: async ({ auditDirectory, event }) => writer(auditDirectory).append(event),
    lookupAudit: async ({ auditDirectory, preparationId }) => {
      const log = writer(auditDirectory);
      if (!existsSync(auditDirectory)) return false;
      for (const filename of await log.listFiles()) {
        const date = filename.slice(6, -7);
        if (
          (await log.readByDate(date)).some(
            (event) => event.type === 'host.deployment.audit-readiness' && event.data.preparationId === preparationId,
          )
        )
          return true;
      }
      return false;
    },
  };
}
