import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CatData } from '@/hooks/useCatData';
import { apiFetch } from '@/utils/api-client';
import { RecommendedTeamSetup } from '../settings/members/RecommendedTeamSetup';

vi.mock('@/utils/api-client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/hooks/useCatData', () => ({ useCatData: () => ({ cats: [], refresh: vi.fn() }) }));
let root: Root, host: HTMLDivElement;
let installed = true;
let failed = false;
let existing: CatData[] = [];
const created = vi.fn(),
  manual = vi.fn();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const button = (name: string) => [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(name))!;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  installed = true;
  failed = false;
  existing = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(apiFetch).mockImplementation(async (path, init) => {
    if (path === '/api/session') return json({ userId: 'first-team-owner' });
    if (path === '/api/cat-templates')
      return json({
        templates: [
          {
            id: 'ragdoll',
            name: '布偶猫',
            nickname: '宪宪',
            avatar: '',
            color: { primary: '#000000', secondary: '#ffffff' },
            personality: '可靠',
            roleDescription: '负责方案和审查',
          },
        ],
      });
    if (path === '/api/cats/native-runtimes')
      return failed
        ? json({ error: '检测服务离线' }, 503)
        : json({
            runtimes: [
              { id: 'claude', label: 'Claude Code', clientId: 'anthropic', installed, models: [] },
              { id: 'codex', label: 'Codex', clientId: 'openai', installed, models: [] },
              {
                id: 'dsh',
                label: 'DSH',
                clientId: 'acp',
                installed,
                models: [],
                acp: { command: 'dsh', startupArgs: ['--profile', 'acp'] },
              },
            ],
          });
    if (path === '/api/cats' && !init?.method) return json({ cats: existing });
    if (path === '/api/cats' && init?.method === 'POST') {
      const data = JSON.parse(String(init.body));
      return json(
        { cat: { id: data.catId, displayName: data.displayName, mentionPatterns: data.mentionPatterns } },
        201,
      );
    }
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
const mount = () =>
  act(async () => root.render(<RecommendedTeamSetup onCreated={created} onManual={manual} onBack={() => {}} />));

it('detects and preselects a complete team, and creates it in one click with inherited defaults', async () => {
  await mount();
  expect(host.querySelectorAll('input:checked')).toHaveLength(3);
  expect(host.textContent).toContain('负责方案和审查');
  expect(vi.mocked(apiFetch).mock.calls.some(([, init]) => init?.method)).toBe(false);
  await act(async () => button('一键创建 3 位伙伴').click());
  const posts = vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(3);
  expect(posts.every(([path]) => path === '/api/cats')).toBe(true);
  for (const [, init] of posts)
    expect(JSON.parse(String(init?.body))).toMatchObject({ configurationSource: 'native_tool', defaultModel: '' });
  expect(created).toHaveBeenCalledOnce();
});

it('shows installation help and blocks creation when no supported tools are found', async () => {
  installed = false;
  await mount();
  expect(host.textContent).toContain('还没有找到可加入的工具');
  expect(host.querySelector('details')?.open).toBe(true);
  expect(button('查看我的团队').disabled).toBe(true);
  await act(async () => button('手动创建单个伙伴').click());
  expect(manual).toHaveBeenCalledOnce();
  expect(created).not.toHaveBeenCalled();
});

it('distinguishes discovery failure from no tools and recovers through detection', async () => {
  failed = true;
  await mount();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('暂时无法检测工具');
  expect(host.textContent).not.toContain('还没有找到可加入的工具');
  expect(button('查看我的团队').disabled).toBe(true);
  failed = false;
  await act(async () => button('重新检测').click());
  expect(button('一键创建 3 位伙伴').disabled).toBe(false);
});

it('reads the real roster before recommending and does not overwrite an existing partner', async () => {
  existing = [
    {
      id: 'owned-claude',
      displayName: '我的架构师',
      clientId: 'anthropic',
      configurationSource: 'native_tool',
      defaultModel: 'my-model',
      mentionPatterns: ['@my-cat'],
      color: { primary: '#000000', secondary: '#ffffff' },
      avatar: '',
      personality: '保留',
      roleDescription: '原职责',
    },
  ];
  await mount();
  expect(host.textContent).toContain('我的架构师');
  await act(async () => button('一键创建 2 位伙伴').click());
  const posts = vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts.some(([, init]) => String(init?.body).includes('owned-claude'))).toBe(false);
  expect(created).toHaveBeenCalledOnce();
});
