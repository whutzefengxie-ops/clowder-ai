import { createHash } from 'node:crypto';
import { recoverDelivery } from './acceptance.mjs';
import { fail, objectUrl, validateConfig } from './config.mjs';
import { readConflict, resolveConflict } from './conflicts.mjs';
import { GitReceiver } from './git.mjs';
import { assertLedger } from './ledger.mjs';
import { mapIssue, recordReceipts, templates } from './metadata.mjs';
import { checkPlan } from './plan.mjs';
import { git } from './process.mjs';
import { event, Store } from './store.mjs';
import { cancelVersion, selectTag, sourceStillValid, tags, versionTemplate } from './version.mjs';
import { VersionGitReceiver } from './version-git.mjs';

export class Receiver {
  constructor(input) {
    this.config = validateConfig(input);
    this.store = new Store(this.config.stateDir);
    this.git = this.config.mode === 'version' ? new VersionGitReceiver(this.config) : new GitReceiver(this.config);
  }
  async read() {
    const state = await this.store.read();
    if (state && (state.schema !== 1 || state.bindingId !== this.config.bindingId || !Array.isArray(state.deliveries)))
      fail('BINDING_CONFLICT', '台账版本或仓库绑定不匹配');
    if (state) assertLedger(state);
    return state;
  }
  async change(action, preserveError = false) {
    return this.store.locked(async () => {
      const state = await this.read();
      if (!state) fail('NOT_ADOPTED', '先核验并登记两侧已有基线');
      try {
        await action(state);
      } catch (error) {
        const delivery = this.active(state);
        if (delivery) {
          recordFailure(delivery, error, preserveError);
          event(state, delivery, error.message);
        }
        await this.store.save(state);
        throw error;
      }
      await this.store.save(state);
      return state;
    });
  }
  active(state) {
    return state.deliveries.find(
      (item) => item.id === state.activeId && !['COMPLETE', 'CANCELLED'].includes(item.status),
    );
  }
  async adopt(upstream, internal) {
    return this.store.locked(async () => {
      if (await this.read()) fail('ALREADY_ADOPTED', '已有台账，不能重新初始化覆盖');
      const heads = await this.git.fetch();
      upstream = await this.git.sha(upstream);
      internal = await this.git.sha(internal);
      if (heads.internal !== internal) fail('STALE_INTERNAL_HEAD', '内部基线不是当前 main，重新读取后确认');
      if (this.config.mode === 'version') await this.git.baseline(upstream, internal);
      if (
        !(await this.git.isAncestor(upstream, heads.upstream)) ||
        (this.config.mode !== 'version' && !(await this.git.sameTree(upstream, internal)))
      )
        fail('BASELINE_MISMATCH', '上游基线不在交付历史中，或两侧核心树不一致');
      if (!(await this.git.mainBoundary(upstream, heads.upstream)))
        fail('BASELINE_NOT_MAIN_BOUNDARY', '基线必须是上游 main 的实际接受边界');
      const state = {
        schema: 1,
        mode: this.config.mode,
        bindingId: this.config.bindingId,
        initial: { upstream, internal },
        accepted: { upstream, internal },
        latest: heads.upstream,
        observedInternal: internal,
        activeId: null,
        queue: [],
        deliveries: [],
        issues: {},
        events: [],
      };
      event(state, null, '已有两仓基线核验并登记；未修改内部 main');
      await this.store.save(state);
      return state;
    });
  }
  async setQueue(plans) {
    if (this.config.mode === 'version') fail('WRONG_MODE', '按版本更新请选择目标 tag');
    return this.change(async (state) => {
      await this.replaceQueue(state, plans, await this.git.fetch());
    });
  }
  async replaceQueue(state, plans, heads) {
    if (this.active(state)) fail('RECOVERY_FIRST', '存在未完成交付，先恢复，不重新扫描');
    if (heads.internal !== state.accepted.internal) fail('CORE_DRIFT', '内部 main 与接受台账不一致');
    let base = state.accepted.upstream;
    for (const plan of plans) {
      await checkPlan(this.git, plan, base, heads.upstream);
      base = plan.target;
    }
    if (base !== heads.upstream) fail('SOURCE_UNPROVEN', '交付清单没有完整覆盖冻结上游范围');
    state.queue = structuredClone(plans);
    state.latest = heads.upstream;
    event(state, null, `已冻结 ${plans.length} 笔连续上游交付`);
  }
  async start() {
    return this.change(async (state) => {
      if (this.active(state)) fail('RECOVERY_FIRST', '先完成原交付，不新建重复对象');
      const plan = state.queue[0];
      if (!plan) fail('NO_DELIVERY', '没有待接收交付，先发现更新');
      const heads = await this.git.fetch();
      if (heads.internal !== state.accepted.internal) fail('CORE_DRIFT', '内部 main 与冻结基线不同');
      await sourceStillValid(this, plan, heads);
      const id = createHash('sha256')
        .update(
          `${state.bindingId}:${plan.source.id}:${plan.target}${this.config.mode === 'version' ? `:${state.accepted.internal}:${state.deliveries.length}` : ''}`,
        )
        .digest('hex')
        .slice(0, 24);
      const delivery = {
        ...structuredClone(plan),
        id,
        branch: `sync/${id}`,
        base: { ...state.accepted },
        status: this.config.mode === 'version' ? 'CODE_PREPARE_REQUIRED' : 'ISSUES_REQUIRED',
        candidate: null,
        issueResults: {},
      };
      delivery.commits = (
        await git(this.git.directory, ['rev-list', '--reverse', `${delivery.base.upstream}..${delivery.target}`])
      ).split('\n');
      state.deliveries.push(delivery);
      state.activeId = id;
      event(
        state,
        delivery,
        this.config.mode === 'version'
          ? '版本交付已冻结；核对文件规则后准备一个候选分支'
          : '交付已冻结；内部 Issue 在平台创建或复用，然后登记映射',
      );
    });
  }
  async linkIssue(sourceId, internalId, url) {
    return this.change(async (state) => {
      const delivery = this.requireActive(state);
      mapIssue(state, delivery, sourceId, internalId, url);
      event(state, delivery, '内部 Issue 来源映射已登记');
    });
  }
  requireActive(state) {
    const active = this.active(state);
    if (!active) fail('NO_ACTIVE_DELIVERY', '没有未完成交付');
    return active;
  }
  async prepare() {
    return this.change(async (state) => {
      const delivery = this.requireActive(state);
      this.requirePreparation(state, delivery);
      if (['PR_REQUIRED', 'WAITING_APPROVAL'].includes(delivery.status) && !delivery.error) {
        if ((await this.git.remoteBranch(delivery.branch)) !== delivery.candidate)
          fail('CANDIDATE_CONFLICT', '已经推送的候选发生变化，暂停核对');
        return;
      }
      const heads = await this.git.fetch();
      state.observedInternal = heads.internal;
      if (heads.internal !== delivery.base.internal) fail('RECOVERY_FIRST', 'main 已前进，先核对原交付合入结果');
      await sourceStillValid(this, delivery, heads);
      delivery.candidate ??= await this.git.candidate(
        delivery.base,
        delivery.target,
        delivery.id,
        delivery.resolutions,
      );
      await this.store.save(state); // Freeze the candidate before any remote effect.
      delivery.checks = await this.git.checks(delivery.candidate);
      const checkedHeads = await this.git.fetch();
      if (checkedHeads.internal !== delivery.base.internal)
        fail('RECOVERY_FIRST', '检查期间内部 main 已改变，先核对原交付');
      await sourceStillValid(this, delivery, checkedHeads);
      delivery.status = 'PUSH_RESULT_UNKNOWN';
      event(state, delivery, '候选推送意图已保存；结果不明时先读取同名 ref');
      await this.store.save(state);
      await this.git.publish(delivery);
      delivery.status = 'PR_REQUIRED';
      delete delivery.error;
      event(state, delivery, '候选分支已推送并回读；内部 main 未修改，等待平台创建 PR');
    });
  }
  requirePreparation(state, delivery) {
    if (delivery.acceptedInternal) fail('METADATA_ONLY', '代码已接受，仅补元数据');
    if (!delivery.issues.every((issue) => state.issues[issue.sourceId]))
      fail('ISSUES_REQUIRED', '先登记全部内部 Issue 映射');
    if (this.config.mode !== 'version' && this.config.commitClosureVerified !== true)
      fail('PLATFORM_CLOSURE_UNVERIFIED', '先实测原始 commit 不会误关内部 Issue；配置未确认，禁止推送');
    if (!this.config.checks?.length) fail('CHECKS_REQUIRED', '至少配置一项核心/插件检查，不能把未检查当通过');
  }
  async linkPr(url) {
    return this.change(async (state) => {
      const delivery = this.requireActive(state);
      if (!['PR_REQUIRED', 'WAITING_APPROVAL'].includes(delivery.status)) fail('PR_NOT_READY', '候选分支尚未确认推送');
      if (delivery.prUrl && delivery.prUrl !== url) fail('PR_MAPPING_CONFLICT', '同一交付已有其他 PR 链接');
      delivery.prUrl = objectUrl(url);
      delivery.status = 'WAITING_APPROVAL';
      event(state, delivery, '已登记内部 PR；请在内部平台完成独立审核和合入');
    });
  }
  async recover() {
    return this.change(async (state) => {
      await recoverDelivery(this, state, this.requireActive(state));
    });
  }
  async receipts(observations) {
    return this.change(async (state) => {
      const delivery = this.requireActive(state);
      if (delivery.status !== 'CODE_ACCEPTED_PENDING_METADATA')
        fail('CODE_NOT_ACCEPTED', '先核验实际 main 并记录接受版本');
      if ((await this.git.fetch()).internal !== delivery.acceptedInternal)
        fail('ACCEPTED_HEAD_CONFLICT', '保存接收记录前 main 已改变，暂停核对');
      await recordReceipts(state, delivery, observations, this.git);
      delivery.status = 'COMPLETE';
      delete delivery.error;
      state.queue.shift();
      event(state, delivery, '本笔接收记录已保存；关联 Issue 可以保持打开，下一笔已开放');
    });
  }
  async status() {
    const state = await this.read();
    return state
      ? {
          ...state,
          active: this.active(state),
          templates: this.active(state)
            ? this.config.mode === 'version'
              ? versionTemplate(this.active(state))
              : templates(this.active(state), state.issues)
            : null,
        }
      : null;
  }
  tags() {
    return tags(this);
  }
  selectTag(name) {
    return selectTag(this, name);
  }
  cancelVersion() {
    return cancelVersion(this);
  }
  conflict(path) {
    return readConflict(this, path);
  }
  resolve(path, choice, content) {
    return resolveConflict(this, path, choice, content);
  }
}
function recordFailure(delivery, error, preserveError) {
  if (preserveError && delivery.error) return;
  delivery.error = { code: error.code ?? 'EXECUTION_FAILED', message: error.message };
  if (error.details) delivery.error.details = error.details;
}
