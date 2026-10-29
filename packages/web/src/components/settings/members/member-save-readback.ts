import type { CatData } from '@/hooks/useCatData';
import { apiFetch } from '@/utils/api-client';
import type { MemberSaveTrace } from '@/utils/member-save-trace';
import {
  type CodexApprovalPolicy,
  type CodexAuthMode,
  type CodexRuntimeSettings,
  type CodexSandboxMode,
  type HubCatEditorFormState,
  initialState,
  type StrategyFormState,
  toCodexRuntimeSettings,
  toStrategyForm,
} from '../../hub-cat-editor.model';
import type { CatStrategyEntry } from '../../hub-strategy-types';
import { codexFieldForConfigKey } from './member-editor-state';

/** Opt a write into strict CAS enforcement (428 when the expected revision is missing). */
export const FORMAL_EDIT_HEADERS: Record<string, string> = { 'x-clowder-formal-edit': '1' };

export type SaveStepId = 'member' | 'strategy' | 'codex';
export type SaveStepStatus = 'saved' | 'failed' | 'conflict' | 'skipped';
export interface SaveStepResult {
  status: SaveStepStatus;
  message?: string;
}
export type MemberSaveLedger = Record<SaveStepId, SaveStepResult>;

export function isAmbiguousTransportError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'TypeError');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readErrorMessage(payload: Record<string, unknown>, fallback: string): string {
  const message = payload.error;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}

export async function readJsonBody(response: Response): Promise<Record<string, unknown>> {
  try {
    return asRecord(await response.json()) ?? {};
  } catch {
    return {};
  }
}

export function readMemberFromPayload(payload: Record<string, unknown>): CatData | null {
  const cat = asRecord(payload.cat);
  return cat && typeof cat.id === 'string' ? (cat as unknown as CatData) : null;
}

export function readCodexWriteRevisions(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  const entries = Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return Object.fromEntries(entries);
}

export function withExpectedRevision(payload: Record<string, unknown>, revision?: string): Record<string, unknown> {
  return revision ? { ...payload, expectedRevision: revision } : { ...payload };
}

type WriteKind = 'ok' | 'conflict' | 'revision-required' | 'failed' | 'ambiguous';
export interface WriteAttempt {
  kind: WriteKind;
  status?: number;
  message?: string;
  payload: Record<string, unknown>;
}

interface WriteRequest {
  trace: Pick<MemberSaveTrace, 'headers' | 'phase'>;
  phase: 'member.write' | 'strategy.write' | 'codex.write';
  method: 'POST' | 'PATCH';
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  /** Create has no revision; every revisioned write must advertise itself as a formal edit. */
  formal: boolean;
}

/** One physical write. HTTP status is authoritative; a thrown timeout/network error is ambiguous. */
export async function attemptWrite(request: WriteRequest): Promise<WriteAttempt> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(request.formal ? FORMAL_EDIT_HEADERS : {}),
    ...request.headers,
  };
  try {
    const response = await request.trace.phase(request.phase, () =>
      apiFetch(request.path, { method: request.method, headers, body: JSON.stringify(request.body) }),
    );
    const payload = await readJsonBody(response);
    if (response.ok) return { kind: 'ok', status: response.status, payload };
    const message = readErrorMessage(payload, `请求失败 (${response.status})`);
    if (response.status === 409) return { kind: 'conflict', status: 409, message, payload };
    if (response.status === 428) return { kind: 'revision-required', status: 428, message, payload };
    return { kind: 'failed', status: response.status, message, payload };
  } catch (error) {
    if (!isAmbiguousTransportError(error))
      return { kind: 'failed', message: error instanceof Error ? error.message : '保存失败', payload: {} };
    return { kind: 'ambiguous', message: '请求超时或连接中断，正在读回确认结果。', payload: {} };
  }
}

interface CodexConfigSnapshot {
  cli?: { codexSandboxMode?: CodexSandboxMode; codexApprovalPolicy?: CodexApprovalPolicy };
  codexExecution?: { authMode?: CodexAuthMode };
}

export interface CodexConfigRead {
  settings: CodexRuntimeSettings;
  writeRevisions: Record<string, string>;
}

function readCodexSnapshot(value: unknown): CodexConfigSnapshot | undefined {
  const root = asRecord(value);
  if (!root) return undefined;
  const cli = asRecord(root.cli);
  const codexExecution = asRecord(root.codexExecution);
  return {
    ...(cli
      ? {
          cli: {
            ...(typeof cli.codexSandboxMode === 'string'
              ? { codexSandboxMode: cli.codexSandboxMode as CodexSandboxMode }
              : {}),
            ...(typeof cli.codexApprovalPolicy === 'string'
              ? { codexApprovalPolicy: cli.codexApprovalPolicy as CodexApprovalPolicy }
              : {}),
          },
        }
      : {}),
    ...(codexExecution
      ? {
          codexExecution: {
            ...(typeof codexExecution.authMode === 'string'
              ? { authMode: codexExecution.authMode as CodexAuthMode }
              : {}),
          },
        }
      : {}),
  };
}

