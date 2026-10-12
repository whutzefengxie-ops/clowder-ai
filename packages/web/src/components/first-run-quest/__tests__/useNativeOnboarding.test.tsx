import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CatData } from '@/hooks/useCatData';
import { apiFetch } from '@/utils/api-client';
import { getThreadDraft } from '../../thread-drafts';
import { useNativeOnboarding } from '../useNativeOnboarding';

vi.mock('@/utils/api-client', () => ({ apiFetch: vi.fn() }));
const catalog = vi.hoisted(() => ({ cats: [] as CatData[] }));
vi.mock('@/hooks/useCatData', () => ({ useCatData: () => ({ cats: catalog.cats, refresh: vi.fn() }) }));
let root: Root, container: HTMLDivElement;
let setup: ReturnType<typeof useNativeOnboarding>;
const onCreated = vi.fn();
function Harness() {
  setup = useNativeOnboarding(true, onCreated);
  return <p>{setup.loading ? 'loading' : setup.draft?.partners.length}</p>;
}
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const runtimes = [
  { id: 'codex', label: 'Codex', clientId: 'openai', installed: true, models: [] },
  { id: 'claude', label: 'Claude Code', clientId: 'anthropic', installed: true, models: [] },
  {
    id: 'dsh',
    label: 'DSH',
    clientId: 'acp',
    installed: true,
    models: [],
    acp: { command: 'node', startupArgs: ['dsh.js', '--profile', 'acp'] },
  },
];
beforeEach(() => {
  catalog.cats = [];
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(apiFetch).mockImplementation(async (path, init) => {
    if (path === '/api/session') return response({ userId: 'owner-a' });
    if (path === '/api/cats/native-runtimes') return response({ runtimes });
    if (path === '/api/cat-templates') return response({ templates: [] });
    if (path === '/api/cats') {
      const payload = JSON.parse(String(init?.body));
      return response(
        { cat: { id: payload.catId, displayName: payload.displayName, mentionPatterns: payload.mentionPatterns } },
        201,
      );
    }
    if (path === '/api/threads') return response({ id: 'ordinary-goal' }, 201);
    throw new Error(`unexpected path ${path}`);
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.resetAllMocks();
});

it('does not write before confirmation; creates all native partners then prefills a real conversation', async () => {
  await act(async () => root.render(<Harness />));
  expect(setup.draft?.partners.filter((p) => p.selected)).toHaveLength(3);
  expect(vi.mocked(apiFetch).mock.calls.every(([, init]) => !init?.method)).toBe(true);
  await act(async () => setup.start());
  const writes = vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(writes.map(([path]) => path)).toEqual(['/api/cats', '/api/cats', '/api/cats', '/api/threads']);
  for (const [, init] of writes.slice(0, 3))
    expect(JSON.parse(String(init?.body))).toMatchObject({ configurationSource: 'native_tool', defaultModel: '' });
  expect(JSON.parse(String(writes[3][1]?.body))).not.toHaveProperty('bootcampState');
  expect(onCreated).toHaveBeenCalledWith('ordinary-goal', expect.any(String));
  expect(getThreadDraft('ordinary-goal')).toContain('@codex');
  expect(getThreadDraft('ordinary-goal')).toContain('@claude-code');
  expect(getThreadDraft('ordinary-goal')).toContain('@dsh');
  expect(getThreadDraft('ordinary-goal')).toContain('#execute');
  expect(getThreadDraft('ordinary-goal')).toContain('检查前面伙伴的方案');
  expect(getThreadDraft('ordinary-goal')).toContain('3 个步骤');
});

it('puts the chosen lead first and dispatches every selected partner, but no deselected partner', async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => {
    setup.patchPartner(setup.draft!.partners[2].id, { selected: false });
    setup.patch({ lead: 'claude', goal: '整理笔记' });
  });
  await act(async () => setup.start());
  const message = getThreadDraft('ordinary-goal');
  expect(message).toMatch(/^@claude-code @codex\n/);
  expect(message).not.toContain('@dsh');
  expect(message).toContain('汇总');
});

it('keeps a single-partner goal simple', async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => {
    for (const partner of setup.draft!.partners.slice(1)) setup.patchPartner(partner.id, { selected: false });
    setup.patch({ goal: '整理笔记' });
  });
  await act(async () => setup.start());
  expect(getThreadDraft('ordinary-goal')).toBe('@codex 整理笔记');
});

it('preserves deselection of an existing partner across detection refreshes', async () => {
  catalog.cats = [
    {
      id: 'existing-codex',
      displayName: '现有伙伴',
      clientId: 'openai',
      configurationSource: 'native_tool',
      defaultModel: '',
      color: { primary: '#000000', secondary: '#ffffff' },
      mentionPatterns: ['@existing'],
      avatar: '',
      roleDescription: '',
      personality: '',
    },
  ];
  await act(async () => root.render(<Harness />));
  expect(setup.draft?.partners[0].existingId).toBe('existing-codex');
  await act(async () => setup.patchPartner('codex', { selected: false }));
  await act(async () => setup.reload());
  expect(setup.draft?.partners[0].selected).toBe(false);
  await act(async () => setup.start());
  expect(getThreadDraft('ordinary-goal')).not.toContain('@existing');
});

it('blocks starting from stale detection data after a failed refresh', async () => {
  await act(async () => root.render(<Harness />));
  const original = vi.mocked(apiFetch).getMockImplementation()!;
  vi.mocked(apiFetch).mockImplementation(async (path, init) =>
    path === '/api/cats/native-runtimes' ? response({ error: '检测服务不可用' }, 503) : original(path, init),
  );
  await act(async () => setup.reload());
  await act(async () => setup.start());
  expect(vi.mocked(apiFetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

it('retains successful members when thread creation fails and resumes without duplicate writes', async () => {
  const original = vi.mocked(apiFetch).getMockImplementation()!;
  let failThread = true;
  vi.mocked(apiFetch).mockImplementation(async (path, init) => {
    if (path === '/api/threads' && failThread) {
      failThread = false;
      return response({ error: '暂时不可用' }, 503);
    }
    return original(path, init);
  });
  await act(async () => root.render(<Harness />));
  await act(async () => setup.start());
  expect(setup.error).toBe('暂时不可用');
  expect(onCreated).not.toHaveBeenCalled();
  expect(Object.keys(setup.draft?.created ?? {})).toHaveLength(3);
  await act(async () => setup.reload());
  await act(async () => setup.start());
  expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path === '/api/cats')).toHaveLength(3);
  expect(onCreated).toHaveBeenCalledOnce();
});

it('recommends a newly installed tool on refresh but preserves an explicit deselection', async () => {
  const original = vi.mocked(apiFetch).getMockImplementation()!;
  let installed = false;
  vi.mocked(apiFetch).mockImplementation(async (path, init) =>
    path === '/api/cats/native-runtimes'
      ? response({ runtimes: runtimes.map((runtime) => ({ ...runtime, installed })) })
      : original(path, init),
  );
  await act(async () => root.render(<Harness />));
  expect(setup.draft?.partners.some((p) => p.selected)).toBe(false);
  installed = true;
  await act(async () => setup.reload());
  expect(setup.draft?.partners.every((p) => p.selected)).toBe(true);
  await act(async () => setup.patchPartner('codex', { selected: false }));
  await act(async () => setup.reload());
  expect(setup.draft?.partners.find((p) => p.id === 'codex')?.selected).toBe(false);
});
