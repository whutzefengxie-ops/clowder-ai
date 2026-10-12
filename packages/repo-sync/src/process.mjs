import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fail } from './config.mjs';

const execute = promisify(execFile);

export async function command(executable, args, options = {}) {
  try {
    const result = await execute(executable, args, {
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
      ...options,
    });
    return result.stdout.trim();
  } catch (error) {
    // Never persist raw Git/CLI output: it can contain remote URLs, usernames and secrets.
    fail(
      'COMMAND_FAILED',
      `命令执行失败：${executable.split(/[\\/]/).at(-1)}，退出状态 ${Number.isInteger(error.code) ? error.code : '未知或超时'}。请在内部环境核对原始输出。`,
    );
  }
}
export async function git(directory, args) {
  return command('git', ['-C', directory, ...args], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}
export async function ancestor(directory, from, to) {
  try {
    await execute('git', ['-C', directory, 'merge-base', '--is-ancestor', from, to], { windowsHide: true });
    return true;
  } catch (error) {
    if (error.code === 1) return false;
    fail('GRAPH_CHECK_FAILED', '提交祖先核验失败，不能将错误当作不存在祖先关系');
  }
}
