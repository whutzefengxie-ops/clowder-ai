import { describe, expect, it } from 'vitest';
import type { CatData } from '@/hooks/useCatData';
import { initialState, type StrategyFormState } from '../hub-cat-editor.model';
import type { CatStrategyEntry, EffectiveStrategy } from '../hub-strategy-types';
import type { MemberDraft } from '../settings/members/member-editor-state';
import { rebaseCodexDraft, rebaseStrategyDraft } from '../settings/members/member-editor-state';
import {
  type CodexConfigRead,
  isAmbiguousTransportError,
  readCodexWriteRevisions,
  reconcileCodexReadBack,
  reconcileMemberReadBack,
  reconcileStrategyReadBack,
} from '../settings/members/member-save-readback';

const member = {
  id: 'draft',
  name: '伙伴',
  displayName: '伙伴',
  clientId: 'openai',
  carrier: 'cli',
  configurationSource: 'native_tool',
  color: { primary: '#123456', secondary: '#abcdef' },
  mentionPatterns: ['@draft'],
  defaultModel: '',
  roleDescription: '旧职责',
  personality: '',
  configurationRevision: 'before',
} as CatData;

const strategyForm = (over: Partial<StrategyFormState> = {}): StrategyFormState => ({
  strategy: 'handoff',
  statusStrategy: 'handoff',
  warnThreshold: '0.7',
  actionThreshold: '0.9',
  maxCompressions: '2',
  source: 'config_file',
  revision: 'r1',
  changedAt: 1,
  executionStatus: { status: 'active', missingCapabilities: [] },
  ...over,
});

function strategyEntry(effective: Partial<EffectiveStrategy>, revision = 'r2'): CatStrategyEntry {
  return {
    catId: 'draft',
    displayName: '伙伴',
    clientId: 'openai',
    effective: { strategy: 'handoff', thresholds: { warn: 0.7, action: 0.9 }, ...effective },
    source: 'runtime_override',
    revision,
    changedAt: 2,
    hasOverride: true,
    override: null,
  };
}

describe('read-back reconciliation', () => {
  it('marks a member edit as saved only when every intended field matches the fresh read', () => {
    const form = { ...initialState(member), nickname: '新昵称' };
    expect(reconcileMemberReadBack(form, member, { ...member, nickname: '新昵称' })).toBe('saved');
    expect(reconcileMemberReadBack(form, member, { ...member })).toBe('unchanged');
    expect(reconcileMemberReadBack(form, member, { ...member, nickname: '别人改的' })).toBe('conflict');
  });

  it('reconciles a session strategy edit against the target, the old baseline or an unseen change', () => {
    const baseline = strategyForm();
    const intended = strategyForm({ strategy: 'compress' });
    expect(reconcileStrategyReadBack(intended, baseline, strategyEntry({ strategy: 'compress' }))).toBe('saved');
    expect(reconcileStrategyReadBack(intended, baseline, strategyEntry({}))).toBe('unchanged');
    expect(reconcileStrategyReadBack(intended, baseline, strategyEntry({ strategy: 'hybrid' }))).toBe('conflict');
  });

  it('reconciles a global Codex value without treating untouched fields as changes', () => {
    const settings = (sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access') =>
      ({ sandboxMode, approvalPolicy: 'on-request', authMode: 'oauth' }) as const;
    expect(reconcileCodexReadBack('cli.codexSandboxMode', 'read-only', 'workspace-write', settings('read-only'))).toBe(
      'saved',
    );
    expect(
      reconcileCodexReadBack('cli.codexSandboxMode', 'read-only', 'workspace-write', settings('workspace-write')),
    ).toBe('unchanged');
    expect(
      reconcileCodexReadBack('cli.codexSandboxMode', 'read-only', 'workspace-write', settings('danger-full-access')),
    ).toBe('conflict');
  });
});

describe('save transport classification and revisions', () => {
  it('treats only timeout and network errors as ambiguous mutation outcomes', () => {
    const timeout = new Error('timeout');
    timeout.name = 'TimeoutError';
    const network = new TypeError('failed to fetch');
    expect(isAmbiguousTransportError(timeout)).toBe(true);
    expect(isAmbiguousTransportError(network)).toBe(true);
    expect(isAmbiguousTransportError(new Error('503'))).toBe(false);
  });

  it('keeps only string revisions from the config read', () => {
    expect(readCodexWriteRevisions({ 'cli.codexSandboxMode': 'a', 'codex.execution.authMode': 3 })).toEqual({
      'cli.codexSandboxMode': 'a',
    });
    expect(readCodexWriteRevisions(undefined)).toEqual({});
  });
});

describe('reload-and-keep-edits rebasing', () => {
  const draft: MemberDraft = {
    version: 1,
    baseline: member,
    form: initialState(member),
    templateId: null,
    section: 'context',
    strategy: strategyForm({ strategy: 'compress', revision: 'r1' }),
    strategyBaseline: strategyForm(),
  };

  it('keeps a locally edited strategy field but takes the latest revision and untouched fields', () => {
    const next = rebaseStrategyDraft(draft, strategyForm({ maxCompressions: '5', revision: 'r9', changedAt: 9 }));
    expect(next.strategy).toMatchObject({ strategy: 'compress', maxCompressions: '5', revision: 'r9' });
    expect(next.strategyBaseline).toMatchObject({ maxCompressions: '5', revision: 'r9' });
  });

  it('keeps locally edited Codex values and refreshes every write revision', () => {
    const withCodex: MemberDraft = {
      ...draft,
      codexSettings: { sandboxMode: 'read-only', approvalPolicy: 'on-request', authMode: 'oauth' },
      codexBaseline: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', authMode: 'oauth' },
      codexWriteRevisions: { 'cli.codexSandboxMode': 'old' },
    };
    const next = rebaseCodexDraft(
      withCodex,
      { sandboxMode: 'danger-full-access', approvalPolicy: 'on-request', authMode: 'oauth' },
      { 'cli.codexSandboxMode': 'fresh', 'cli.codexApprovalPolicy': 'approval' },
    );
    expect(next.codexSettings).toMatchObject({ sandboxMode: 'read-only' });
    expect(next.codexBaseline).toMatchObject({ sandboxMode: 'danger-full-access' });
    expect(next.codexWriteRevisions).toEqual({
      'cli.codexSandboxMode': 'fresh',
      'cli.codexApprovalPolicy': 'approval',
    });
  });

  it('exposes a config read shape usable by the S3 step', () => {
    const read: CodexConfigRead = {
      settings: { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', authMode: 'oauth' },
      writeRevisions: { 'cli.codexSandboxMode': 'r' },
    };
    expect(read.settings.sandboxMode).toBe('workspace-write');
  });
});
