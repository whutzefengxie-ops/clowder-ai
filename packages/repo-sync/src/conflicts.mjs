import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fail } from './config.mjs';
import { git } from './process.mjs';
import { entries } from './trees.mjs';
import { requireVersion } from './version.mjs';

const execute = promisify(execFile);
function current(receiver, state, path) {
  requireVersion(receiver);
  const delivery = receiver.requireActive(state);
  if (
    delivery.candidate ||
    delivery.status !== 'CODE_PREPARE_REQUIRED' ||
    delivery.error?.code !== 'CONTENT_CONFLICT' ||
    !delivery.error.details?.paths.includes(path) ||
    !receiver.config.mergePaths.includes(path)
  )
    fail('RESOLUTION_NOT_ALLOWED', '只能处理当前未发布候选中明确列出的共同文件冲突');
  return delivery;
}
async function versions(receiver, delivery, path) {
  const refs = [delivery.base.upstream, delivery.base.internal, delivery.target];
  return Promise.all(refs.map(async (ref) => (await entries(receiver.git.directory, ref)).get(path)));
}
export async function readConflict(receiver, path) {
  return receiver.store.locked(async () => {
    const delivery = current(receiver, await receiver.read(), path);
    const list = await versions(receiver, delivery, path);
    const result = { path, editable: true };
    for (const [index, name] of ['base', 'internal', 'upstream'].entries()) {
      const preview = await blobPreview(receiver.git.directory, list[index]);
      result[name] = preview.content;
      result.editable &&= preview.editable;
    }
    return result;
  });
}
export async function resolveConflict(receiver, path, choice, content) {
  return receiver.change(async (state) => {
    const delivery = current(receiver, state, path);
    const list = await versions(receiver, delivery, path);
    let entry;
    if (choice === 'internal') entry = list[1];
    else if (choice === 'upstream') entry = list[2];
    else if (choice === 'manual') {
      entry = await manualResolution(receiver, delivery, list, content);
    } else fail('INVALID_RESOLUTION', '请选择内部版本、上游版本或人工合并内容');
    delivery.resolutions ??= {};
    delivery.resolutions[path] = entry ? { entry, choice } : { deleted: true, choice };
    delivery.error.details.paths = delivery.error.details.paths.filter((item) => item !== path);
    if (!delivery.error.details.paths.length) delete delivery.error;
  }, true);
}
async function blobPreview(directory, entry) {
  if (!entry) return { content: '', editable: true };
  if (!['100644', '100755'].includes(entry.mode)) return { content: '此类型仅支持选择一侧版本', editable: false };
  const size = Number(await git(directory, ['cat-file', '-s', entry.object]));
  if (size > 20000) return { content: '文件较大，仅支持选择一侧版本', editable: false };
  const { stdout } = await execute('git', ['-C', directory, 'cat-file', 'blob', entry.object], {
    encoding: 'buffer',
    windowsHide: true,
    maxBuffer: 80000,
  });
  if (stdout.includes(0) || !Buffer.from(stdout.toString('utf8'), 'utf8').equals(stdout))
    return { content: '二进制或非 UTF-8 文件，仅支持选择一侧版本', editable: false };
  return { content: stdout.toString('utf8'), editable: true };
}
async function manualResolution(receiver, delivery, list, content) {
  if (!list.every((item) => !item || ['100644', '100755'].includes(item.mode)))
    fail('RESOLUTION_NOT_ALLOWED', '人工文本合并只支持普通文件');
  if (typeof content !== 'string' || Buffer.byteLength(content) > 20000 || content.includes('\0'))
    fail('INVALID_RESOLUTION', '人工合并内容需要是不超过 20KB 的文本');
  const folder = join(receiver.config.stateDir, 'resolutions', delivery.id);
  await mkdir(folder, { recursive: true });
  const file = join(folder, 'content');
  await writeFile(file, content);
  return {
    mode: list[1]?.mode ?? list[2]?.mode ?? '100644',
    type: 'blob',
    object: await git(receiver.git.directory, ['hash-object', '-w', file]),
  };
}
