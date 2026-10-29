'use client';
import type { MemberVisualAssets } from '@cat-cafe/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CatData } from '@/hooks/useCatData';
import { API_URL, apiFetch } from '@/utils/api-client';
import type { MemberSaveTrace } from '@/utils/member-save-trace';
import type { TemplateCard } from '../../first-run-quest/TemplateStep';
import type { AccountsResponse, ProfileItem } from '../../hub-accounts.types';
import {
  buildCodexConfigPatches,
  type CodexRuntimeSettings,
  type HubCatEditorFormState,
  initialState,
  type StrategyFormState,
  toCodexRuntimeSettings,
  toStrategyForm,
} from '../../hub-cat-editor.model';
import type { CatStrategyEntry } from '../../hub-strategy-types';
import { commitMemberAvatar } from './member-avatar-draft';
import {
  changedFields,
  type MemberDraft,
  persistMemberDraft,
  readMemberDraft,
  rebaseCodexDraft,
  rebaseMemberDraft,
  rebaseStrategyDraft,
  templateForm,
} from './member-editor-state';
import { patchMemberRuntime, type RuntimeChoice, switchMemberRuntime } from './member-runtime-draft';
import {
  type MemberSaveLedger,
  readCodexConfig,
  readCodexWriteRevisions,
  readMemberById,
  readSessionStrategyEntry,
} from './member-save-readback';
import { runMemberSave } from './member-save-steps';
import { useMemberSaveTrace } from './useMemberSaveTrace';

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `请求失败 (${response.status})`);
  return body as T;
}
export function useMemberEditor(
  cat: CatData | null,
  cats: CatData[],
  onSaved: (cat: CatData, trace?: MemberSaveTrace) => Promise<void>,
  onBeforeCreate?: () => Promise<void>,
) {
  const [draft, setDraft] = useState<MemberDraft>({
    version: 1,
    form: initialState(cat),
    baseline: cat,
    templateId: null,
    section: 'runtime',
  });
  const [accounts, setAccounts] = useState<ProfileItem[]>([]);
  const [templates, setTemplates] = useState<TemplateCard[]>([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const startSaveTrace = useMemberSaveTrace(saving);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [saveLedger, setSaveLedger] = useState<MemberSaveLedger | null>(null);
  const [codexError, setCodexError] = useState<string | null>(null);
  const [codexReload, setCodexReload] = useState(0);
  const storageKey = useRef('');
  const [reload, setReload] = useState(0);
  const stateRef = useRef(draft);
  stateRef.current = draft;

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    Promise.all([
      apiFetch('/api/accounts').then(readResponse<AccountsResponse>),
      apiFetch('/api/session').then(readResponse<{ userId: string }>),
      apiFetch('/api/cat-templates').then(readResponse<{ templates: TemplateCard[] }>),
    ])
      .then(([accountData, session, templateData]) => {
        if (cancelled) return;
        storageKey.current = `member-draft:v1:${API_URL}:${session.userId}:${accountData.projectPath}:${cat?.id ?? 'new'}`;
        const stored = readMemberDraft(storageKey.current);
        setDraft(
          stored &&
            (changedFields(stored.form, stored.baseline) > 0 ||
              JSON.stringify(stored.strategy) !== JSON.stringify(stored.strategyBaseline) ||
              JSON.stringify(stored.codexSettings) !== JSON.stringify(stored.codexBaseline))
            ? stored
            : {
                version: 1,
                form: initialState(cat),
                baseline: cat,
                templateId: null,
                section: stored?.section ?? 'runtime',
              },
        );
        setAccounts(accountData.providers);
        setTemplates(templateData.templates);
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [cat?.id, reload]); // A server refresh never resets a dirty form.

  useEffect(() => {
    if (!ready || !cat || draft.strategy !== undefined) return;
    let cancelled = false;
    apiFetch('/api/config/session-strategy')
      .then(readResponse<{ cats?: CatStrategyEntry[] }>)
      .then((body) => {
        if (cancelled) return;
        const entry = body.cats?.find((item) => item.catId === cat.id);
        const strategy = entry ? toStrategyForm(entry) : null;
        setDraft((previous) => ({ ...previous, strategy, strategyBaseline: strategy }));
      })
      .catch(() => {
        if (!cancelled) setNotice('会话策略暂不可读取，其他设置仍可保存；原策略会保留。');
      });
    return () => {
      cancelled = true;
    };
  }, [ready, cat?.id, draft.strategy]);

  useEffect(() => {
    if (
      !ready ||
      draft.section !== 'advanced' ||
      draft.form.clientId !== 'openai' ||
      draft.form.carrier === 'acp' ||
      cat?.identityProtection ||
      draft.codexBaseline
    )
      return;
    let cancelled = false;
    setCodexError(null);
    apiFetch('/api/config')
      .then(readResponse<{ config?: Parameters<typeof toCodexRuntimeSettings>[0]; writeRevisions?: unknown }>)
      .then((body) => {
        if (cancelled) return;
        if (!body.config) throw new Error('Codex 运行参数缺失，请重新读取。');
        const settings = toCodexRuntimeSettings(body.config);
        setDraft((previous) => ({
          ...previous,
          codexSettings: settings,
          codexBaseline: settings,
          codexWriteRevisions: readCodexWriteRevisions(body.writeRevisions),
        }));
      })
      .catch((err: unknown) => {
        if (!cancelled) setCodexError(err instanceof Error ? err.message : 'Codex 运行参数读取失败');
      });
    return () => {
      cancelled = true;
    };
  }, [
    ready,
    draft.section,
    draft.form.clientId,
    draft.form.carrier,
    draft.codexBaseline,
    cat?.identityProtection,
    codexReload,
  ]);

  const codexDirtyCount =
    draft.codexSettings && draft.codexBaseline
      ? buildCodexConfigPatches(draft.codexSettings, draft.codexBaseline).length
      : 0;

  const dirtyCount =
    changedFields(draft.form, draft.baseline) +
    (JSON.stringify(draft.strategy) !== JSON.stringify(draft.strategyBaseline) ? 1 : 0) +
    codexDirtyCount;
  useEffect(() => {
    if (!ready) return;
    const ok = persistMemberDraft(storageKey.current, draft);
    setStorageWarning(!ok);
  }, [draft, dirtyCount, ready]);
  useEffect(() => {
    if (!dirtyCount) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirtyCount]);

  const patch = useCallback((change: Partial<HubCatEditorFormState>) => {
    setNotice(null);
    setSaveLedger(null);
    setDraft((previous) => patchMemberRuntime(previous, change));
  }, []);
  const switchRuntime = (next: RuntimeChoice) => {
    setNotice(null);
    setSaveLedger(null);
    setDraft((previous) => switchMemberRuntime(previous, next));
  };
  const setSection = (section: string) => setDraft((previous) => ({ ...previous, section }));
  const chooseTemplate = (template: TemplateCard | null) =>
    setDraft((previous) => ({
      ...previous,
      templateId: template?.id ?? null,
      runtimeDrafts: undefined,
      form: template ? templateForm(template, cats, previous.form) : initialState(),
    }));
  const patchStrategy = (change: Partial<StrategyFormState>) => {
    setSaveLedger(null);
    setDraft((previous) => ({
      ...previous,
      strategy: previous.strategy ? { ...previous.strategy, ...change } : previous.strategy,
    }));
  };
  const patchCodex = (change: Partial<CodexRuntimeSettings>) => {
    setSaveLedger(null);
    setDraft((previous) => ({
      ...previous,
      codexSettings: previous.codexSettings ? { ...previous.codexSettings, ...change } : undefined,
    }));
  };
  const discard = () => {
    persistMemberDraft(storageKey.current, null);
    setDraft({ version: 1, form: initialState(cat), baseline: cat, templateId: null, section: draft.section });
    setError(null);
    setNotice(null);
    setConflicted(false);
    setSaveLedger(null);
  };

  const refreshBaseline = async () => {
    const snapshot = stateRef.current;
    const catId = snapshot.baseline?.id;
    if (!catId) {
      setError('该成员尚未创建，请直接保存。');
      return;
    }
    try {
      const latest = await readMemberById(catId);
      if (!latest) throw new Error('该成员已不存在，草稿仍保留。');
      let next = rebaseMemberDraft(snapshot, latest);
      const [strategyEntry, config] = await Promise.all([readSessionStrategyEntry(catId), readCodexConfig()]);
      if (strategyEntry) next = rebaseStrategyDraft(next, toStrategyForm(strategyEntry));
      if (config) next = rebaseCodexDraft(next, config.settings, config.writeRevisions);
      setDraft(next);
      persistMemberDraft(storageKey.current, next);
      setSaveLedger(null);
      setConflicted(false);
      setError(null);
      setNotice('已读取最新配置并保留你的修改。请核对后再次保存；同一字段以你的修改为准。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '重新读取失败');
    }
  };
  const save = async () => {
    const snapshot = stateRef.current;
    const { baseline } = snapshot;
    const form = baseline
      ? snapshot.form
      : { ...snapshot.form, roleDescription: snapshot.form.roleDescription.trim() || '团队伙伴' };
    if (!form.name.trim()) {
      setError('请填写名字。');
      return;
    }
    if (form.clientId === 'acp' && form.carrier !== 'acp') {
      setError('请选择 ACP 接入方式，并填写有效的启动程序与参数。');
      return;
    }
    if (saving) return;
    const trace = startSaveTrace();
    setSaving(true);
    setError(null);
    setNotice(null);
    setSaveLedger(null);
    try {
      const account = accounts.find((item) => item.id === form.accountRef);
      const result = await runMemberSave({
        draft: baseline ? snapshot : { ...snapshot, form },
        accountAuthType: account?.authType ?? null,
        trace,
        onBeforeCreate,
        commit: (next) => {
          setDraft(next);
          persistMemberDraft(storageKey.current, next);
        },
      });
      setSaveLedger(result.ledger);
      setConflicted(result.conflicted);
      if (result.complete) {
        persistMemberDraft(storageKey.current, null);
        setNotice('已保存。正在运行的回合不变，后续调用使用新设置。');
        const saved = result.savedCat ?? baseline;
        if (saved)
          await trace
            .phase('refresh', () => onSaved(saved, trace))
            .catch(() => setNotice('配置已保存，成员列表刷新失败，请重新打开列表。'));
        return;
      }
      trace.fail();
      setNotice(result.notice);
      setError(result.error);
      // Keep a successfully saved member visible to the rest of the app without closing the editor.
      const savedCat = result.savedCat;
      if (baseline && savedCat && savedCat.id === baseline.id)
        await trace.phase('refresh', () => onSaved(savedCat, trace)).catch(() => undefined);
    } catch (err) {
      trace.fail();
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      trace.finish();
      setSaving(false);
    }
  };
  return {
    draft,
    accounts,
    templates,
    ready,
    saving,
    error,
    notice,
    storageWarning,
    dirtyCount,
    conflicted,
    saveLedger,
    refreshBaseline,
    patch,
    avatarCommitted: (value: { avatar?: string; visualAssets: MemberVisualAssets }) =>
      setDraft((previous) => commitMemberAvatar(previous, value)),
    switchRuntime,
    setSection,
    chooseTemplate,
    patchStrategy,
    patchCodex,
    codexError,
    codexDirtyCount,
    retryCodex: () => setCodexReload((value) => value + 1),
    discard,
    save,
    retry: () => setReload((value) => value + 1),
  };
}
