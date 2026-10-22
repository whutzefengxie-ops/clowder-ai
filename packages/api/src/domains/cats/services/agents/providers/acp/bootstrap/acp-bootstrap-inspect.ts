import { dirname, isAbsolute } from 'node:path';
import { resolveAcpBootstrapCwd } from '../acp-bootstrap-cwd.js';

export function isExplicitAcpBootstrapRoot(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 8192 &&
    !/[\u0000\r\n]/.test(value) &&
    isAbsolute(value) &&
    (process.platform !== 'win32' || /^[a-z]:[\\/]/i.test(value))
  );
}

/** Same strict directory admission as a generic client; never starts an agent or repairs existing ACLs. */
export function inspectAcpBootstrapDirectory(root?: string): { ok: true; root: string } | { ok: false; error: string } {
  if (root !== undefined && !isExplicitAcpBootstrapRoot(root)) {
    return { ok: false, error: '引导目录必须是本机绝对路径。' };
  }
  try {
    const cwd = resolveAcpBootstrapCwd(
      process.cwd(),
      'directory-check',
      root,
      undefined,
      undefined,
      root === undefined,
    );
    return { ok: true, root: dirname(cwd) };
  } catch (error) {
    return {
      ok: false,
      error: `${error instanceof Error ? error.message : String(error)}\n未修改已有目录权限。请选择祖先链同样安全的位置；在不可信卷内新建文件夹不能修复祖先问题。`,
    };
  }
}
