import type { CatData } from '@/hooks/useCatData';
import type { MemberSaveTrace } from '@/utils/member-save-trace';
import {
  buildCodexConfigPatches,
  buildStrategyPayload,
  type CodexRuntimeSettings,
  initialState,
  type StrategyFormState,
  toStrategyForm,
} from '../../hub-cat-editor.model';
import { buildCatPayload, buildMemberPatchPayload, type CatPayloadContext } from '../../hub-cat-editor.payload';
import {
  codexFieldForConfigKey,
  type MemberDraft,
  rebaseCodexDraft,
  rebaseMemberDraft,
  rebaseStrategyDraft,
  withCodexField,
} from './member-editor-state';
import {
  attemptWrite,
  type MemberSaveLedger,
  type ReadBackVerdict,
  readCodexConfig,
  readMemberById,
  readMemberFromPayload,
  readSessionStrategyEntry,
  reconcileCodexReadBack,
  reconcileMemberReadBack,
  reconcileStrategyReadBack,
  type SaveStepResult,
  withExpectedRevision,
} from './member-save-readback';

interface StepInput {
  draft: MemberDraft;
  context: CatPayloadContext;
  headers: Record<string, string>;
  trace: Pick<MemberSaveTrace, 'headers' | 'phase'>;
}
interface StepRun {
  step: SaveStepResult;
  draft: MemberDraft;
  cat?: CatData;
}

function stepFailed(result: SaveStepResult): boolean {
  return result.status === 'failed' || result.status === 'conflict';
}

async function saveMemberUpdate(input: StepInput): Promise<StepRun> {
  let draft = input.draft;
  let baseline = draft.baseline;
  if (!baseline) return { step: { status: 'failed', message: '缺少成员基线，请重新读取。' }, draft };
  let payload = buildMemberPatchPayload(draft.form, baseline, input.context) as Record<string, unknown>;
  if (Object.keys(payload).length === 0) return { step: { status: 'skipped' }, draft, cat: baseline };
  let retried = false;
  for (;;) {
    const attempt = await attemptWrite({
      trace: input.trace,
      headers: input.headers,
      phase: 'member.write',
      method: 'PATCH',
      path: `/api/cats/${encodeURIComponent(baseline.id)}`,
      body: withExpectedRevision(payload, baseline.configurationRevision),
      formal: true,
    });
    if (attempt.kind === 'ok') {
      const cat = readMemberFromPayload(attempt.payload);
      if (!cat) return { step: { status: 'failed', message: '保存响应缺少成员配置，请重新读取后核对。' }, draft };
      draft = { ...draft, baseline: cat, form: initialState(cat), runtimeDrafts: undefined };
      return { step: { status: 'saved' }, draft, cat };
    }
    if (attempt.kind === 'conflict') return { step: { status: 'conflict', message: attempt.message }, draft };
    if (attempt.kind === 'failed') return { step: { status: 'failed', message: attempt.message }, draft };
    if (attempt.kind === 'revision-required') {
      if (retried) {
        return { step: { status: 'conflict', message: '成员配置版本已变化，请重新读取后核对再保存。' }, draft };
      }
      const latest = await readMemberById(baseline.id);
      if (!latest) return { step: { status: 'failed', message: '无法读取最新成员配置，请重新读取后核对。' }, draft };
      draft = rebaseMemberDraft(draft, latest);
      baseline = latest;
      payload = buildMemberPatchPayload(draft.form, baseline, input.context) as Record<string, unknown>;
      retried = true;
      if (Object.keys(payload).length === 0) return { step: { status: 'saved' }, draft, cat: latest };
      continue;
    }
    const latest = await readMemberById(baseline.id);
    if (!latest) {
      return { step: { status: 'failed', message: '保存结果未知：无法读回最新成员配置，请重新读取后核对。' }, draft };
    }
    const verdict = reconcileMemberReadBack(draft.form, baseline, latest);
    if (verdict === 'saved') {
      draft = { ...draft, baseline: latest, form: initialState(latest), runtimeDrafts: undefined };
      return { step: { status: 'saved' }, draft, cat: latest };
    }
    if (verdict === 'conflict') {
      return { step: { status: 'conflict', message: '成员配置已被其他页面修改，请重新读取后核对。' }, draft };
    }
    if (retried) {
      return { step: { status: 'failed', message: '保存超时且读回未确认本次修改，请重新读取后核对。' }, draft };
    }
    retried = true;
  }
}

