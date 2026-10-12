import { fail } from './config.mjs';
import { event } from './store.mjs';
import { freezeTag, listTags, verifyTag } from './tags.mjs';
import { changeList, entries } from './trees.mjs';

export function requireVersion(receiver) {
  if (receiver.config.mode !== 'version') fail('WRONG_MODE', '此操作仅用于按版本更新模式');
}
export async function tags(receiver) {
  requireVersion(receiver);
  return receiver.store.locked(() => listTags(receiver.git));
}
export async function selectTag(receiver, name) {
  requireVersion(receiver);
  return receiver.change(async (state) => {
    if (receiver.active(state)) fail('RECOVERY_FIRST', '先完成或恢复当前版本交付');
    const heads = await receiver.git.fetch();
    if (!(await receiver.git.isAncestor(state.accepted.internal, heads.internal)))
      fail('CORE_DRIFT', '内部历史发生改写，不能自动接管');
    await receiver.git.baseline(state.accepted.upstream, heads.internal);
    const tag = await freezeTag(receiver.git, name);
    if (tag.commit === state.accepted.upstream) fail('NO_VERSION_UPDATE', '这个版本已经接收，无需重复更新');
    if (
      !(await receiver.git.isAncestor(state.accepted.upstream, tag.commit)) ||
      !(await receiver.git.isAncestor(tag.commit, heads.upstream))
    )
      fail('VERSION_NOT_FORWARD', '目标 tag 不在已接收版本之后的来源分支历史中');
    if (heads.internal !== state.accepted.internal) {
      state.accepted.internal = heads.internal;
      event(state, null, '已核验并接管允许路径中的内部定制提交；上游接收版本保持不变');
    }
    const before = await entries(receiver.git.directory, state.accepted.upstream);
    const after = await entries(receiver.git.directory, tag.commit);
    const local = await entries(receiver.git.directory, heads.internal);
    const changes = changeList(before, after, receiver.config);
    const internalChanges = changeList(before, local, receiver.config);
    state.queue = [
      {
        mode: 'version',
        target: tag.commit,
        frozenTag: tag,
        source: { id: `tag:${tag.object}`, tag: name, title: `版本更新 ${name}` },
        issues: [],
        preview: { changes, internalChanges },
      },
    ];
    state.latest = tag.commit;
    state.observedInternal = heads.internal;
    event(state, null, `已冻结目标 tag ${name}、来源 SHA 与内部基线；只创建一个版本更新 PR`);
  });
}
export async function sourceStillValid(receiver, delivery, heads) {
  if (receiver.config.mode === 'version') await verifyTag(receiver.git, delivery.frozenTag);
  if (!(await receiver.git.isAncestor(delivery.target, heads.upstream)))
    fail('SOURCE_REWRITTEN', '冻结目标已不在来源分支历史中');
}
export async function cancelVersion(receiver) {
  requireVersion(receiver);
  return receiver.change(async (state) => {
    const delivery = receiver.requireActive(state);
    if (
      delivery.prUrl ||
      !['CODE_PREPARE_REQUIRED'].includes(delivery.status) ||
      (await receiver.git.remoteBranch(delivery.branch))
    )
      fail('CANCEL_UNSAFE', '候选可能已发布，必须恢复原交付，不能撤销台账');
    delivery.status = 'CANCELLED';
    delete delivery.error;
    state.activeId = null;
    state.queue = [];
    state.latest = state.accepted.upstream;
    event(state, delivery, '未发布的版本交付已撤销；历史记录保留，可重新选择 tag');
  });
}
export function versionTemplate(delivery) {
  const descriptions = { internal: '保留内部版本', merge: '三方合并', upstream: '跟随上游' };
  return {
    title: `[版本更新] ${delivery.source.tag}`,
    body: [
      `目标 tag：${delivery.source.tag}`,
      `标签对象：${delivery.frozenTag.object}`,
      `来源版本：${delivery.base.upstream} → ${delivery.target}`,
      `内部基线：${delivery.base.internal}`,
      `候选分支：${delivery.branch}`,
      `候选 head：${delivery.candidate ?? '尚未准备'}`,
      `交付标识：${delivery.id}`,
      '',
      '上游文件变更：',
      ...delivery.preview.changes.map((change) => `${change.path} · ${change.kind} · ${descriptions[change.category]}`),
      '',
      '内部差异：',
      ...delivery.preview.internalChanges.map((change) => `${change.path} · ${descriptions[change.category]}`),
      '',
      '只接收版本内容，不搬运 Issue 或上游 PR，不重放原始提交消息。',
      '在内部平台独立审核合入，回来核验冻结候选并记录版本对应。',
    ].join('\n'),
  };
}
