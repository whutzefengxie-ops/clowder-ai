import { COMPLETE } from './data.mjs';
import { escapeHtml } from './html.mjs';

function input(draft, name, label, hint, placeholder = '') {
  return `<label class="config-field" for="config-${name}"><span>${label}</span><input id="config-${name}" name="${name}" value="${escapeHtml(draft[name] ?? '')}" placeholder="${placeholder}" autocomplete="off" spellcheck="false"><small>${hint}</small></label>`;
}
export function bindingSummary(binding) {
  if (binding?.status !== 'ready') return '';
  return `<section class="binding-strip" aria-label="当前仓库连接"><div><small>外部 GitHub · ${escapeHtml(binding.sourceBranch)}</small><code>${escapeHtml(binding.externalUrl)}</code></div><span class="binding-arrow">→</span><div><small>内部 Git · ${escapeHtml(binding.targetBranch)}</small><code>${escapeHtml(binding.internalUrl)}</code></div><button type="button" class="text-button" data-view="configuration">管理连接 ↗</button></section>`;
}
export function renderUnboundOverview(binding) {
  const saved = binding.status === 'saved';
  return `<section class="hero"><div><span class="badge warm">${saved ? '等待初始化' : '尚未配置'}</span><h2>${saved ? '连接已保存，确认初始化后开始接收' : '先连接外部与内部仓库'}</h2><p>仓库、分支与起始上游版本共同确定一条接收链路。初始化前不建立映射或创建同步 PR。</p></div><button type="button" class="button primary" data-view="configuration">配置连接与初始化 →</button></section>`;
}
function checkResult(ui, checked) {
  if (ui.errors.length)
    return `<ul class="config-errors">${ui.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`;
  return checked
    ? '<p class="good-text">✓ 当前配置格式校验通过（模拟检查）</p><p>真实检查待接入：外部读取权限 → 内部 Git 推送权限 → CLI 建 Issue / PR 权限 → 起始版本与文件树核验。</p>'
    : '<p>填写后点击“检查配置”。任何修改都需要重新检查。</p>';
}
function setupSteps(draft, { saved, ready, checked, dirty }) {
  const persisted = (saved || ready) && !dirty;
  const done = [draft.externalUrl && draft.internalUrl, checked || persisted, persisted, ready && !dirty];
  const labels = ['填写仓库地址', '检查配置', '保存新绑定', '初始化与核验'];
  return `<ol class="setup-steps" aria-label="连接配置流程">${labels.map((label, index) => `<li class="${done[index] ? 'done' : ''}"><b>${index + 1}</b>${label}</li>`).join('')}</ol>`;
}
function configActions({ locked, saved, ready, checked, dirty }) {
  const disabled = locked || (saved && !dirty) || !checked;
  return `<div class="config-actions"><button type="button" id="check-binding" class="button secondary">检查配置（模拟）</button><button type="button" id="save-binding" class="button primary" ${disabled ? 'disabled' : ''}>${ready ? '保存为新绑定' : '保存连接'}</button>${saved ? `<button type="button" id="initialize-binding" class="button primary" ${dirty ? 'disabled' : ''}>模拟初始化并核对 →</button>` : ''}</div>`;
}
export function renderBinding(state, ui) {
  const draft = ui.draft;
  const locked = state.active && state.active.phase < COMPLETE;
  const saved = state.binding.status === 'saved';
  const ready = state.binding.status === 'ready';
  const checked = ui.checked === JSON.stringify(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.binding);
  const flags = { locked, saved, ready, checked, dirty };
  const select = (name, value) => (draft[name] === value ? 'selected' : '');
  const mark = (value) => (draft.mode === value ? 'checked' : '');
  return `<section class="panel config-header"><div><div class="eyebrow">REPOSITORY CONNECTION</div><h2>仓库连接与初始化</h2><p>先确定接收哪一个仓库、从哪个版本开始，再推进交付流程。</p></div><span class="badge ${ready ? 'good' : 'warm'}">${ready ? '演示绑定已初始化' : saved ? '已保存 · 等待初始化' : '尚未配置'}</span></section>
  ${setupSteps(draft, flags)}
  ${locked ? `<div class="notice danger" id="binding-lock"><div><strong>当前绑定有未完成交付</strong><p>${escapeHtml(state.active.id)}${state.active.internalPr ? ` · 内部 PR #${state.active.internalPr}` : ''} 尚未完成。完成后才可替换仓库、分支或起始版本；演示“首次配置连接”可体验新建流程。</p></div></div>` : ''}
  <form id="binding-form" novalidate><div class="config-grid">
    <section class="panel config-card"><div class="config-card-head"><span class="config-icon">↗</span><div><h3>外部代码仓</h3><p>GitHub · 通用能力的来源</p></div><span class="badge neutral">只读来源</span></div>
      ${input(draft, 'externalUrl', 'Git 仓库地址', '支持 HTTPS 或 SSH，不在 URL 中携带 Token。', 'https://github.com/example/core.git')}
      ${input(draft, 'sourceBranch', '外部交付分支', '只接收已合入此分支的交付，通常为 main。')}
      ${input(draft, 'externalProfile', '外部认证配置引用', '引用同步执行机已有 Git / GitHub 认证配置；不填写凭据。')}
    </section>
    <section class="panel config-card"><div class="config-card-head"><span class="config-icon">↙</span><div><h3>内部代码仓</h3><p>内部 Git 平台 · 接收与审批</p></div><span class="badge neutral">内网执行</span></div>
      ${input(draft, 'internalUrl', 'Git 仓库地址', '用于 Git 对象与候选分支推送，不直接推进目标分支。', 'git@codehub.example:team/core.git')}
      ${input(draft, 'targetBranch', '内部合入分支', '同步 PR 的目标分支，由内部平台正常审核与合入。')}
      ${input(draft, 'internalWebUrl', '内部仓库网页地址（可选）', '网页入口与 Git 地址分别配置；具体 PR URL 由平台适配器返回。')}
      <div class="config-pair"><label class="config-field" for="config-adapter"><span>Issue / PR 命令适配</span><select id="config-adapter" name="adapter"><option value="codehub-cli" ${select('adapter', 'codehub-cli')}>codehub-cli</option><option value="platform-cli" ${select('adapter', 'platform-cli')}>其他平台 CLI（待接入）</option></select><small>Git Bash 负责代码；平台 CLI 负责 Issue / PR。</small></label>
      ${input(draft, 'internalProfile', '内部认证配置引用', '仅记录执行机配置名称，不保存密钥。')}</div>
    </section></div>
    <section class="panel config-card baseline-card"><div class="section-head"><div><h3>初始化基线</h3><p>更换起始版本会创建新的绑定，并保留旧绑定的合成映射记录。</p></div><span class="badge neutral">一次初始化 · 后续连续接收</span></div>
      <div class="baseline-grid">${input(draft, 'baseline', '起始上游 commit ID', '应来自外部交付分支的某个版本。实际存在性、祖先关系和文件树一致性由程序核验。', '例如 a17e9b40')}
      <fieldset class="init-modes"><legend>内部初始化方式</legend><label><input type="radio" name="mode" value="snapshot" ${mark('snapshot')}><span><strong>独立快照初始化</strong><small>内部起始 commit ID 可以不同，核心文件树必须一致。</small></span></label><label><input type="radio" name="mode" value="history" ${mark('history')}><span><strong>保留上游历史初始化</strong><small>新仓库可沿用上游提交历史；之后仍走内部 PR。</small></span></label></fieldset></div>
    </section>
    <section class="panel config-checks"><div><h3>检查与保存</h3><p>演示仅执行本地格式校验，真实连通性、权限与版本核验尚未接入。</p></div>
      <div id="config-result" role="status" aria-live="polite">${checkResult(ui, checked)}</div>
      ${configActions(flags)}
      <small>${saved ? '初始化采用已保存的配置。修改表单后请先重新检查并保存。' : '仅内网执行机从外部接收；核心仓不承载内部定制代码，插件仓独立管理。'}</small>
    </section></form>`;
}
