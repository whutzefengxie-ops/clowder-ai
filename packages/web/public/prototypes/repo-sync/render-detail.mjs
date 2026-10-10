import { BASE, phaseDetails } from './data.mjs';
import { escapeHtml, sha } from './html.mjs';
export function renderPhase(state, phase) {
  const [name, explanation, command] = phaseDetails[phase];
  const active = state.active;
  const resolved = active
    ? command
        .replaceAll('delivery-041', active.id)
        .replaceAll('c2f84d91', active.target)
        .replace('--source 71', `--source ${active.issue}`)
        .replace('--id 92', `--id ${active.internalPr ?? '待创建'}`)
    : command;
  return `<div class="phase-detail"><div><span class="eyebrow">步骤 ${phase} / 8</span><h3>${name}</h3><p>${explanation}</p></div><details><summary>查看命令示意</summary><pre>${escapeHtml(resolved)}</pre><small>Git 为命令示意；repo-sync 为尚未实现的平台适配器。当前不会执行命令。</small></details></div>`;
}
export function renderObjects(state, delivery) {
  if (!delivery) return '<div class="empty">同步开始后，这里展示 Issue、PR 与检查状态。</div>';
  const active = delivery.id === state.active?.id ? state.active : null;
  const index = state.deliveries.findIndex((item) => item.id === delivery.id);
  const acceptedIndex = state.deliveries.findIndex((item) => item.target === state.accepted);
  const phase = active?.phase ?? (index <= acceptedIndex ? 8 : 0);
  const issue = phase >= 3 ? delivery.internalIssue : null;
  const pr = phase >= 4 ? delivery.internalPr : null;
  const checks = renderChecks(active, phase);
  return `<dl class="object-list"><div><dt>PR 对应</dt><dd>外部 #${delivery.sourcePr} <span>→</span> ${pr ? `内部 #${pr}` : '内部待创建'}</dd></div><div><dt>Issue 对应</dt><dd>外部 #${delivery.issue} <span>→</span> ${issue ? `内部 #${issue}` : '内部待创建'}</dd></div><div><dt>内部 PR</dt><dd><span class="badge ${phase >= 7 ? 'good' : 'warm'}">${phase >= 7 ? '已合入' : pr ? '未合入' : '待创建'}</span></dd></div><div><dt>内部 Issue</dt><dd>${phase === 8 ? '已核对并关闭' : phase >= 7 ? '待核对正确对象关单' : '等待内部 PR 合入'}</dd></div>${checks}</dl>`;
}
function renderChecks(active, phase) {
  let core = '待检查';
  let plugin = '待检查';
  if (phase >= 6 || active?.block === 'plugin') core = '<span class="good-text">候选与目标一致 ✓</span>';
  if (phase >= 6) plugin = '<span class="good-text">检查通过 ✓</span>';
  if (active?.block === 'drift') core = '<span class="bad-text">基线不一致</span>';
  if (active?.block === 'plugin') plugin = '<span class="bad-text">检查失败</span>';
  return `<div><dt>核心文件树</dt><dd>${core}</dd></div><div><dt>插件兼容</dt><dd>${plugin}</dd></div>`;
}
export function renderMapping(state, selectedId) {
  const delivery = state.deliveries.find((item) => item.id === selectedId) ?? state.active ?? state.deliveries[0];
  const index = state.deliveries.findIndex((item) => item.id === delivery.id);
  const acceptedIndex = state.deliveries.findIndex((item) => item.target === state.accepted);
  const phase = state.active?.id === delivery.id ? state.active.phase : index <= acceptedIndex ? 8 : 0;
  return `<section class="panel mapping-panel"><div class="section-head"><div><h2>${delivery.title}</h2><p>${delivery.id} · 落地方式 ${delivery.mode}</p></div><select id="mapping-delivery" aria-label="选择映射交付">${state.deliveries.map((item) => `<option value="${item.id}" ${item.id === delivery.id ? 'selected' : ''}>外部 PR #${item.sourcePr}</option>`).join('')}</select></div>
    <div class="mapping-grid"><div><div class="eyebrow">外部 / 已落地提交</div><h3>GitHub main</h3><p>实际进入 main 的对象作为接收依据。</p></div><div><div class="eyebrow">内部 / 接收结果</div><h3>候选分支 → 内部 main</h3><p>提交对象 SHA 保留，接收合并节点独立。</p></div></div>
    <div class="commit-table" role="table" aria-label="提交 ID 映射"><div class="commit-row table-head" role="row"><span role="columnheader">外部 commit ID</span><span role="columnheader">内部对应 commit ID</span><span role="columnheader">状态 / 类型</span></div>${delivery.commits.map((commit) => `<div class="commit-row" role="row"><span role="cell">${sha(commit)}</span><span role="cell">${phase >= 4 ? sha(commit) : '待搬运'}</span><span role="cell"><span class="badge ${phase >= 4 ? 'good' : 'neutral'}">${phase >= 7 ? '已随 PR 合入' : phase >= 4 ? '候选分支已接收' : '等待搬运'}</span></span></div>`).join('')}<div class="commit-row special" role="row"><span role="cell">上游初始化基线 ${sha(BASE)}</span><span role="cell">${sha('10a91f20')}</span><span role="cell">内部初始化节点</span></div>${phase >= 7 ? `<div class="commit-row special" role="row"><span role="cell">接收目标 ${sha(delivery.target)}</span><span role="cell">${sha(`1${index + 1}c79a50`)}</span><span role="cell">内部接收合并节点</span></div>` : ''}</div>
    <div class="notice">${delivery.mode === 'Squash' ? 'Squash 场景：搬运落入 main 的单个提交。PR 开发分支提交仅作为来源记录，不要求逐个重放。' : 'Merge 场景：保留上游落地对象；内部允许初始化和接收合并节点，因此 main SHA 不必相同。'}</div>
    <div class="mapping-grid"><section><h3>Issue / PR 对应关系</h3>${renderObjects(state, delivery)}</section><section><h3>验收规则</h3><ul class="rules"><li>是否最新：已接受上游版本 = 外部最新版本。</li><li>本次核心文件树与冻结目标一致。</li><li>内部审批通过后，才推进已接受版本。</li><li>Issue 关闭核对内部编号，避免错误关闭同号对象。</li><li>内部定制能力在独立插件仓中管理。</li></ul></section></div></section>`;
}
export function renderEvents(state) {
  return `<section class="panel"><div class="section-head"><div><h2>执行记录</h2><p>本机合成状态 · 刷新后保留 · 不包含凭据</p></div><span class="badge neutral">${state.events.length} 条记录</span></div><ol class="event-list">${state.events
    .toReversed()
    .map(
      (event) =>
        `<li><span class="event-dot"></span><div><strong>${escapeHtml(event.label)}</strong><p>${escapeHtml(event.note)}</p></div><time>${event.time ?? '初始化'}</time></li>`,
    )
    .join('')}</ol></section>`;
}
