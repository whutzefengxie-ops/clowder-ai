import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { apiFetch } from '@/utils/api-client';
import { useNativeOnboarding } from '../useNativeOnboarding';

vi.mock('@/utils/api-client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/hooks/useCatData', () => ({ useCatData: () => ({ refresh: vi.fn() }) }));

it('restores legacy three-role drafts and independent request receipts after discovery becomes one harness', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  const templates = ['ragdoll', 'maine-coon', 'turkish-van'].map((id, index) => ({
    id,
    name: ['布偶猫', '缅因猫', '梵花猫'][index],
    nickname: ['宪宪', '砚砚', '墨墨'][index],
    avatar: '/avatars/default.png',
    color: { primary: '#111111', secondary: '#eeeeee' },
    roleDescription: `role-${id}`,
    personality: `personality-${id}`,
  }));
  const canonical = {
    id: 'codeagent',
    kind: 'tool',
    harnessId: 'codeagent',
    label: 'CodeAgent',
    clientId: 'acp',
    installed: true,
    models: [],
    acp: { command: 'codeagent', startupArgs: ['--acp'], transport: 'stdio' },
    roleTemplates: templates.map((template) => ({ id: template.id, priority: 100 })),
  };
  let upgraded = false;
  let state: ReturnType<typeof useNativeOnboarding> | undefined;
  function Harness() {
    state = useNativeOnboarding(true, vi.fn(), 'members');
    return null;
  }
  vi.mocked(apiFetch).mockImplementation(
    async (path) =>
      new Response(
        JSON.stringify(
          String(path).startsWith('/api/cats/native-runtimes')
            ? {
                edition: 'intranet',
                runtimes: upgraded
                  ? [canonical]
                  : templates.map((template) => ({
                      ...canonical,
                      roleTemplates: undefined,
                      id: `codeagent:${template.id}`,
                      label: `CodeAgent · ${template.nickname}`,
                      roleTemplateId: template.id,
                      priority: 100,
                    })),
              }
            : path === '/api/session'
              ? { userId: 'harness-upgrade' }
              : path === '/api/cat-templates'
                ? { templates }
                : { cats: [] },
        ),
      ),
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Harness />));
    const first = state?.draft?.partners[0];
    if (!first) throw Error('Initial recommendation missing');
    const third = state?.draft?.partners[2];
    if (!third) throw Error('Third recommendation missing');
    await act(async () => state?.patch({ lead: third.id }));
    await act(async () =>
      state?.patchPartner(first.id, {
        selected: false,
        form: {
          ...first.form,
          nickname: '我的宪宪',
          defaultModel: 'company-model',
          acpStartupArgs: '--acp --custom-preference',
        },
      }),
    );
    const before = structuredClone(state?.draft?.partners);
    upgraded = true;
    await act(async () => state?.reload());
    expect(state?.draft?.lead).toBe(third.id);
    expect(
      state?.draft?.partners.map((partner) => ({
        id: partner.id,
        form: partner.form,
        key: partner.creationRequestKey,
        selected: partner.selected,
      })),
    ).toEqual(
      before?.map((partner) => ({
        id: partner.id,
        form: partner.form,
        key: partner.creationRequestKey,
        selected: partner.selected,
      })),
    );
    expect(state?.draft?.partners.map((partner) => partner.runtime.label)).toEqual([
      'CodeAgent',
      'CodeAgent',
      'CodeAgent',
    ]);
    expect(new Set(state?.draft?.partners.map((partner) => partner.creationRequestKey)).size).toBe(3);
    expect(vi.mocked(apiFetch).mock.calls.some(([, init]) => ['POST', 'PATCH'].includes(init?.method ?? ''))).toBe(
      false,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.clear();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  }
});
