import { phases } from './data.mjs';
import { escapeHtml } from './html.mjs';
export function renderFlow(active, selectedPhase) {
  return phases
    .slice(1)
    .map((name, index) => renderNode(name, index + 1, active, selectedPhase))
    .join('');
}
function renderNode(name, phase, active, selectedPhase) {
  const now = active?.phase === phase;
  const done = Boolean(active && phase < active.phase) || (phase === 8 && now);
  let tone = '';
  let label = '待执行';
  if (done) {
    tone = 'done';
    label = '已完成';
  } else if (now) {
    tone = 'current';
    label = phase === 6 ? '待审核' : '当前阶段';
    if (active.block) {
      tone = 'blocked';
      label = '需处理';
    }
  }
  const selected = selectedPhase === phase;
  return `<button type="button" class="flow-node ${tone} ${selected ? 'focused' : ''}" data-phase="${phase}" aria-pressed="${selected}"><span class="node-circle">${done ? '✓' : phase}</span><strong>${name}</strong><small>${label}</small></button>`;
}
export function renderQueue(state, current) {
  const acceptedIndex = state.deliveries.findIndex((item) => item.target === state.accepted);
  return state.deliveries
    .map((item, index) => {
      const active = item.id === state.active?.id;
      const done = index <= acceptedIndex && (!active || state.active.phase === 8);
      let tone = '';
      let mark = '○';
      let label = '待同步';
      if (active) {
        tone = 'warm';
        mark = '↻';
        label = current;
      }
      if (done) {
        tone = 'good';
        mark = '✓';
        label = '已完成';
      }
      return `<button type="button" class="delivery ${active ? 'active' : ''}" data-delivery="${item.id}"><span class="delivery-mark ${tone}">${mark}</span><div><strong>${escapeHtml(item.title)}</strong><small>外部 PR #${item.sourcePr} · ${item.mode} · ${item.commits.length} 个落地提交</small></div><span class="delivery-status">${label}<small>${item.time}</small></span></button>`;
    })
    .join('');
}
