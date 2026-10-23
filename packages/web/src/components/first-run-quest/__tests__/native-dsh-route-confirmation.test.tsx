import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiFetch } from '@/utils/api-client';
import { NativePartnerCard } from '../NativePartnerCard';
import { buildNativeCreationPayload } from '../native-creation-payload';
import { type NativePartner, nativeRuntimeSelectable, recommendNativePartners } from '../native-onboarding';

vi.mock('@/utils/api-client', () => ({ apiFetch: vi.fn() }));
let host: HTMLDivElement, root: Root;
const runtime = {
  id: 'dsh',
  harnessId: 'dsh',
  kind: 'tool' as const,
  clientId: 'acp' as const,
  label: 'DSH',
  installed: true,
  dshSetupRequired: true,
  models: [],
  acp: { command: 'dsh', startupArgs: ['--profile', 'acp'], transport: 'stdio' as const },
};
const preparedArgs = ['--profile', 'acp', '--patch', '/host/immutable-dsh-route.yml'];
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
async function mount(missing = false, existing = false) {
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    const value =
      path === '/api/cats/native-runtimes'
        ? { edition: 'intranet', runtimes: [runtime] }
        : path.endsWith('/inspect')
          ? {
              profiles: ['acp', 'desktop'],
              sourceProfile: 'desktop',
              revision: 'a'.repeat(64),
              active: { provider: 'deepseek-official', model: 'official', providers: [] },
              source: {
                providers: [
                  {
                    id: 'company',
                    credentialStatus: missing ? 'missing' : 'configured',
                    models: [{ id: 'private-model', label: 'Private' }],
                  },
                ],
              },
            }
          : path.endsWith('/prepare')
            ? { id: 'receipt', command: 'dsh', startupArgs: preparedArgs }
            : { status: 'live', models: [] };
    return new Response(JSON.stringify(value));
  });
  function Editor() {
    const [partner, setPartner] = useState<NativePartner>(() => {
      const partner = recommendNativePartners([runtime], [], [], 'route-test', 'intranet')[0];
      return existing
        ? { ...partner, existingId: 'existing-dsh', form: { ...partner.form, catId: 'existing-dsh' } }
        : partner;
    });
    return (
      <>
        <NativePartnerCard
          partner={partner}
          created={existing}
          patch={(change) => setPartner((old) => ({ ...old, ...change }))}
          onValidityChange={vi.fn()}
        />
        <output>
          {JSON.stringify({
            selected: partner.selected,
            selectable: nativeRuntimeSelectable(partner.runtime, partner.form),
            existingId: partner.existingId,
            dshSetupPrepared: partner.dshSetupPrepared,
            payload: buildNativeCreationPayload(partner.form),
          })}
        </output>
      </>
    );
  }
  await act(async () => root.render(<Editor />));
}
it('automatically reads Desktop custom route and requires one confirmation before the creation payload becomes selectable', async () => {
  await mount();
  const before = JSON.parse(host.querySelector('output')!.textContent!);
  expect(before.selected).toBe(false);
  expect(before.selectable).toBe(false);
  const inspect = vi.mocked(apiFetch).mock.calls.find(([path]) => path.endsWith('/inspect'));
  expect(JSON.parse(String(inspect?.[1]?.body))).toMatchObject({ runtimeId: 'dsh', sourceProfile: 'auto' });
  expect(host.textContent).toContain('已读取配置来源：desktop');
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === '使用此配置');
  expect(button?.disabled).toBe(false);
  await act(async () => button!.click());
  const after = JSON.parse(host.querySelector('output')!.textContent!);
  expect(after.selected).toBe(true);
  expect(after.selectable).toBe(true);
  expect(after.payload.acp.startupArgs).toEqual(preparedArgs);
  expect(after.payload.configurationSource).toBe('native_tool');
  expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path.endsWith('/test'))).toBe(false);
});
it('does not select, prepare or submit an uncredentialed route', async () => {
  await mount(true);
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === '使用此配置');
  expect(button?.disabled).toBe(true);
  expect(host.textContent).toContain('DSH 的“设置 → 模型”');
  expect(JSON.parse(host.querySelector('output')!.textContent!).selected).toBe(false);
  expect(vi.mocked(apiFetch).mock.calls.some(([path]) => path.endsWith('/prepare'))).toBe(false);
});
it('opens an existing unconfirmed DSH for explicit repair and keeps its member ID', async () => {
  await mount(false, true);
  const button = [...host.querySelectorAll('button')].find((item) => item.textContent === '使用此配置');
  expect(button?.disabled).toBe(false);
  await act(async () => button!.click());
  const saved = JSON.parse(host.querySelector('output')!.textContent!);
  expect(saved.selected).toBe(true);
  expect(saved.existingId).toBe('existing-dsh');
  expect(saved.dshSetupPrepared).toBe(true);
  expect(saved.payload.catId).toBe('existing-dsh');
  expect(saved.payload.acp.startupArgs).toEqual(preparedArgs);
});