async function saveMemberCreate(input: StepInput & { onBeforeCreate?: () => Promise<void> }): Promise<StepRun> {
  let draft = input.draft;
  const payload = buildCatPayload(draft.form, null, input.context) as Record<string, unknown>;
  const catId = typeof payload.catId === 'string' ? payload.catId.trim() : '';
  let prepared = false;
  let retried = false;
  for (;;) {
    if (!prepared && input.onBeforeCreate) {
      await input.trace.phase('onboarding.entry', input.onBeforeCreate);
      prepared = true;
    }
    const attempt = await attemptWrite({
      trace: input.trace,
      headers: input.headers,
      phase: 'member.write',
      method: 'POST',
      path: '/api/cats',
      body: payload,
      formal: false,
    });
    if (attempt.kind === 'ok') {
      const cat = readMemberFromPayload(attempt.payload);
      if (!cat) return { step: { status: 'failed', message: '创建响应缺少成员配置，请刷新成员列表核对。' }, draft };
      draft = { ...draft, baseline: cat, form: initialState(cat), runtimeDrafts: undefined };
      return { step: { status: 'saved' }, draft, cat };
    }
    if (attempt.kind === 'conflict') return { step: { status: 'conflict', message: attempt.message }, draft };
    if (attempt.kind === 'failed') return { step: { status: 'failed', message: attempt.message }, draft };
    // A create has no expected revision; never retry an unexplained 428 blindly.
    if (attempt.kind === 'revision-required') return { step: { status: 'failed', message: attempt.message }, draft };
    if (!catId) {
      return {
        step: { status: 'failed', message: '创建结果未知，且缺少稳定 catId 无法核对。请刷新成员列表确认后再重试。' },
        draft,
      };
    }
    const found = await readMemberById(catId);
    if (found) {
      draft = { ...draft, baseline: found, form: initialState(found), runtimeDrafts: undefined };
      return { step: { status: 'saved' }, draft, cat: found };
    }
    if (retried) {
      return {
        step: { status: 'failed', message: '创建结果仍未确认：已按 catId 核对未发现该成员，请刷新列表确认后再重试。' },
        draft,
      };
    }
    retried = true;
  }
}

function strategyRevision(strategy: StrategyFormState): string | undefined {
  return strategy.revision && strategy.revision !== 'unknown' ? strategy.revision : undefined;
}

/** Validate via buildStrategyPayload, then submit only the strategy fields the user actually changed. */
export function buildStrategySavePayload(intended: StrategyFormState, baseline: StrategyFormState) {
  const payload = buildStrategyPayload(intended) as Record<string, unknown>;
  const trimmed: Record<string, unknown> = { strategy: payload.strategy };
  const sameThresholds =
    Number.parseFloat(intended.warnThreshold) === Number.parseFloat(baseline.warnThreshold) &&
    Number.parseFloat(intended.actionThreshold) === Number.parseFloat(baseline.actionThreshold);
  if (!sameThresholds && payload.thresholds) trimmed.thresholds = payload.thresholds;
  if (payload.hybrid) trimmed.hybrid = payload.hybrid;
  return trimmed;
}

