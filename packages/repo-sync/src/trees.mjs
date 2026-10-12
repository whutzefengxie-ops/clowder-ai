import { fail } from './config.mjs';
import { category } from './policy.mjs';
import { git } from './process.mjs';

export async function entries(directory, sha) {
  const text = await git(directory, ['ls-tree', '-rz', sha]);
  return new Map(
    text
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf('\t');
        const [mode, type, object] = line.slice(0, tab).split(' ');
        return [line.slice(tab + 1), { mode, type, object }];
      }),
  );
}
export const equalEntry = (a, b) => a?.mode === b?.mode && a?.object === b?.object;
export async function assertProjection(directory, upstream, internal, policy) {
  const [source, local] = await Promise.all([entries(directory, upstream), entries(directory, internal)]);
  const changed = [...new Set([...source.keys(), ...local.keys()])]
    .filter((path) => category(path, policy) === 'upstream' && !equalEntry(source.get(path), local.get(path)))
    .sort();
  if (changed.length)
    fail('UNAPPROVED_DIFFERENCE', '内部同步范围存在未声明的修改，请配置文件规则或处理后重新核对', {
      paths: changed.slice(0, 100),
    });
  return { source, local };
}
export function changeList(before, after, policy) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((path) => !equalEntry(before.get(path), after.get(path)))
    .map((path) => ({
      path,
      kind: !before.has(path) ? 'added' : !after.has(path) ? 'deleted' : 'modified',
      category: category(path, policy),
    }));
}
