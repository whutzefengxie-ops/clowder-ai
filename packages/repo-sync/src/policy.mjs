import { fail } from './config.mjs';

export function versionPolicy(input) {
  const policy = { internalPaths: input.internalPaths ?? [], mergePaths: input.mergePaths ?? [] };
  const all = [];
  for (const [kind, paths] of Object.entries(policy)) {
    if (!Array.isArray(paths) || paths.length > 100) fail('INVALID_POLICY', '文件规则必须是最多 100 项的路径列表');
    for (const path of paths) {
      const root = validatePath(path, kind);
      if (all.some((other) => root === other || root.startsWith(`${other}/`) || other.startsWith(`${root}/`)))
        fail('INVALID_POLICY', '文件规则不可重复或重叠');
      all.push(root);
    }
  }
  return { internalPaths: [...policy.internalPaths].sort(), mergePaths: [...policy.mergePaths].sort() };
}
function validatePath(path, kind) {
  if (
    typeof path !== 'string' ||
    !path ||
    /[\\:*?<>|"]/.test(path) ||
    path.startsWith('/') ||
    [...path].some((char) => char.charCodeAt(0) < 32)
  )
    fail('INVALID_POLICY', '只支持相对文件路径或以 / 结尾的目录，不能使用通配符或绝对路径');
  const root = path.replace(/\/$/, '');
  if (root.split('/').some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git'))
    fail('INVALID_POLICY', '文件规则包含危险或无效路径');
  if (kind === 'mergePaths' && path.endsWith('/')) fail('INVALID_POLICY', '共同修改规则需指定具体文件');
  return root;
}
export function matches(path, rule) {
  const root = rule.replace(/\/$/, '');
  return path === root || (rule.endsWith('/') && path.startsWith(`${root}/`));
}
export function category(path, policy) {
  if (policy.internalPaths.some((rule) => matches(path, rule))) return 'internal';
  return policy.mergePaths.includes(path) ? 'merge' : 'upstream';
}
