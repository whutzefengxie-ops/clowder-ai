import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** PID alone cannot distinguish a crashed writer from an unrelated reused PID. */
export function processBirthIdentity(pid: number): string {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid process identity PID');
  if (process.platform === 'linux') {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const ticks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    if (!ticks || !/^\d+$/.test(ticks)) throw new Error('Cannot read process birth identity');
    return `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${ticks}`;
  }
  const options = { encoding: 'utf8' as const, windowsHide: true, timeout: 5_000 };
  const birth =
    process.platform === 'win32'
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
  if (!birth) throw new Error('Cannot read process birth identity');
  return birth;
}
