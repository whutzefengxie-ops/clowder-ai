import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fail } from './config.mjs';
import { git } from './process.mjs';
import { equalEntry } from './trees.mjs';

const execute = promisify(execFile);
export async function mergeEntry(directory, folder, path, base, local, target, resolution) {
  if (resolution) return resolution.deleted ? undefined : resolution.entry;
  if (equalEntry(local, base)) return target;
  if (equalEntry(target, base) || equalEntry(local, target)) return local;
  if (!base || !local || !target) fail('CONTENT_CONFLICT', '新增或删除文件与另一侧修改冲突', { paths: [path] });
  if (![base, local, target].every((entry) => ['100644', '100755'].includes(entry.mode)))
    fail('CONTENT_CONFLICT', '该文件类型需要在内部手工处理', { paths: [path], editable: false });
  const mode = mergedMode(base.mode, local.mode, target.mode);
  if (!mode) fail('CONTENT_CONFLICT', '两侧文件权限修改冲突', { paths: [path], editable: false });
  await mkdir(folder, { recursive: true });
  const files = ['local', 'base', 'target'].map((name) => join(folder, name));
  for (const [index, entry] of [local, base, target].entries()) {
    const { stdout } = await execute('git', ['-C', directory, 'cat-file', 'blob', entry.object], {
      encoding: 'buffer',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    await writeFile(files[index], stdout);
  }
  let merged;
  try {
    merged = (
      await execute('git', ['merge-file', '-p', ...files], {
        encoding: 'buffer',
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
      })
    ).stdout;
  } catch (error) {
    if (typeof error.code === 'number')
      fail('CONTENT_CONFLICT', '共同修改文件不能自动合并，请选择版本或保存人工合并内容', { paths: [path] });
    fail('MERGE_FAILED', '三方合并执行失败，未推送候选分支');
  }
  const result = join(folder, 'merged');
  await writeFile(result, merged);
  return { mode, type: 'blob', object: await git(directory, ['hash-object', '-w', result]) };
}
function mergedMode(base, local, target) {
  if (local === base) return target;
  return target === base || local === target ? local : null;
}
