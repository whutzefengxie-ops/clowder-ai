import type { CatData } from '@/hooks/useCatData';
import type { TemplateCard } from '../../first-run-quest/TemplateStep';
import {
  autoSlug,
  type CodexApprovalPolicy,
  type CodexAuthMode,
  type CodexRuntimeSettings,
  type CodexSandboxMode,
  type HubCatEditorFormState,
  initialState,
  type StrategyFormState,
} from '../../hub-cat-editor.model';
import { normalizeMemberDraftBaseline, normalizeMemberDraftForm } from './member-carrier-compat';
import type { RuntimeDrafts } from './member-runtime-draft';

export interface MemberDraft {
  runtimeDrafts?: RuntimeDrafts;
  version: 1;
  form: HubCatEditorFormState;
  baseline: CatData | null;
  templateId: string | null;
  section: string;
  strategy?: StrategyFormState | null;
  strategyBaseline?: StrategyFormState | null;
  codexSettings?: CodexRuntimeSettings;
  codexBaseline?: CodexRuntimeSettings;
  /** S3 CAS: the last revision each global Codex key was read or written at. */
  codexWriteRevisions?: Record<string, string>;
}

/** S3 global keys owned by the member editor, mapped to their settings field. */
export const CODEX_CONFIG_KEY_BY_FIELD: Record<keyof CodexRuntimeSettings, string> = {
  sandboxMode: 'cli.codexSandboxMode',
  approvalPolicy: 'cli.codexApprovalPolicy',
  authMode: 'codex.execution.authMode',
};

export function codexFieldForConfigKey(key: string): keyof CodexRuntimeSettings | null {
  for (const [field, configKey] of Object.entries(CODEX_CONFIG_KEY_BY_FIELD)) {
    if (configKey === key) return field as keyof CodexRuntimeSettings;
  }
  return null;
}

export function withCodexField(
  settings: CodexRuntimeSettings,
  field: keyof CodexRuntimeSettings,
  value: string,
): CodexRuntimeSettings {
  if (field === 'sandboxMode') return { ...settings, sandboxMode: value as CodexSandboxMode };
  if (field === 'approvalPolicy') return { ...settings, approvalPolicy: value as CodexApprovalPolicy };
  return { ...settings, authMode: value as CodexAuthMode };
}

export function changedFields(form: HubCatEditorFormState, baseline: CatData | null): number {
  const original = initialState(baseline);
  return Object.keys(form).filter((key) => {
    const field = key as keyof HubCatEditorFormState;
    return JSON.stringify(form[field]) !== JSON.stringify(original[field]);
  }).length;
}

/** Preserve only local edits; concurrent changes to untouched fields come from the server. */
export function rebaseMemberDraft(draft: MemberDraft, latest: CatData): MemberDraft {
  const before = initialState(draft.baseline);
  const form = initialState(latest);
  for (const key of Object.keys(draft.form) as (keyof HubCatEditorFormState)[]) {
    if (JSON.stringify(draft.form[key]) !== JSON.stringify(before[key])) {
      Object.assign(form, { [key]: draft.form[key] });
    }
  }
  return { ...draft, baseline: latest, form, runtimeDrafts: undefined };
}

const USER_STRATEGY_FIELDS = ['strategy', 'warnThreshold', 'actionThreshold', 'maxCompressions'] as const;

/** Keep local strategy edits (including conflicting ones) but take the latest read as the saved baseline. */
export function rebaseStrategyDraft(draft: MemberDraft, latest: StrategyFormState | null): MemberDraft {
  if (!latest) return draft;
  if (!draft.strategy) return { ...draft, strategy: latest, strategyBaseline: latest };
  const before = draft.strategyBaseline;
  const strategy: StrategyFormState = { ...latest };
  if (before) {
    const keep: Partial<Pick<StrategyFormState, (typeof USER_STRATEGY_FIELDS)[number]>> = {};
    for (const field of USER_STRATEGY_FIELDS) {
      if (draft.strategy[field] !== before[field]) Object.assign(keep, { [field]: draft.strategy[field] });
    }
    Object.assign(strategy, keep);
  }
  return { ...draft, strategy, strategyBaseline: latest };
}

/** Keep local Codex edits; untouched fields and every write revision come from the latest read. */
export function rebaseCodexDraft(
  draft: MemberDraft,
  latest: CodexRuntimeSettings,
  writeRevisions: Record<string, string> = {},
): MemberDraft {
  const revisions = { ...(draft.codexWriteRevisions ?? {}), ...writeRevisions };
  if (!draft.codexSettings || !draft.codexBaseline) {
    return { ...draft, codexWriteRevisions: revisions };
  }
  let settings: CodexRuntimeSettings = { ...latest };
  for (const field of Object.keys(CODEX_CONFIG_KEY_BY_FIELD) as (keyof CodexRuntimeSettings)[]) {
    if (draft.codexSettings[field] !== draft.codexBaseline[field]) {
      settings = withCodexField(settings, field, draft.codexSettings[field]);
    }
  }
  return { ...draft, codexSettings: settings, codexBaseline: latest, codexWriteRevisions: revisions };
}

export function readMemberDraft(key: string): MemberDraft | null {
  try {
    const data: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('form' in data))
      return null;
    const draft = data as MemberDraft;
    return typeof draft.form?.name === 'string' && typeof draft.form?.clientId === 'string'
      ? { ...draft, baseline: normalizeMemberDraftBaseline(draft.baseline), form: normalizeMemberDraftForm(draft.form) }
      : null;
  } catch {
    return null;
  }
}

export function persistMemberDraft(key: string, draft: MemberDraft | null): boolean {
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function templateForm(
  template: TemplateCard,
  cats: CatData[],
  current: HubCatEditorFormState,
): HubCatEditorFormState {
  const baseId = autoSlug(template.name);
  let id = baseId;
  for (let suffix = 2; cats.some((cat) => cat.id === id); suffix++) id = `${baseId}-${suffix}`;
  const used = new Set(cats.flatMap((cat) => cat.mentionPatterns.map((alias) => alias.toLowerCase())));
  let alias = `@${template.nickname || template.name}`;
  for (let suffix = 2; used.has(alias.toLowerCase()); suffix++)
    alias = `@${template.nickname || template.name}${suffix}`;
  // Templates recommend tools, never model/effort overrides or authentication.
  const recommended = /maine|缅因/i.test(template.id + template.name)
    ? 'openai'
    : /ragdoll|布偶/i.test(template.id + template.name)
      ? 'anthropic'
      : current.clientId;
  return {
    ...initialState(),
    catId: id,
    name: template.name,
    displayName: template.name,
    nickname: template.nickname ?? '',
    avatar: template.avatar,
    colorPrimary: template.color.primary,
    colorSecondary: template.color.secondary,
    roleDescription: template.roleDescription,
    personality: template.personality,
    teamStrengths: template.teamStrengths ?? '',
    mentionPatterns: alias,
    clientId: recommended,
    carrier: recommended === 'openai' ? 'app_server' : recommended === 'acp' ? 'acp' : 'cli',
    defaultModel: '',
    cliEffort: '',
    accountRef: '',
  };
}