/** Read the persisted member (or the member created by an ambiguous POST) by its stable catId. */
export async function readMemberById(catId: string): Promise<CatData | null> {
  try {
    const response = await apiFetch(`/api/cats?catId=${encodeURIComponent(catId)}`);
    if (!response.ok) return null;
    const payload = await readJsonBody(response);
    const cats = payload.cats;
    if (!Array.isArray(cats)) return null;
    return (cats as CatData[]).find((cat) => cat?.id === catId) ?? null;
  } catch {
    return null;
  }
}

export async function readSessionStrategyEntry(catId: string): Promise<CatStrategyEntry | null> {
  try {
    const response = await apiFetch('/api/config/session-strategy');
    if (!response.ok) return null;
    const payload = await readJsonBody(response);
    const cats = payload.cats;
    if (!Array.isArray(cats)) return null;
    return (cats as CatStrategyEntry[]).find((entry) => entry?.catId === catId) ?? null;
  } catch {
    return null;
  }
}

export async function readCodexConfig(): Promise<CodexConfigRead | null> {
  try {
    const response = await apiFetch('/api/config');
    if (!response.ok) return null;
    const payload = await readJsonBody(response);
    return {
      settings: toCodexRuntimeSettings(readCodexSnapshot(payload.config)),
      writeRevisions: readCodexWriteRevisions(payload.writeRevisions),
    };
  } catch {
    return null;
  }
}

function formKeys(form: HubCatEditorFormState): Array<keyof HubCatEditorFormState> {
  return Object.keys(form) as Array<keyof HubCatEditorFormState>;
}

export type ReadBackVerdict = 'saved' | 'unchanged' | 'conflict';

/** Compare the intended member edit with a fresh read: target => saved, baseline => retryable, else conflict. */
export function reconcileMemberReadBack(
  form: HubCatEditorFormState,
  baseline: CatData,
  latest: CatData,
): ReadBackVerdict {
  const before = initialState(baseline);
  const now = initialState(latest);
  const changed = formKeys(form).filter((key) => JSON.stringify(form[key]) !== JSON.stringify(before[key]));
  if (changed.length === 0) return 'unchanged';
  const matches = (field: 'saved' | 'unchanged') =>
    changed.every((key) =>
      field === 'saved'
        ? JSON.stringify(now[key]) === JSON.stringify(form[key])
        : JSON.stringify(now[key]) === JSON.stringify(before[key]),
    );
  if (matches('saved')) return 'saved';
  if (matches('unchanged')) return 'unchanged';
  return 'conflict';
}

/** The comparable user-editable projection of a strategy form. */
export function strategyTarget(form: StrategyFormState): Record<string, string | number | null> {
  return {
    strategy: form.strategy,
    warn: Number.parseFloat(form.warnThreshold),
    action: Number.parseFloat(form.actionThreshold),
    maxCompressions: form.strategy === 'hybrid' ? Number(form.maxCompressions) : null,
  };
}

export function reconcileStrategyReadBack(
  intended: StrategyFormState,
  baseline: StrategyFormState,
  latest: CatStrategyEntry,
): ReadBackVerdict {
  const target = strategyTarget(intended);
  const before = strategyTarget(baseline);
  const now = strategyTarget(toStrategyForm(latest));
  const changed = Object.keys(target).filter((key) => JSON.stringify(target[key]) !== JSON.stringify(before[key]));
  if (changed.length === 0) return 'unchanged';
  if (changed.every((key) => JSON.stringify(now[key]) === JSON.stringify(target[key]))) return 'saved';
  if (changed.every((key) => JSON.stringify(now[key]) === JSON.stringify(before[key]))) return 'unchanged';
  return 'conflict';
}

function codexValue(key: string, settings: CodexRuntimeSettings): string | null {
  const field = codexFieldForConfigKey(key);
  return field ? settings[field] : null;
}

export function reconcileCodexReadBack(
  key: string,
  intendedValue: string,
  baselineValue: string,
  settings: CodexRuntimeSettings,
): ReadBackVerdict {
  const now = codexValue(key, settings);
  if (now === intendedValue) return 'saved';
  if (now === baselineValue) return 'unchanged';
  return 'conflict';
}
