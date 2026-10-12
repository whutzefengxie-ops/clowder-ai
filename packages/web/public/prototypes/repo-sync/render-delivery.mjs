import { renderAudit } from './audit.mjs';
import { COMPLETE, phases } from './data.mjs';
import { deliveryNames, deliveryPhase, prHref } from './delivery.mjs';
import { escapeHtml } from './html.mjs';
import { renderObjects, renderPhase } from './render-detail.mjs';
import { renderFlow } from './render-flow.mjs';

export function renderIdentity(delivery, binding, phase) {
  const names = deliveryNames(delivery, binding);
  return `<div class="delivery-identity"><div><small>内部候选分支 → 合入分支</small><div class="branch-path"><code>${escapeHtml(names.candidateBranch)}</code><span>→</span><code>${escapeHtml(names.targetBranch)}</code><span class="badge neutral">${phase >= 3 ? '候选已推送' : '名称预览'}</span></div></div><div><small>内部 PR 标题${phase < 4 ? '（预览）' : ''}</small><strong>${escapeHtml(names.prTitle)}</strong></div><p>分支按交付 ID 生成；同一笔交付重试复用同名分支与 PR。目标分支按仓库连接配置。</p></div>`;
}
function simulationAction(state, delivery) {
  const active = state.active;
  if (active?.id !== delivery.id || active.block || ![7, 8].includes(active.phase)) return '';
  const verifying = active.phase === 7;
  return `<div class="flow-action"><div><span class="badge warm">演示推进</span><strong>${verifying ? '合入后核验：等待模拟结果' : 'Issue 状态核对：等待模拟结果'}</strong><p>正式系统由程序自动推进。这里点击按钮模拟结果，不代表人工验收或再次审批。</p></div><button type="button" id="auto-step" class="button primary">${verifying ? '模拟核验通过，继续核对 Issue →' : '模拟核对完成，完成交付 →'}</button></div>`;
}
export function renderWorkflow(state, delivery, selectedPhase, detailsOpen = false) {
  const phase = delivery ? deliveryPhase(state, delivery) : 0;
  const flowState = delivery
    ? { ...delivery, phase, block: state.active?.id === delivery.id ? state.active.block : null }
    : null;
  const current = phase ? phases[phase] : '待开始同步';
  return `<section class="panel flow-panel"><div class="section-head"><div><h2>交付流程</h2><p>${delivery ? `${escapeHtml(delivery.id)} · 当前执行：${current}` : '从冻结目标开始，逐步构建内部可审批的交付。'}</p></div>${delivery && !detailsOpen ? `<button type="button" class="text-button" data-delivery="${escapeHtml(delivery.id)}">交付详情与审计 →</button>` : '<span class="badge neutral">点击节点查看说明</span>'}</div>
    ${delivery ? renderIdentity(delivery, state.binding, phase) : ''}<div class="flow">${renderFlow(flowState, selectedPhase)}</div>
    ${renderPhase(state, selectedPhase, delivery)}${delivery ? simulationAction(state, delivery) : ''}
    <p class="flow-help">点击节点用于查看说明，不改变执行进度。进度以当前阶段为准。</p></section>`;
}
function detailAction(state, delivery, phase) {
  if (phase >= 4)
    return `<a class="button secondary" href="${prHref(state, delivery.internalPr)}" target="_blank" rel="noopener">打开内部 PR #${delivery.internalPr} ↗</a>`;
  return '<span class="badge neutral">内部 PR 尚未创建</span>';
}
export function renderDelivery(state, selectedId, selectedPhase) {
  const delivery = state.deliveries.find((item) => item.id === selectedId);
  if (!delivery || state.binding.status !== 'ready') return '<div class="notice">此交付不可用，请返回同步总览。</div>';
  const phase = deliveryPhase(state, delivery);
  const frozen = state.active?.id === delivery.id ? state.active : delivery;
  return `<section class="delivery-heading"><div><button type="button" class="text-button" data-view="overview">← 返回同步总览</button><h2>${escapeHtml(delivery.title)}</h2><p>${escapeHtml(delivery.id)} · 外部 PR #${delivery.sourcePr} · ${phase === COMPLETE ? '已完成' : phases[phase]}</p></div><div class="detail-actions"><button type="button" class="button secondary" data-map="${escapeHtml(delivery.id)}">查看提交与对象映射</button>${detailAction(state, delivery, phase)}</div></section>
    ${renderWorkflow(state, frozen, selectedPhase, true)}<section class="panel delivery-objects"><div class="section-head"><div><h2>本次交付状态</h2><p>当前检查结果与内部对象状态</p></div></div>${renderObjects(state, delivery)}</section>${renderAudit(state, delivery.id)}`;
}
