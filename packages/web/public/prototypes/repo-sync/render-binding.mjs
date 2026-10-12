import { COMPLETE } from './data.mjs';
import { escapeHtml } from './html.mjs';
import { renderIdentity } from './render-delivery.mjs';

function input(draft, name, label, hint, placeholder = '') {
  return `<label class="config-field" for="config-${name}"><span>${label}</span><input id="config-${name}" name="${name}" value="${escapeHtml(draft[name] ?? '')}" placeholder="${placeholder}" autocomplete="off" spellcheck="false"><small>${hint}</small></label>`;
}
export function bindingSummary(binding) {
  if (binding.status !== 'ready') return '';
  const repo = binding.externalUrl
    .replace(/\.git$/, '')
    .split(/[/:]/)
    .slice(-2)
    .join(' / ');
  const internalRepo = binding.internalUrl
    .replace(/\.git$/, '')
    .split(/[/:]/)
    .slice(-2)
    .join(' / ');
  return `<div class="connection-line"><span>GitHub ${escapeHtml(repo)} · ${escapeHtml(binding.sourceBranch)} <b>→</b> 内部 ${escapeHtml(internalRepo)} · ${escapeHtml(binding.targetBranch)}</span><button type="button" class="text-button" data-view="configuration">仓库设置</button></div>`;
}
function facts(draft) {
  return `<dl class="connection-facts"><div><dt>外部 GitHub</dt><dd>${escapeHtml(draft.externalUrl)}<br>分支 ${escapeHtml(draft.sourceBranch)}</dd></div><div><dt>内部 Git</dt><dd>${escapeHtml(draft.internalUrl)}<br>合入分支 ${escapeHtml(draft.targetBranch)}</dd></div><div><dt>起始上游版本</dt><dd><code>${escapeHtml(draft.baseline)}</code> · ${draft.mode === 'snapshot' ? '独立快照初始化' : '保留上游历史初始化'}</dd></div></dl>`;
}
function errors(ui) {
  return ui.errors.length
    ? `<div id="wizard-error" class="notice danger" role="alert"><ul>${ui.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul></div>`
    : '';
}
function advanced(draft) {
  return `<details class="wizard-advanced"><summary>更多连接选项（通常无需修改）</summary>${input(draft, 'internalWebUrl', '内部仓库网页地址（可选）', 'PR 的具体 URL 由平台适配器返回。')}
    <div class="wizard-grid">${input(draft, 'externalProfile', '外部认证配置引用', '引用执行机已有配置，不填写 Token 或密码。')}${input(draft, 'internalProfile', '内部认证配置引用', '仅记录配置名称，不保存密钥。')}</div>
    <label class="config-field" for="config-adapter"><span>Issue / PR 命令适配</span><select id="config-adapter" name="adapter"><option value="codehub-cli" ${draft.adapter === 'codehub-cli' ? 'selected' : ''}>codehub-cli</option><option value="platform-cli" ${draft.adapter === 'platform-cli' ? 'selected' : ''}>其他平台 CLI（待接入）</option></select><small>Git Bash 负责代码；平台 CLI 负责 Issue / PR。</small></label></details>`;
}
function connectionStep(draft) {
  return `<div class="wizard-grid"><section class="wizard-section"><h3>外部：从这里接收更新</h3>${input(draft, 'externalUrl', 'GitHub 仓库地址', '支持 HTTPS 或 SSH，地址中不要携带凭据。', 'https://github.com/example/core.git')}${input(draft, 'sourceBranch', '外部交付分支', '通常使用 main。')}</section><section class="wizard-section"><h3>内部：在这里审核与合入</h3>${input(draft, 'internalUrl', '内部 Git 仓库地址', '系统推送候选分支，并创建内部 PR。', 'git@codehub.example:team/core.git')}${input(draft, 'targetBranch', '内部合入分支', '同步 PR 将请求合入这个分支。')}</section></div>${advanced(draft)}`;
}
function baselineStep(draft) {
  return `${input(draft, 'baseline', '从哪个上游 commit 开始', '本原型预填示例版本，你可以替换为其他 7–40 位 commit ID。后续从这个版本连续接收更新。')}
    <fieldset class="init-modes"><legend>内部仓如何初始化</legend><label><input type="radio" name="mode" value="snapshot" ${draft.mode === 'snapshot' ? 'checked' : ''}><span><strong>独立快照初始化</strong><small>适合已有内部仓；内部初始 commit ID 可不同，核心文件树必须一致。</small></span></label><label><input type="radio" name="mode" value="history" ${draft.mode === 'history' ? 'checked' : ''}><span><strong>保留上游历史初始化</strong><small>适合新内部仓；沿用上游提交历史。</small></span></label></fieldset>`;
}
function finalStep(state, ui) {
  const saved = state.binding.status === 'saved' && JSON.stringify(ui.draft) === JSON.stringify(state.binding);
  const checked = ui.checked === JSON.stringify(ui.draft);
  const status = saved ? '配置已保存，还差初始化' : checked ? '本地格式检查通过' : '确认配置，再检查并启用';
  return `${facts(ui.draft)}<div id="config-result" class="notice ${saved || checked ? 'success' : ''}" role="status"><strong>${status}</strong><p>真实连接、权限和版本核验尚未接入；下面的操作只演示状态变化。</p></div><div class="wizard-actions"><button type="button" id="previous-binding" class="button secondary">← 上一步</button>${saved ? '<button type="button" id="initialize-binding" class="button primary">模拟初始化并开始使用 →</button>' : checked ? '<div><button type="button" id="check-binding" class="text-button">重新检查</button> <button type="button" id="save-binding" class="button primary">保存连接 →</button></div>' : '<button type="button" id="check-binding" class="button primary">检查配置（模拟）→</button>'}</div>`;
}
function readonlyBinding(state, ui) {
  const locked = state.active && state.active.phase < COMPLETE;
  return `<section class="panel config-readonly"><span class="badge good">演示连接已初始化</span><h2>当前仓库连接</h2><p>这是正在使用的接收链路，所有同步都从这个起始版本继续。</p>${facts(state.binding)}${errors(ui)}${locked ? '<div id="binding-lock" class="notice">当前有未完成同步，完成前不能更换仓库、分支或起始版本。</div>' : ''}<div class="wizard-actions">${locked ? '<button type="button" class="button primary" data-view="overview">返回当前同步 →</button><button type="button" id="edit-binding" class="button secondary" disabled>同步完成后可修改</button>' : '<button type="button" class="button secondary" data-view="overview">← 返回工作台</button><button type="button" id="edit-binding" class="button primary">修改仓库连接 →</button>'}</div><details class="wizard-advanced"><summary>查看认证配置与命名规则</summary><p>外部认证引用 ${escapeHtml(state.binding.externalProfile)} · 内部认证引用 ${escapeHtml(state.binding.internalProfile)} · ${escapeHtml(state.binding.adapter)}</p>${renderIdentity(state.active ?? state.deliveries[0], state.binding, 0)}</details></section>`;
}
export function renderBinding(state, ui) {
  if (!ui.editing) return readonlyBinding(state, ui);
  const labels = ['连接仓库', '选择起始版本', '检查并启用'];
  const descriptions = [
    '先填写来源和接收仓库。下一步再选择初始化版本。',
    '只设置一次起始版本，之后按上游交付顺序持续同步。',
    '核对填写的信息，保存后完成模拟初始化。',
  ];
  const body = ui.step === 1 ? connectionStep(ui.draft) : ui.step === 2 ? baselineStep(ui.draft) : finalStep(state, ui);
  return `<ol class="setup-steps" aria-label="配置进度">${labels.map((label, index) => `<li class="${index + 1 <= ui.step ? 'done' : ''}"><b>${index + 1}</b>${label}</li>`).join('')}</ol><form id="binding-form" class="panel wizard-panel" novalidate><span class="eyebrow">第 ${ui.step} / 3 步 · 演示配置</span><h2>${labels[ui.step - 1]}</h2><p>${descriptions[ui.step - 1]}</p>${errors(ui)}${body}${ui.step < 3 ? `<div class="wizard-actions">${ui.step > 1 ? '<button type="button" id="previous-binding" class="button secondary">← 上一步</button>' : '<button type="button" class="text-button" data-view="overview">暂时返回工作台</button>'}<button type="button" id="next-binding" class="button primary">${ui.step === 1 ? '下一步：选择起始版本 →' : '下一步：检查配置 →'}</button></div>` : ''}${state.binding.status === 'ready' ? '<button type="button" id="cancel-binding" class="text-button">取消修改，保留当前连接</button>' : ''}</form>`;
}
