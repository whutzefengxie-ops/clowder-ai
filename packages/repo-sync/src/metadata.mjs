import { fail, objectUrl } from './config.mjs';

export function mapIssue(state, delivery, sourceId, internalId, url) {
  const issue = delivery.issues.find((item) => item.sourceId === sourceId);
  if (!issue || !/^[\w-]+$/.test(String(internalId))) fail('ISSUE_MAPPING_INVALID', '来源 Issue 或内部身份无效');
  const existing = state.issues[sourceId];
  if (existing && (existing.internalId !== String(internalId) || existing.url !== url))
    fail('ISSUE_MAPPING_CONFLICT', '同一来源已存在不同内部映射，暂停核对');
  state.issues[sourceId] = existing ?? { internalId: String(internalId), url: objectUrl(url), receipts: [] };
}
export async function recordReceipts(state, delivery, observations, receiver) {
  const updates = [];
  for (const issue of delivery.issues) {
    updates.push(await observeIssue(state, delivery, issue, observations, receiver));
  }
  for (const { sourceId, mapping, pending, observation } of updates) {
    if (!mapping.receipts.some((receipt) => receipt.deliveryId === delivery.id))
      mapping.receipts.push({
        deliveryId: delivery.id,
        target: delivery.target,
        state: observation.state,
        pending,
        confirmedBy: 'operator',
        time: new Date().toISOString(),
      });
    mapping.state = observation.state;
    delivery.issueResults[sourceId] = { state: observation.state, pending, recorded: true };
  }
}
async function observeIssue(state, delivery, issue, observations, receiver) {
  const mapping = state.issues[issue.sourceId];
  const observation = observations.find((item) => item.sourceId === issue.sourceId);
  if (
    !mapping ||
    !observation ||
    observation.internalId !== mapping.internalId ||
    !['open', 'closed'].includes(observation.state)
  )
    fail('ISSUE_OBSERVATION_INVALID', '需要逐个确认正确映射的内部 Issue 状态');
  const pending = [];
  for (const target of issue.requiredTargets ?? [delivery.target]) {
    if (!(await receiver.isAncestor(target, delivery.acceptedInternal))) pending.push(target);
  }
  if (issue.relation === 'closes') checkClosing(observation.state, pending);
  return { sourceId: issue.sourceId, mapping, pending, observation };
}
function checkClosing(status, pending) {
  if (pending.length && status !== 'open')
    fail('ISSUE_CLOSED_EARLY', '接收条件尚未完成，内部 Issue 被提前关闭；请先在平台处理');
  if (!pending.length && status !== 'closed')
    fail('ISSUE_UPDATE_PENDING', '接收条件已满足，仍需在内部平台关闭并回读确认');
}
export function templates(delivery, mappings = {}) {
  const source = delivery.source;
  return {
    title: `[上游同步] PR #${source.number} · ${source.title}`,
    body: [
      `来源：${source.url}`,
      `交付标识：${delivery.id}`,
      `上游范围：${delivery.base.upstream} → ${delivery.target}`,
      `候选 head：${delivery.candidate ?? '尚未准备'}`,
      `内部 base：${delivery.base.internal}`,
      '实际落地提交：',
      ...(delivery.commits ?? []),
      '',
      '保留原始对象；在内部平台正常审核合入。',
      'Issue 对应：',
      ...delivery.issues.map(
        (issue) =>
          `${issue.url} → ${mappings[issue.sourceId] ? `内部 #${mappings[issue.sourceId].internalId} ${mappings[issue.sourceId].url}` : '请填写内部对象'}；关系：${issue.relation === 'closes' ? '接收条件完成后关闭' : '普通关联，保留状态'}`,
      ),
    ].join('\n'),
  };
}
