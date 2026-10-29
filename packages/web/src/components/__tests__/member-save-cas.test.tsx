import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, type Mock, vi } from 'vitest';
import type { CatData } from '@/hooks/useCatData';
import { apiFetch } from '@/utils/api-client';
import type { MemberSaveTrace } from '@/utils/member-save-trace';
import type { CatStrategyEntry, EffectiveStrategy } from '../hub-strategy-types';
import { MemberSettingsPage } from '../settings/members/MemberSettingsPage';

vi.mock('@/utils/api-client', () => ({
  API_URL: 'http://member-save-cas.test',
  apiFetch: vi.fn(),
  sendMemberSaveDiagnostics: vi.fn(async () => new Response(null, { status: 204 })),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('lang=zh'),
}));

const member: CatData = {
  id: 'codex-cas',
  name: '伙伴',
  avatar: '/avatars/default.png',
  roleDescription: '职责',
  personality: '',
  displayName: '伙伴',
  clientId: 'openai',
  carrier: 'app_server',
  accountRef: 'codex-company',
  configurationSource: 'managed_account',
  defaultModel: 'gpt-5.4',
  color: { primary: '#123456', secondary: '#abcdef' },
  mentionPatterns: ['@partner'],
  cli: { command: 'codex', effort: 'high' },
  configurationRevision: 'rev-before',
};

const baseStrategy: EffectiveStrategy = { strategy: 'handoff', thresholds: { warn: 0.7, action: 0.9 } };

interface WriteRecord {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

type Failure = 'timeout' | 'conflict' | 'revision-required' | 'unavailable';

type OnSaved = (cat: CatData, trace?: MemberSaveTrace) => Promise<void>;

let container: HTMLDivElement;
let root: Root;
let memberState: CatData;
let strategyState: CatStrategyEntry;
let configState: {
  cli: { codexSandboxMode: string; codexApprovalPolicy: string };
  codexExecution: { authMode: string };
};
let writeRevisions: Record<string, string>;
let writes: WriteRecord[];
let failures: { member: Failure[]; strategy: Failure[]; config: Failure[]; create: Failure[] };
let createdOnTimeout: CatData | null;
let onSaved: Mock<OnSaved>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function timeoutError(): Error {
  const error = new Error('网络请求超时，请重试。');
  error.name = 'TimeoutError';
  return error;
}

function takeFailure(kind: keyof typeof failures): Failure | undefined {
  return failures[kind].shift();
}

function headerRecord(init?: RequestInit): Record<string, string> {
  return (init?.headers as Record<string, string> | undefined) ?? {};
}

function applyMemberPatch(body: Record<string, unknown>): CatData {
  const next: Record<string, unknown> = { ...memberState, ...body, configurationRevision: 'rev-after' };
  delete next.expectedRevision;
  return next as unknown as CatData;
}

function strategyEntry(strategy: string, thresholds: { warn: number; action: number }): CatStrategyEntry {
  return {
    ...strategyState,
    effective: { ...strategyState.effective, strategy: strategy as EffectiveStrategy['strategy'], thresholds },
    revision: 'strat-after',
    changedAt: 2,
  };
}

function installMock(): void {
  vi.mocked(apiFetch).mockImplementation(async (path, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'PATCH' || method === 'POST') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writes.push({ path, method, headers: headerRecord(init), body });
      if (method === 'POST') {
        const failure = takeFailure('create');
        if (failure === 'timeout') {
          createdOnTimeout = {
            ...member,
            id: String(body.catId),
            name: String(body.name),
            displayName: String(body.displayName),
            configurationRevision: 'rev-created',
          };
          throw timeoutError();
        }
        const created: CatData = { ...member, id: String(body.catId), configurationRevision: 'rev-created' };
        return json({ cat: created }, 201);
      }
      if (path.startsWith('/api/cats/')) {
        const failure = takeFailure('member');
        if (failure === 'conflict') {
          memberState = { ...memberState, personality: '服务器新值', configurationRevision: 'rev-concurrent' };
          return json({ code: 'member_configuration_conflict', error: '成员已在其他页面修改。' }, 409);
        }
        if (failure === 'revision-required') {
          memberState = { ...memberState, configurationRevision: 'rev-fresh' };
          return json({ code: 'member_revision_required', error: '需要最新成员版本。' }, 428);
        }
        if (failure === 'unavailable') return json({ error: '成员保存服务不可用' }, 503);
        if (failure === 'timeout') {
          memberState = { ...memberState, nickname: '其他页面名字', configurationRevision: 'rev-concurrent' };
          throw timeoutError();
        }
        memberState = applyMemberPatch(body);
        return json({ cat: memberState });
      }
      if (path.startsWith('/api/config/session-strategy/')) {
        const failure = takeFailure('strategy');
        if (failure === 'unavailable') return json({ error: '策略服务不可用' }, 503);
        if (failure === 'timeout') {
          strategyState = strategyEntry('compress', { warn: 0.7, action: 0.9 });
          throw timeoutError();
        }
        const strategy = String(body.strategy) as EffectiveStrategy['strategy'];
        const thresholds = (body.thresholds as { warn: number; action: number } | undefined) ?? {
          warn: 0.7,
          action: 0.9,
        };
        strategyState = strategyEntry(strategy, thresholds);
        return json({
          catId: strategyState.catId,
          effective: strategyState.effective,
          source: strategyState.source,
          revision: strategyState.revision,
          changedAt: strategyState.changedAt,
        });
      }
      if (path === '/api/config') {
        const failure = takeFailure('config');
        if (failure === 'unavailable') return json({ error: 'approval rejected' }, 503);
        const key = String(body.key);
        writeRevisions = { ...writeRevisions, [key]: 'rev-new' };
        return json({ revision: 'rev-new' });
      }
      return json({});
    }
    if (path === '/api/accounts') return json({ providers: [], projectPath: '/fixture' });
    if (path === '/api/session') return json({ userId: 'owner' });
    if (path === '/api/cat-templates') return json({ templates: [] });
    if (path === '/api/cats/native-runtimes') return json({ runtimes: [] });
    if (path === '/api/cats/runtime-models') return json({ status: 'configured', models: [] });
    if (path === '/api/config/session-strategy') return json({ cats: [strategyState] });
    if (path === '/api/config') return json({ config: configState, writeRevisions });
    if (path.startsWith('/api/cats?')) {
      const requested = new URL(path, 'http://member-save-cas.test').searchParams.get('catId');
      const found =
        createdOnTimeout && createdOnTimeout.id === requested
          ? createdOnTimeout
          : memberState.id === requested
            ? memberState
            : null;
      return json({ cats: found ? [found] : [] });
    }
    return json({});
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  writes = [];
  failures = { member: [], strategy: [], config: [], create: [] };
  createdOnTimeout = null;
  memberState = { ...member };
  strategyState = {
    catId: member.id,
    displayName: '伙伴',
    clientId: 'openai',
    effective: baseStrategy,
    source: 'config_file',
    revision: 'strat-before',
    changedAt: 1,
    hasOverride: false,
    override: null,
  };
  configState = {
    cli: { codexSandboxMode: 'workspace-write', codexApprovalPolicy: 'on-request' },
    codexExecution: { authMode: 'oauth' },
  };
  writeRevisions = {
    'cli.codexSandboxMode': 'sandbox-before',
    'cli.codexApprovalPolicy': 'approval-before',
    'codex.execution.authMode': 'auth-before',
  };
  onSaved = vi.fn<OnSaved>(async () => {});
  installMock();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function mount(cat: CatData | null = memberState) {
  await act(async () =>
    root.render(
      <MemberSettingsPage
        cat={cat}
        cats={cat ? [cat] : []}
        onSaved={(saved, trace) => onSaved(saved, trace)}
        onBack={() => {}}
      />,
    ),
  );
}

async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label);
  if (!button) throw new Error(`missing button: ${label}`);
  await act(async () => button.click());
}

