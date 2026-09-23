import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiFetch } from '@/utils/api-client';
import { ConfigStep } from '../ConfigStep';

vi.mock('@/utils/api-client', () => ({ apiFetch: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks(); });

it('uses a detected logged-in CLI when the Clowder account catalog is empty', async () => {
  const onComplete = vi.fn();
  vi.mocked(apiFetch).mockImplementation(async (url) => new Response(JSON.stringify(
    url === '/api/accounts' ? { providers: [] } : url === '/api/cat-templates'
      ? { clientDefaults: { codex: { defaultModel: 'gpt-test', models: ['gpt-test'] } } }
      : { ok: true, message: '连接成功' },
  )));

  await act(async () => {
    root.render(<ConfigStep client="codex" clientId="openai" detectedOAuth onComplete={onComplete} />);
  });
  expect(container.textContent).toContain('本机 CLI 登录');
  expect(container.textContent).not.toContain('未找到可用账号');
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="first-run-connect-test"]')?.click(); });
  expect(vi.mocked(apiFetch)).toHaveBeenCalledWith('/api/first-run/connectivity-test', expect.objectContaining({
    body: JSON.stringify({ profileId: 'codex', clientId: 'openai', client: 'codex', model: 'gpt-test' }),
  }));
  const create = container.querySelector<HTMLButtonElement>('[data-testid="first-run-create-cat"]');
  expect(create?.disabled).toBe(false);
  await act(async () => { create?.click(); });
  expect(onComplete).toHaveBeenCalledWith({ accountRef: 'codex', model: 'gpt-test' });
});
