import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/utils/api-client';

const storeState = {
  hubState: { open: true, tab: 'provider-profiles' },
  closeHub: () => {},
  threads: [],
  currentThreadId: 'thread-active',
  catInvocations: {},
  threadStates: {},
};

vi.mock('@/stores/chatStore', () => ({
  useChatStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock('@/hooks/useCatData', () => ({
  useCatData: () => ({
    cats: [
      {
        id: 'opus',
        displayName: '布偶猫',
        nickname: '宪宪',
        color: { primary: '#9B7EBD', secondary: '#E8D5F5' },
        mentionPatterns: ['@opus'],
        provider: 'anthropic',
        defaultModel: 'claude-opus-4-6',
        avatar: '/avatars/opus.png',
        roleDescription: '架构',
        personality: '稳重',
      },
    ],
    isLoading: false,
    getCatById: () => undefined,
    getCatsByBreed: () => new Map(),
    refresh: () => Promise.resolve([]),
  }),
  formatCatName: (cat: { displayName: string; variantLabel?: string }) =>
    cat.variantLabel ? `${cat.displayName}（${cat.variantLabel}）` : cat.displayName,
}));

vi.mock('@/utils/api-client', () => ({
  apiFetch: vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
}));

import { CatCafeHub } from '@/components/CatCafeHub';
import { HubProviderProfilesTab } from '@/components/HubProviderProfilesTab';

const mockApiFetch = vi.mocked(apiFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('CatCafeHub provider profiles tab', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as { React?: typeof React }).React = React;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    delete (globalThis as { React?: typeof React }).React;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mockApiFetch.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('renders provider profiles tab label', () => {
    const html = renderToStaticMarkup(React.createElement(CatCafeHub));
    expect(html).toContain('账号配置');
  });

  it('renders provider profiles tab initial loading state', () => {
    const html = renderToStaticMarkup(React.createElement(HubProviderProfilesTab));
    expect(html).toContain('加载中');
  });

  it('renders ragdoll rescue section after tab data loads', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/api/provider-profiles')) {
        return Promise.resolve(
          jsonResponse({
            projectPath: '/tmp/project',
            activeProfileId: 'claude-oauth',
            providers: [
              {
                id: 'claude-oauth',
                provider: 'claude-oauth',
                displayName: 'Claude (OAuth)',
                name: 'Claude (OAuth)',
                authType: 'oauth',
                protocol: 'anthropic',
                builtin: true,
                mode: 'subscription',
                models: ['claude-opus-4-6'],
                hasApiKey: false,
                createdAt: '2026-03-18T00:00:00.000Z',
                updatedAt: '2026-03-18T00:00:00.000Z',
              },
              {
                id: 'codex-sponsor',
                provider: 'codex-sponsor',
                displayName: 'Codex Sponsor',
                name: 'Codex Sponsor',
                authType: 'api_key',
                protocol: 'openai',
                builtin: false,
                mode: 'api_key',
                baseUrl: 'https://api.openai-proxy.dev',
                models: ['gpt-5.4'],
                hasApiKey: true,
                createdAt: '2026-03-18T00:00:00.000Z',
                updatedAt: '2026-03-18T00:00:00.000Z',
              },
            ],
          }),
        );
      }
      if (path === '/api/claude-rescue/sessions') {
        return Promise.resolve(jsonResponse({ sessions: [] }));
      }
      throw new Error(`Unexpected apiFetch path: ${path}`);
    });

    await act(async () => {
      root.render(React.createElement(HubProviderProfilesTab));
    });
    await flushEffects();

    expect(container.textContent).toContain('布偶猫账号配置');
    expect(container.textContent).toContain('Claude (OAuth)');
    expect(container.textContent).toContain('Codex Sponsor');
    expect(container.textContent).toContain('新建 API Key 账号');
    expect(container.textContent).toContain('布偶猫救援中心');
    expect(container.textContent).toContain('暂未发现坏掉的布偶猫 session');
  });
});
