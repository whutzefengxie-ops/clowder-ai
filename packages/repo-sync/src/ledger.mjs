import { fail } from './config.mjs';

const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const pair = (value) => value && sha(value.upstream) && sha(value.internal);
export function assertLedger(state) {
  if (
    !pair(state.accepted) ||
    !pair(state.initial) ||
    !sha(state.latest) ||
    !Array.isArray(state.queue) ||
    !Array.isArray(state.events) ||
    !state.issues ||
    Array.isArray(state.issues) ||
    typeof state.issues !== 'object'
  )
    fail('LEDGER_INVALID', '台账缺少接受版本、队列或映射等必要字段；暂停，不能重建空台账');
  if (state.activeId !== null && typeof state.activeId !== 'string') fail('LEDGER_INVALID', '活动交付身份无效');
  const pending = state.deliveries.filter((delivery) => delivery.status !== 'COMPLETE');
  if (pending.length > 1 || (pending.length === 1 && pending[0].id !== state.activeId))
    fail('LEDGER_INVALID', '未完成交付与活动身份不一致，暂停以防丢失恢复任务');
}
