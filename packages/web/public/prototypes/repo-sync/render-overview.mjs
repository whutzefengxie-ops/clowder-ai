import { COMPLETE, phases } from './data.mjs';
import { escapeHtml, internalPrHref, sha } from './html.mjs';
import { bindingSummary, renderUnboundOverview } from './render-binding.mjs';
import { renderFlow, renderQueue } from './render-flow.mjs';
import { summary } from './state.mjs';

const blocks = {
  timeout: ['PR 创建结果待核对', '命令超时，但内部可能已创建 PR。先查询交付标记，再复用已有对象。', '核对已有 PR'],
  plugin: [
    '插件兼容检查未通过',
    '核心文件树检查通过，独立插件的兼容测试失败。处理插件问题后重跑检查。',
    '模拟修复并重跑',
  ],
  drift: ['内部核心基线发生偏移', '内部核心存在未登记差异。需要人工核对基线；自动同步已暂停。', '需要人工核对基线'],
  metadata: [
    '代码已最新，Issue 状态待补齐',
    '内部 PR 已合入，正确的内部 Issue 仍未关单。只补齐元数据，不重复合入。',
    '重试 Issue 状态核对',
  ],
};
export function nextAction(state) {
  const active = state.active;
  if (active?.block)
    return `<button type="button" id="recover" class="button primary" ${active.block === 'drift' ? 'disabled' : ''}>${blocks[active.block][2]}</button>`;
  if (!active || active.phase === COMPLETE)
    return summary(state).behind
      ? '<button type="button" id="start" class="button primary">同步下一笔交付 →</button>'
      : '<span class="badge good">所有交付已完成</span>';
  if (active.phase === 6)
    return `<a id="open-pr" class="button primary" href="${internalPrHref(active.internalPr)}?binding=${encodeURIComponent(state.binding.id)}" target="_blank" rel="noopener">打开内部 PR #${active.internalPr} ↗</a>`;
  if (active.phase >= 7) return '<span class="badge neutral">程序自动处理 · 无需人工验收</span>';
  return '<button type="button" id="advance" class="button primary">模拟执行下一步 →</button>';
}
function presentation(state) {
  const status = summary(state);
  const active = state.active;
  const blocked = active?.block;
  const title = status.fullyComplete
    ? '内部已接收外部最新版本'
    : status.codeLatest
      ? '代码已最新，交付仍待收尾'
      : `内部落后 ${status.behind} 笔外部交付`;
  const current = blocked
    ? blocks[blocked][0]
    : active && active.phase < COMPLETE
      ? phases[active.phase]
      : status.fullyComplete
        ? '全部完成'
        : '待开始同步';
  let description = `按外部交付顺序推进。审批通过前，内部 ${escapeHtml(state.binding.targetBranch)} 保持当前版本。`;
  if (active?.phase === 7) description = '内部 PR 已合入。程序正在核对实际结果，通过后才登记已接受版本。';
  if (active?.phase >= 8) description = '代码核验通过。程序核对正确的内部 Issue 状态后，自动完成交付。';
  if (status.fullyComplete) description = '代码与对象状态均已验收，核心文件树保持一致。';
  return { status, active, blocked, title, current, description };
}
export function renderOverview(state, selectedPhase) {
  if (state.binding.status !== 'ready') return renderUnboundOverview(state.binding);
  const sourceBranch = escapeHtml(state.binding.sourceBranch);
  const targetBranch = escapeHtml(state.binding.targetBranch);
  const { status, active, blocked, title, current, description } = presentation(state);
  const tone = overviewTone(status, blocked);
  const queueSize = Math.max(0, status.behind - (active && active.phase < 8 ? 1 : 0));
  return `${bindingSummary(state.binding)}<section class="hero ${status.fullyComplete ? 'complete' : ''}">
    <div><span class="badge ${tone}"><span class="dot"></span>${escapeHtml(current)}</span><h2>${title}</h2><p>${description}</p></div>
    <div class="hero-action">${nextAction(state)}<small>${status.pendingPr} 个内部 PR 待合入 · ${queueSize} 笔交付排队</small></div>
  </section>
  <section class="version-bridge" aria-label="内外版本对应关系">
    <article><div class="eyebrow">外部 / GITHUB</div><h3>最新 ${sourceBranch}</h3>${sha(state.latest)}<p>已合入的通用能力</p></article>
    <div class="bridge-arrow">→<small>单向接收</small></div>
    <article class="target"><div class="eyebrow">本次 / 冻结目标</div><h3>${active ? active.id : '尚未开始'}</h3>${active ? sha(active.target) : '<span class="muted">选择下一笔交付后冻结</span>'}<p>外部后续更新不会改变本次目标</p></article>
    <div class="bridge-arrow">→<small>内部审批</small></div>
    <article><div class="eyebrow">内部 / CORE</div><h3>已接受上游 ${sha(state.accepted)}</h3><div class="internal-sha">内部 ${targetBranch} ${sha(state.internalSha)}</div><p>两侧分支 SHA 可不同，核验核心文件树</p></article>
  </section>
  <section class="panel flow-panel"><div class="section-head"><div><h2>交付流程</h2><p>${active ? `${active.id} · 外部 PR #${active.sourcePr} → 内部 PR ${active.internalPr ? `#${active.internalPr}` : '待创建'}` : '从冻结目标开始，逐步构建内部可审批的交付。'}</p></div><span class="badge neutral">点击节点查看说明</span></div>
    <div class="flow">${renderFlow(active, selectedPhase)}</div>
    <div id="phase-detail"></div>
  </section>
  ${blockNotice(blocked)}
  <div class="lower-grid"><section class="panel"><div class="section-head"><div><h2>交付队列</h2><p>先完成当前交付，再接收下一笔。</p></div><span class="count">${state.deliveries.length}</span></div><div class="delivery-list">${renderQueue(state, current)}</div></section>
    <section class="panel"><div class="section-head"><div><h2>当前交付对象</h2><p>来源、内部映射与验收状态</p></div><button type="button" class="text-button" data-view="mapping">查看映射 →</button></div><div id="object-summary"></div></section></div>`;
}
function overviewTone(status, blocked) {
  return status.fullyComplete ? 'good' : blocked ? 'bad' : 'warm';
}
function blockNotice(blocked) {
  return blocked
    ? `<div class="notice danger"><div><strong>${blocks[blocked][0]}</strong><p>${blocks[blocked][1]}</p></div><span class="badge bad">${blocked === 'metadata' ? '不影响已合入代码' : '目标分支未推进'}</span></div>`
    : '';
}
