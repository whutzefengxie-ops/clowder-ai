import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { apiFetch } from '@/utils/api-client';
import { useRuntimeCatalog } from '../settings/members/useRuntimeCatalog';

vi.mock('@/utils/api-client', () => ({ apiFetch: vi.fn() }));

it('keeps model names while dependent efforts load but never leaks a catalog across connections', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const pending: Array<(response: Response) => void> = [];
  vi.mocked(apiFetch).mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  function Catalog({ model = '', account = '' }: { model?: string; account?: string }) {
    const result = useRuntimeCatalog('acp:dsh', 'dsh', account, model, 0);
    return <output>{JSON.stringify(result)}</output>;
  }
  const snapshot = () => JSON.parse(host.textContent || '{}');
  const reply = (label: string) =>
    new Response(
      JSON.stringify({
        status: 'live',
        models: [{ value: 'opaque', label }],
        effortOptions: [{ value: 'high', label: 'High' }],
      }),
    );
  try {
    await act(async () => root.render(<Catalog />));
    await act(async () => pending[0](reply('Model A')));
    await act(async () => root.render(<Catalog model="opaque" />));
    expect(snapshot().catalog.models[0].label).toBe('Model A');
    expect(snapshot().catalog.effortOptions).toBeUndefined();
    expect(snapshot().loading).toBe(true);
    await act(async () => root.render(<Catalog account="other-connection" />));
    expect(snapshot().catalog).toBeNull();
    await act(async () => pending[1](reply('Stale A')));
    expect(snapshot().catalog).toBeNull();
    await act(async () => pending[2](reply('Model B')));
    expect(snapshot().catalog.models[0].label).toBe('Model B');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.resetAllMocks();
  }
});
