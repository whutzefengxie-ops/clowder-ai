import { BASE, COMPLETE, deliveries } from './data.mjs';

export function defaultBinding() {
  return {
    id: 'demo-core',
    status: 'ready',
    simulated: true,
    externalUrl: 'https://github.com/demo/core.git',
    sourceBranch: 'main',
    internalUrl: 'git@codehub.example:demo/core.git',
    targetBranch: 'main',
    internalWebUrl: 'https://codehub.example/demo/core',
    baseline: BASE,
    initialInternalSha: '10a91f20',
    mode: 'snapshot',
    adapter: 'codehub-cli',
    externalProfile: 'system-git',
    internalProfile: 'internal-cli',
  };
}
export function emptyBinding() {
  return {
    ...defaultBinding(),
    id: 'unbound',
    status: 'draft',
    externalUrl: '',
    internalUrl: '',
    internalWebUrl: '',
    baseline: '',
    initialInternalSha: null,
  };
}
function addressParts(value) {
  const scp = /^([\w.-]+)@([^/:]+):([\w./-]+)$/.exec(value);
  if (scp) return { username: scp[1], host: scp[2], path: scp[3] };
  try {
    const url = new URL(value);
    if (!['https:', 'ssh:'].includes(url.protocol) || url.password || url.search || url.hash) return null;
    if (url.protocol === 'https:' && url.username) return null;
    return { username: url.username, host: url.hostname, path: url.pathname.slice(1) };
  } catch {
    return null;
  }
}
function gitAddress(value, github = false) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s?#]/.test(value)) return false;
  const parts = addressParts(value);
  if (!parts?.host || !parts.path || parts.path.includes('..') || parts.path.startsWith('-')) return false;
  return (
    !github ||
    (parts.host === 'github.com' &&
      ['', 'git'].includes(parts.username) &&
      /^[\w-]+\/[\w.-]+(?:\.git)?$/.test(parts.path))
  );
}
function branch(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 100 &&
    !/[\s~^:?*[\\]/.test(value) &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) &&
    !value.includes('..') &&
    !value.includes('@{') &&
    value !== '@' &&
    !value.startsWith('-') &&
    !value.includes('//') &&
    value.split('/').every((part) => part && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock'))
  );
}
function baselineErrors(draft) {
  const errors = [];
  if (!/^[a-f\d]{7,40}$/i.test(draft.baseline ?? '')) errors.push('请选择有效的起始 commit ID（7–40 位十六进制）。');
  if (!['snapshot', 'history'].includes(draft.mode)) errors.push('请选择初始化方式。');
  return errors;
}
function webAddressValid(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}
function connectionErrors(draft) {
  const errors = [];
  if (!gitAddress(draft.externalUrl, true))
    errors.push('外部地址需为 GitHub 仓库的 HTTPS 或 SSH 地址，且不含凭据、查询参数。');
  if (!gitAddress(draft.internalUrl)) errors.push('内部地址需为 HTTPS 或 SSH Git 地址，且不含凭据、查询参数。');
  if (!branch(draft.sourceBranch) || !branch(draft.targetBranch)) errors.push('分支名称格式不正确。');
  if (!['codehub-cli', 'platform-cli'].includes(draft.adapter)) errors.push('请选择内部平台命令适配。');
  if (![draft.externalProfile, draft.internalProfile].every((value) => /^[\w.-]{1,64}$/.test(value ?? '')))
    errors.push('凭据引用只接受本机配置名称，例如 system-git；不要填写密钥。');
  if (draft.internalWebUrl && !webAddressValid(draft.internalWebUrl))
    errors.push('内部网页地址需为无凭据和查询参数的 HTTPS URL。');
  return errors;
}
export function validateBinding(draft, scope = 'all') {
  if (scope === 'baseline') return baselineErrors(draft);
  if (scope === 'connection') return connectionErrors(draft);
  return [...connectionErrors(draft), ...baselineErrors(draft)];
}
export function saveBinding(current, draft, checkedFingerprint) {
  if (current.active && current.active.phase < COMPLETE) throw new Error('存在未完成交付，不能替换仓库绑定。');
  const errors = validateBinding(draft);
  if (errors.length) throw new Error(errors.join('\n'));
  if (checkedFingerprint !== JSON.stringify(draft)) throw new Error('请先检查当前配置；修改后需要重新检查。');
  const state = structuredClone(current);
  state.archives ??= [];
  state.archives.push({
    binding: state.binding,
    accepted: state.accepted,
    internalSha: state.internalSha,
    deliveries: state.deliveries,
    active: state.active,
    events: state.events,
  });
  state.binding = {
    ...draft,
    id: `binding-${crypto.randomUUID()}`,
    status: 'saved',
    simulated: true,
    initialInternalSha: null,
  };
  state.accepted = null;
  state.internalSha = null;
  state.active = null;
  state.deliveries = structuredClone(deliveries);
  state.latest = deliveries.at(-1).target;
  state.scenario = 'unconfigured';
  state.events = [{ label: '保存新仓库绑定（模拟）', note: '旧绑定及映射已归档；等待初始化。真实连接尚未验证。' }];
  return state;
}
export function initializeBinding(current) {
  if (current.binding?.status !== 'saved') throw new Error('请先检查并保存仓库连接。');
  const state = structuredClone(current);
  const baseline = state.binding.baseline.toLowerCase();
  const short = baseline.slice(0, 8);
  state.internalSha = state.binding.mode === 'history' ? baseline : `${short[0] === '1' ? '2' : '1'}${short.slice(1)}`;
  state.accepted = baseline;
  state.binding = { ...state.binding, status: 'ready', baseline, initialInternalSha: state.internalSha };
  state.scenario = 'behind';
  state.events.push({
    label: '模拟初始化完成',
    note: `上游 ${baseline} → 内部 ${state.internalSha}；模拟文件树核验通过，未执行真实 Git。`,
  });
  return state;
}
