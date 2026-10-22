import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, linkSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function birthIdentity(pid) {
  if (process.platform === 'linux') {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]}`;
  }
  const options = { encoding: 'utf8', windowsHide: true, timeout: 5000 };
  return process.platform === 'win32'
    ? execFileSync(
        join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(
            `$ErrorActionPreference='Stop'; [Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToUniversalTime().Ticks`,
            'utf16le',
          ).toString('base64'),
        ],
        options,
      ).trim()
    : execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], {
        ...options,
        env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
      }).trim();
}

export function recoverPreparationLock(path, readOptional) {
  const captured = readOptional(path);
  if (captured === undefined) return;
  const owner = JSON.parse(captured);
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0)
    throw new Error('Unknown preparation lock; preserve it for diagnosis');
  if (owner.birth !== undefined && (typeof owner.birth !== 'string' || !owner.birth))
    throw new Error('Unknown preparation lock birth identity; preserve it for diagnosis');
  let dead = false;
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
    dead = true;
  }
  if (!dead && (!owner.birth || birthIdentity(owner.pid) === owner.birth))
    throw new Error('Preparation lock belongs to a live or unknown process');
  if (readOptional(path) !== captured) throw new Error('Preparation lock changed; retry without modifying it');
  renameSync(path, `${path}.retained-${randomUUID()}`);
}

/** Publish only a complete, flushed record; hard-link creation fails if a lock already exists. */
export function acquirePreparationLock(path) {
  const contents = JSON.stringify({
    pid: process.pid,
    birth: birthIdentity(process.pid),
    purpose: 'explicit intranet preparation',
  });
  const temporary = `${path}.pending-${randomUUID()}`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temporary, path);
  } finally {
    unlinkSync(temporary);
  }
  return () => {
    if (readFileSync(path, 'utf8') !== contents) throw new Error('Preparation lock ownership changed');
    unlinkSync(path);
  };
}
