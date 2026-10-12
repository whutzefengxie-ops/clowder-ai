import { fail } from './config.mjs';
import { discover } from './github.mjs';

export async function dispatch(receiver, input, options) {
  const actions = {
    heads: () => receiver.store.locked(() => receiver.git.fetch()),
    adopt: () => receiver.adopt(input.upstream, input.internal),
    discover: () => discover(receiver),
    start: () => receiver.start(),
    issue: () => receiver.linkIssue(input.sourceId, input.internalId, input.url),
    prepare: () => receiver.prepare(),
    pr: () => receiver.linkPr(input.url),
    recover: () => receiver.recover(),
    receipts: () => receiver.receipts(input.observations),
  };
  if (options.demoMerge)
    actions['demo-merge'] = () =>
      receiver.store.locked(async () => {
        const state = await receiver.status();
        if (state.active?.status !== 'WAITING_APPROVAL' || state.active.id !== input.deliveryId)
          fail('DEMO_PR_NOT_CURRENT', '模拟 PR 不属于当前待审核交付');
        await options.demoMerge(state.active);
      });
  if (!Object.hasOwn(actions, input.action)) fail('UNKNOWN_ACTION', '未知操作');
  return actions[input.action]();
}
