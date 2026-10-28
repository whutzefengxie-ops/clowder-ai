import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/** Fixed current-instance logger root only. No model paths, env dump, SQLite, or conversation files. */
export async function collectDiagnosticLogs(logDirectory: string, now = Date.now()): Promise<string> {
  try {
    const root = await realpath(logDirectory);
    if (root !== resolve(logDirectory)) throw new Error('Log directory link refused');
    const candidates = (await readdir(root, { withFileTypes: true })).filter(
      (e) => e.isFile() && /^api.*\.log$/.test(e.name),
    );
    const files = await Promise.all(
      candidates.map(async (entry) => ({ path: join(root, entry.name), stat: await lstat(join(root, entry.name)) })),
    );
    const lines: string[] = [];
    for (const file of files
      .filter((f) => !f.stat.isSymbolicLink() && f.stat.mtimeMs >= now - 900_000)
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
      .slice(0, 2)) {
      if (!(await realpath(file.path)).startsWith(root + sep)) continue;
      const handle = await open(file.path, 'r');
      try {
        const size = Math.min((await handle.stat()).size, 131_072);
        const bytes = Buffer.alloc(size);
        await handle.read(bytes, 0, size, Math.max(0, file.stat.size - size));
        for (const line of bytes.toString('utf8').split('\n')) {
          try {
            const row = JSON.parse(line) as Record<string, unknown>;
            const timestamp = typeof row.time === 'number' ? row.time : Date.parse(String(row.time));
            if (!(timestamp >= now - 900_000 && timestamp <= now) || Number(row.level) < 40) continue;
            const err = row.err && typeof row.err === 'object' ? (row.err as Record<string, unknown>) : {};
            lines.push(
              JSON.stringify({
                time: new Date(timestamp).toISOString(),
                level: row.level,
                code: row.code ?? err.code,
                message: String(row.msg ?? '').slice(0, 500),
                errorType: err.type,
              }),
            );
          } catch {
            /* Incomplete tail/non-JSON records are excluded, never uploaded wholesale. */
          }
        }
      } finally {
        await handle.close();
      }
    }
    return (
      lines.slice(-48).join('\n').slice(0, 32_000) ||
      '最近 15 分钟内未采集到可用的结构化 warning/error 记录；不代表没有错误。'
    );
  } catch {
    return '当前实例日志不可读取；没有采集原始日志。';
  }
}
