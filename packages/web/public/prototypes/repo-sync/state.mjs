import { defaultBinding, emptyBinding } from './binding.mjs';
import { COMPLETE, deliveries } from './data.mjs';

const snapshot = (index, phase, block = null) => ({
  ...structuredClone(deliveries[index]),
  phase,
  block,
  internalPr: phase >= 4 ? deliveries[index].internalPr : null,
  internalIssue: phase >= 3 ? deliveries[index].internalIssue : null,
});
export function createState(scenario = 'waiting', binding = defaultBinding()) {
  const state = {
    schema: 2,
    scenario,
    latest: deliveries[1].target,
    binding: structuredClone(binding),
    archives: [],
    accepted: binding.baseline,
    internalSha: binding.initialInternalSha,
    active: null,
    deliveries: structuredClone(deliveries),
    events: [
      {
        label: '以指定上游版本初始化内部核心仓（模拟）',
        note: `基线 ${binding.baseline} → 内部初始化 ${binding.initialInternalSha}`,
      },
    ],
  };
  if (scenario === 'waiting') state.active = snapshot(0, 6);
  if (scenario === 'timeout') state.active = snapshot(0, 4, 'timeout');
  if (scenario === 'plugin') state.active = snapshot(0, 5, 'plugin');
  if (scenario === 'drift') state.active = snapshot(0, 1, 'drift');
  if (scenario === 'metadata' || scenario === 'synced') {
    state.accepted = state.latest;
    state.internalSha = '12c79a50';
    state.active = snapshot(1, scenario === 'synced' ? COMPLETE : 8, scenario === 'synced' ? null : 'metadata');
  }
  if (scenario === 'unconfigured' || binding.status !== 'ready') {
    state.binding = scenario === 'unconfigured' ? emptyBinding() : structuredClone(binding);
    state.accepted = null;
    state.internalSha = null;
    state.active = null;
    state.scenario = 'unconfigured';
    state.events = [{ label: '等待仓库连接配置', note: '连接、检查、保存并初始化后，才能开始接收交付。' }];
  }
  if (state.active) state.active.bindingId = state.binding.id;
  return state;
}
function log(state, label, note = '') {
  state.events.push({
    label,
    note,
    deliveryId: state.active?.id,
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
  });
}
const handlers = {
  external(state) {
    const number = state.deliveries.length + 41;
    const delivery = {
      ...deliveries[1],
      id: `delivery-0${number}`,
      target: `f${number}ac9021`,
      sourcePr: number + 46,
      internalPr: number + 52,
      issue: number + 35,
      internalIssue: number + 278,
      title: `新增通用能力交付 ${number}`,
      commits: [`f${number}ac9021`],
      time: '刚刚',
    };
    state.deliveries.push(delivery);
    state.latest = delivery.target;
    log(state, '外部新交付加入队列', '当前交付目标保持冻结');
  },
  start(state) {
    if (state.binding?.status !== 'ready') return;
    if (state.active && state.active.phase !== COMPLETE) return;
    const index = state.deliveries.findIndex((item) => item.target === state.accepted) + 1;
    const next = state.deliveries[index];
    if (next) {
      state.active = {
        ...structuredClone(next),
        bindingId: state.binding.id,
        phase: 1,
        block: null,
        internalPr: null,
        internalIssue: null,
      };
      log(state, '已冻结同步目标', `${next.id} · ${next.target}`);
    }
  },
  advance(state) {
    const active = state.active;
    if (!active || active.block || active.phase >= COMPLETE || active.phase === 6) return;
    active.phase += 1;
    const original = state.deliveries.find((item) => item.id === active.id);
    if (active.phase === 3) active.internalIssue = original.internalIssue;
    if (active.phase === 4) active.internalPr = original.internalPr;
    if (active.phase === 8) state.accepted = active.target;
    log(state, active.phase === COMPLETE ? 'Issue 状态核对完成，交付完成' : '程序步骤完成', `当前阶段 ${active.phase}`);
  },
  approve(state, action) {
    const active = state.active;
    if (active?.phase !== 6 || active.block) return;
    state.internalSha = `1${state.deliveries.findIndex((item) => item.id === active.id) + 1}c79a50`;
    active.phase = 7;
    log(state, '模拟内部平台 PR 合入，等待程序核验', action.note || '平台审批通过');
  },
  recover(state) {
    const active = state.active;
    if (!active?.block || active.block === 'drift') return;
    const block = active.block;
    active.block = null;
    active.phase = block === 'metadata' ? COMPLETE : block === 'plugin' ? 6 : 5;
    log(
      state,
      block === 'timeout'
        ? '已查回既有 PR，继续同一交付'
        : block === 'plugin'
          ? '插件检查重跑通过，等待审批'
          : 'Issue 状态已补齐，未重复合入',
    );
  },
};
export function reduce(current, action) {
  const state = structuredClone(current);
  handlers[action.type]?.(state, action);
  return state;
}
export function summary(state) {
  const acceptedIndex = state.deliveries.findIndex((item) => item.target === state.accepted);
  const behind = state.deliveries.length - acceptedIndex - 1;
  const codeLatest = state.accepted === state.latest;
  const pending = state.active && state.active.phase < COMPLETE;
  return {
    codeLatest,
    fullyComplete: codeLatest && !pending,
    behind,
    pendingPr: state.active?.internalPr && state.active.phase < 7 ? 1 : 0,
  };
}