async function saveStrategy(input: StepInput & { catId: string }): Promise<StepRun> {
  let draft = input.draft;
  const baseline = draft.strategyBaseline;
  if (!draft.strategy || !baseline) return { step: { status: 'skipped' }, draft };
  if (JSON.stringify(draft.strategy) === JSON.stringify(baseline)) return { step: { status: 'skipped' }, draft };
  let current = draft.strategy;
  let retried = false;
  for (;;) {
    let payload: Record<string, unknown>;
    try {
      payload = buildStrategySavePayload(current, baseline);
    } catch (error) {
      return {
        step: { status: 'failed', message: error instanceof Error ? error.message : '会话策略格式不正确' },
        draft,
      };
    }
    const attempt = await attemptWrite({
      trace: input.trace,
      headers: input.headers,
      phase: 'strategy.write',
      method: 'PATCH',
      path: `/api/config/session-strategy/${encodeURIComponent(input.catId)}`,
      body: withExpectedRevision(payload, strategyRevision(current)),
      formal: true,
    });
    if (attempt.kind === 'ok') {
      const revision = typeof attempt.payload.revision === 'string' ? attempt.payload.revision : current.revision;
      draft = { ...draft, strategy: current, strategyBaseline: { ...current, revision } };
      return { step: { status: 'saved' }, draft, cat: draft.baseline ?? undefined };
    }
    if (attempt.kind === 'conflict') return { step: { status: 'conflict', message: attempt.message }, draft };
    if (attempt.kind === 'failed') return { step: { status: 'failed', message: attempt.message }, draft };
    if (attempt.kind === 'revision-required') {
      if (retried) {
        return { step: { status: 'conflict', message: '会话策略版本已变化，请重新读取后核对再保存。' }, draft };
      }
      const entry = await readSessionStrategyEntry(input.catId);
      if (!entry) return { step: { status: 'failed', message: '无法读取最新会话策略，请重新读取后核对。' }, draft };
      draft = rebaseStrategyDraft(draft, toStrategyForm(entry));
      current = draft.strategy ?? current;
      retried = true;
      continue;
    }
    const entry = await readSessionStrategyEntry(input.catId);
    if (!entry) {
      return { step: { status: 'failed', message: '保存结果未知：无法读回会话策略，请重新读取后核对。' }, draft };
    }
    const verdict: ReadBackVerdict = reconcileStrategyReadBack(current, baseline, entry);
    if (verdict === 'saved') {
      const latest = toStrategyForm(entry);
      draft = {
        ...draft,
        strategy: current,
        strategyBaseline: {
          ...current,
          revision: latest.revision,
          changedAt: latest.changedAt,
          executionStatus: latest.executionStatus,
        },
      };
      return { step: { status: 'saved' }, draft, cat: draft.baseline ?? undefined };
    }
    if (verdict === 'conflict') {
      return { step: { status: 'conflict', message: '会话策略已被其他页面修改，请重新读取后核对。' }, draft };
    }
    if (retried) {
      return { step: { status: 'failed', message: '保存超时且读回未确认会话策略，请重新读取后核对。' }, draft };
    }
    retried = true;
  }
}

async function saveCodex(input: StepInput): Promise<StepRun> {
  let draft = input.draft;
  const settings = draft.codexSettings;
  const baseline = draft.codexBaseline;
  if (!settings || !baseline) return { step: { status: 'skipped' }, draft };
  const patches = buildCodexConfigPatches(settings, baseline);
  if (patches.length === 0) return { step: { status: 'skipped' }, draft };
  let revisions = { ...(draft.codexWriteRevisions ?? {}) };
  let currentBaseline: CodexRuntimeSettings = { ...baseline };
  for (const patch of patches) {
    const field = codexFieldForConfigKey(patch.key);
    if (!field) continue;
    let expectedRevision = revisions[patch.key];
    let retried = false;
    for (;;) {
      const attempt = await attemptWrite({
        trace: input.trace,
        headers: input.headers,
        phase: 'codex.write',
        method: 'PATCH',
        path: '/api/config',
        body: withExpectedRevision({ key: patch.key, value: patch.value }, expectedRevision),
        formal: true,
      });
      if (attempt.kind === 'ok') {
        const revision = typeof attempt.payload.revision === 'string' ? attempt.payload.revision : expectedRevision;
        if (revision) revisions = { ...revisions, [patch.key]: revision };
        currentBaseline = withCodexField(currentBaseline, field, patch.value);
        draft = { ...draft, codexBaseline: currentBaseline, codexWriteRevisions: revisions };
        break;
      }
      if (attempt.kind === 'conflict') return { step: { status: 'conflict', message: attempt.message }, draft };
      if (attempt.kind === 'failed') return { step: { status: 'failed', message: attempt.message }, draft };
      if (attempt.kind === 'revision-required') {
        if (retried) {
          return { step: { status: 'conflict', message: 'Codex 全局设置版本已变化，请重新读取后核对再保存。' }, draft };
        }
        const snapshot = await readCodexConfig();
        if (!snapshot) {
          return { step: { status: 'failed', message: '无法读取最新 Codex 全局设置，请重新读取后核对。' }, draft };
        }
        draft = rebaseCodexDraft(draft, snapshot.settings, snapshot.writeRevisions);
        revisions = { ...(draft.codexWriteRevisions ?? {}) };
        currentBaseline = { ...(draft.codexBaseline ?? snapshot.settings) };
        expectedRevision = revisions[patch.key];
        retried = true;
        continue;
      }
      const snapshot = await readCodexConfig();
      if (!snapshot) {
        return {
          step: { status: 'failed', message: '保存结果未知：无法读回 Codex 全局设置，请重新读取后核对。' },
          draft,
        };
      }
      const verdict = reconcileCodexReadBack(patch.key, patch.value, currentBaseline[field], snapshot.settings);
      if (verdict === 'saved') {
        draft = rebaseCodexDraft(draft, snapshot.settings, snapshot.writeRevisions);
        currentBaseline = { ...(draft.codexBaseline ?? snapshot.settings) };
        break;
      }
      if (verdict === 'conflict') {
        return { step: { status: 'conflict', message: 'Codex 全局设置已被其他页面修改，请重新读取后核对。' }, draft };
      }
      if (retried) {
        return {
          step: { status: 'failed', message: '保存超时且读回未确认 Codex 全局设置，请重新读取后核对。' },
          draft,
        };
      }
      retried = true;
    }
  }
  return { step: { status: 'saved' }, draft };
}

