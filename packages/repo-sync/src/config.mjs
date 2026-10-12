import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
export function safeUrl(value, local = false) {
  if (typeof value !== 'string' || !value || /[\r\n\0]/.test(value)) fail('INVALID_URL', '仓库地址无效');
  if (local && isAbsolute(value)) return resolve(value);
  if (/^git@[\w.-]+:[\w./-]+(?:\.git)?$/.test(value)) return value;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('INVALID_URL', '需要 HTTPS 或 SSH Git 地址');
  }
  if (
    !['https:', 'ssh:'].includes(parsed.protocol) ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.protocol === 'https:' && parsed.username)
  )
    fail('INVALID_URL', '地址不可含凭据、查询参数或片段');
  return value;
}
export function objectUrl(value) {
  const parsed = new URL(safeUrl(value));
  if (parsed.protocol !== 'https:') fail('INVALID_OBJECT_URL', '平台对象链接需要 HTTPS');
  return value;
}
export function validateConfig(input) {
  const config = structuredClone(input);
  config.sourceUrl = safeUrl(config.sourceUrl, config.allowLocal === true);
  config.internalUrl = safeUrl(config.internalUrl, config.allowLocal === true);
  for (const branch of [config.sourceBranch, config.targetBranch]) {
    if (
      typeof branch !== 'string' ||
      !/^[\w][\w./-]*$/.test(branch) ||
      branch.includes('..') ||
      branch.endsWith('/') ||
      branch.endsWith('.lock')
    )
      fail('INVALID_BRANCH', '分支名称无效');
  }
  if (!isAbsolute(config.stateDir)) fail('INVALID_STATE_DIR', '台账目录需要绝对路径，放在核心仓之外');
  config.stateDir = resolve(config.stateDir);
  if (config.sourceUrl === config.internalUrl) fail('SAME_REPOSITORY', '外部来源与内部接收不能使用同一个仓库地址');
  if (config.commitClosureVerified !== undefined && typeof config.commitClosureVerified !== 'boolean')
    fail('INVALID_CAPABILITY', '关单验证声明必须是布尔值');
  checkStateLocation(config);
  config.bindingId = createHash('sha256')
    .update(JSON.stringify([config.sourceUrl, config.internalUrl, config.sourceBranch, config.targetBranch]))
    .digest('hex');
  for (const check of config.checks ?? []) {
    if (
      typeof check.command !== 'string' ||
      !check.command ||
      !Array.isArray(check.args) ||
      !check.args.every((arg) => typeof arg === 'string')
    )
      fail('INVALID_CHECK', '检查命令需要 executable 与字符串 args 数组');
  }
  return config;
}
function checkStateLocation(config) {
  for (const repository of [config.sourceUrl, config.internalUrl].filter(isAbsolute)) {
    const path = relative(repository, config.stateDir);
    if (!path || (!path.startsWith(`..${sep}`) && !isAbsolute(path)))
      fail('STATE_INSIDE_CORE', '台账目录不可放在核心仓之内');
  }
}