async function select(label: string, value: string) {
  const field = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (!field) throw new Error(`missing select: ${label}`);
  await act(async () => {
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function input(label: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!field) throw new Error(`missing input: ${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const ledgerText = () => container.querySelector('[data-testid="member-save-ledger"]')?.textContent ?? '';

it('sends the baseline revisions and formal-edit header on S1, S2 and S3', async () => {
  await mount();
  await click('身份与职责');
  await input('昵称', '新昵称');
  await click('上下文与会话');
  await select('会话策略', 'compress');
  await click('高级接入');
  await act(async () => {});
  await select('Codex Sandbox', 'read-only');
  await click('保存');

  expect(writes.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
    'PATCH /api/cats/codex-cas',
    'PATCH /api/config/session-strategy/codex-cas',
    'PATCH /api/config',
  ]);
  expect(writes[0]?.body).toMatchObject({ nickname: '新昵称', expectedRevision: 'rev-before' });
  expect(writes[0]?.headers['x-clowder-formal-edit']).toBe('1');
  expect(writes[1]?.body).toMatchObject({ strategy: 'compress', expectedRevision: 'strat-before' });
  expect(writes[1]?.body).not.toHaveProperty('thresholds');
  expect(writes[1]?.headers['x-clowder-formal-edit']).toBe('1');
  expect(writes[2]?.body).toEqual({
    key: 'cli.codexSandboxMode',
    value: 'read-only',
    expectedRevision: 'sandbox-before',
  });
  expect(writes[2]?.headers['x-clowder-formal-edit']).toBe('1');
  expect(ledgerText()).toContain('成员：已保存');
  expect(ledgerText()).toContain('会话策略：已保存');
  expect(container.textContent).toContain('已保存。');
  expect(onSaved).toHaveBeenCalledOnce();
});

it('keeps the draft and shows the reload path when S1 conflicts (409) without sending S2/S3', async () => {
  await mount();
  await click('身份与职责');
  await input('昵称', '新昵称');
  await click('上下文与会话');
  await select('会话策略', 'compress');
  failures.member.push('conflict');
  await click('保存');

  expect(writes).toHaveLength(1);
  expect(writes[0]?.path).toBe('/api/cats/codex-cas');
  await click('身份与职责');
  expect(container.querySelector('input[aria-label="昵称"]')).toHaveProperty('value', '新昵称');
  expect(ledgerText()).toContain('成员：有冲突，需重新读取');
  expect(container.textContent).toContain('成员已在其他页面修改');
  const reload = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === '重新读取，保留我的修改并核对',
  );
  expect(reload).toBeDefined();
});

it('refreshes the member revision and retries S1 once after a 428, keeping the edits', async () => {
  await mount();
  await click('身份与职责');
  await input('昵称', '新昵称');
  failures.member.push('revision-required');
  await click('保存');

  expect(writes).toHaveLength(2);
  expect(writes[0]?.body).toMatchObject({ nickname: '新昵称', expectedRevision: 'rev-before' });
  expect(writes[1]?.body).toMatchObject({ nickname: '新昵称', expectedRevision: 'rev-fresh' });
  expect(ledgerText()).toContain('成员：已保存');
  expect(container.textContent).toContain('已保存。');
});

it('reports member saved / strategy unsaved and never submits S3 when S2 fails', async () => {
  await mount();
  await click('身份与职责');
  await input('昵称', '新昵称');
  await click('上下文与会话');
  await select('会话策略', 'compress');
  await click('高级接入');
  await act(async () => {});
  await select('Codex Sandbox', 'read-only');
  failures.strategy.push('unavailable');
  await click('保存');

  expect(writes.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
    'PATCH /api/cats/codex-cas',
    'PATCH /api/config/session-strategy/codex-cas',
  ]);
  expect(container.textContent).toContain('成员已保存，策略未保存');
  expect(container.textContent).toContain('策略服务不可用');
  expect(ledgerText()).toContain('成员：已保存');
  expect(ledgerText()).toContain('会话策略：未保存');
  expect(ledgerText()).toContain('Codex 全局设置：未提交');
  await click('上下文与会话');
  expect(container.querySelector<HTMLSelectElement>('select[aria-label="会话策略"]')).toHaveProperty(
    'value',
    'compress',
  );
});

it('adopts the member created before a POST timeout by stable catId without posting again', async () => {
  await mount(null);
  const nameField = [...container.querySelectorAll('label')]
    .find((label) => label.textContent?.startsWith('名字'))
    ?.querySelector('input');
  if (!nameField) throw new Error('missing creation name field');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(nameField, '新伙伴');
    nameField.dispatchEvent(new Event('input', { bubbles: true }));
  });
  failures.create.push('timeout');
  await click('添加伙伴');

  const posts = writes.filter((entry) => entry.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0]?.path).toBe('/api/cats');
  const createdId = String(posts[0]?.body.catId);
  expect(createdId.startsWith('cat-')).toBe(true);
  expect(onSaved).toHaveBeenCalledOnce();
  expect((onSaved.mock.calls[0]?.[0] as CatData).id).toBe(createdId);
  expect(ledgerText()).toContain('成员：已保存');
  expect(container.textContent).toContain('已保存。');
});

it('treats a timed-out strategy write as saved when the read-back already matches the target', async () => {
  await mount();
  await click('上下文与会话');
  await select('会话策略', 'compress');
  failures.strategy.push('timeout');
  await click('保存');

  expect(writes).toHaveLength(1);
  expect(ledgerText()).toContain('会话策略：已保存');
  expect(container.textContent).toContain('已保存。');
});

it('treats a timed-out member write as a conflict when the read-back was changed elsewhere', async () => {
  await mount();
  await click('身份与职责');
  await input('昵称', '我的新昵称');
  failures.member.push('timeout');
  await click('保存');

  expect(writes).toHaveLength(1);
  expect(ledgerText()).toContain('成员：有冲突');
  expect(container.textContent).toContain('成员配置已被其他页面修改');
  expect(container.querySelector('input[aria-label="昵称"]')).toHaveProperty('value', '我的新昵称');
  expect(
    [...container.querySelectorAll('button')].some((item) => item.textContent === '重新读取，保留我的修改并核对'),
  ).toBe(true);
});

it('reloads the latest revision after a conflict and retries with the user edits preserved', async () => {
  await mount();
  await click('身份与职责');
  await input('昵称', '新昵称');
  failures.member.push('conflict');
  await click('保存');
  expect(ledgerText()).toContain('成员：有冲突');

  await click('重新读取，保留我的修改并核对');
  expect(container.querySelector('input[aria-label="昵称"]')).toHaveProperty('value', '新昵称');
  expect(container.querySelector('textarea[aria-label="个性"]')).toHaveProperty('value', '服务器新值');

  await click('保存');
  const memberWrites = writes.filter((entry) => entry.path === '/api/cats/codex-cas');
  expect(memberWrites).toHaveLength(2);
  expect(memberWrites[0]?.body.expectedRevision).toBe('rev-before');
  expect(memberWrites[1]?.body).toMatchObject({ nickname: '新昵称', expectedRevision: 'rev-concurrent' });
  expect(container.textContent).toContain('已保存。');
});