export interface MemberSaveRunInput {
  draft: MemberDraft;
  accountAuthType: 'oauth' | 'api_key' | null;
  trace: MemberSaveTrace;
  onBeforeCreate?: () => Promise<void>;
  /** Persist each partially saved step so a later failure keeps the successful baseline. */
  commit: (draft: MemberDraft) => void;
}

export interface MemberSaveRunResult {
  draft: MemberDraft;
  ledger: MemberSaveLedger;
  savedCat: CatData | null;
  created: boolean;
  complete: boolean;
  notice: string;
  error: string | null;
  conflicted: boolean;
}

function summarize(ledger: MemberSaveLedger, created: boolean) {
  const complete = !stepFailed(ledger.member) && !stepFailed(ledger.strategy) && !stepFailed(ledger.codex);
  const conflicted =
    ledger.member.status === 'conflict' || ledger.strategy.status === 'conflict' || ledger.codex.status === 'conflict';
  if (complete) return { complete, conflicted, notice: '', error: null };
  const parts: string[] = [];
  parts.push(stepFailed(ledger.member) ? '成员未保存' : created ? '成员已创建' : '成员已保存');
  if (stepFailed(ledger.strategy)) parts.push('策略未保存');
  else if (ledger.strategy.status === 'saved') parts.push('会话策略已保存');
  if (stepFailed(ledger.codex)) parts.push('Codex 全局设置未保存');
  else if (ledger.codex.status === 'saved') parts.push('Codex 全局设置已保存');
  else if (ledger.codex.message) parts.push('Codex 全局设置未提交');
  const failure = [ledger.member, ledger.strategy, ledger.codex].find(stepFailed)?.message;
  return {
    complete,
    conflicted,
    notice: `${parts.join('，')}。草稿已保留，可重新保存或重新读取后核对。`,
    error: failure ?? '部分设置未保存，草稿已保留。',
  };
}

/**
 * Submit the member editor in three ordered units: S1 member CAS, S2 session strategy, S3 global
 * client settings. Never rolls back a successful unit; stops before the next unit on a hard failure.
 */
export async function runMemberSave(input: MemberSaveRunInput): Promise<MemberSaveRunResult> {
  const headers = input.trace.headers();
  const stepInput: StepInput = {
    draft: input.draft,
    context: { accountAuthType: input.accountAuthType },
    headers,
    trace: input.trace,
  };
  const ledger: MemberSaveLedger = {
    member: { status: 'skipped' },
    strategy: { status: 'skipped' },
    codex: { status: 'skipped' },
  };
  let draft = input.draft;
  let savedCat: CatData | null = draft.baseline;
  let created = false;

  const memberRun = draft.baseline
    ? await saveMemberUpdate(stepInput)
    : await saveMemberCreate({ ...stepInput, onBeforeCreate: input.onBeforeCreate });
  draft = memberRun.draft;
  ledger.member = memberRun.step;
  savedCat = memberRun.cat ?? savedCat;
  created = !input.draft.baseline && memberRun.step.status === 'saved';
  input.commit(draft);
  if (stepFailed(ledger.member)) {
    const summary = summarize(ledger, created);
    return { draft, ledger, savedCat: null, created, ...summary };
  }

  const catId = savedCat?.id;
  if (catId) {
    const strategyRun = await saveStrategy({ ...stepInput, draft, catId });
    draft = strategyRun.draft;
    ledger.strategy = strategyRun.step;
    input.commit(draft);
  }
  if (stepFailed(ledger.strategy)) {
    ledger.codex = { status: 'skipped', message: '会话策略未成功，本次未提交全局设置。' };
    const summary = summarize(ledger, created);
    return { draft, ledger, savedCat, created, ...summary };
  }

  const codexRun = await saveCodex({ ...stepInput, draft });
  draft = codexRun.draft;
  ledger.codex = codexRun.step;
  input.commit(draft);
  const summary = summarize(ledger, created);
  return { draft, ledger, savedCat, created, ...summary };
}
