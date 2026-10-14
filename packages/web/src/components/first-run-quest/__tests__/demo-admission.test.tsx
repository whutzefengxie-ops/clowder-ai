import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiFetch } from '@/utils/api-client';
import { useDemoAdmission } from '../../onboarding-demo/useDemoAdmission';

vi.mock('@/utils/api-client', () => ({ API_URL: 'http://isolated', apiFetch: vi.fn() }));
let root: Root, host: HTMLDivElement, admission: ReturnType<typeof useDemoAdmission>;
const open = vi.fn();
function Probe() {
  admission = useDemoAdmission(true, open);
  return <p>{admission.error}</p>;
}
function ExistingTeam() {
  useDemoAdmission(true, open, false);
  return null;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it('keeps personal admission readable but does not automatically offer setup to an existing team', async () => {
  vi.mocked(apiFetch).mockResolvedValue(
    new Response(JSON.stringify({ userId: 'owner', version: 'collaboration-v1', status: 'not_started' })),
  );
  await act(async () => root.render(<ExistingTeam />));
  expect(open).not.toHaveBeenCalled();
});
it.each([
  'not_started',
  'dismissed',
  'completed',
])('automatically opens only an unexecuted authenticated guide: %s', async (status) => {
  vi.mocked(apiFetch).mockResolvedValue(
    new Response(JSON.stringify({ userId: 'owner', version: 'collaboration-v1', status })),
  );
  await act(async () => root.render(<Probe />));
  expect(open).toHaveBeenCalledTimes(status === 'not_started' ? 1 : 0);
  expect(admission.storageScope).toBe('http://isolated:owner:collaboration-v1');
  await act(async () => root.render(<Probe />));
  expect(open).toHaveBeenCalledTimes(status === 'not_started' ? 1 : 0);
});
it('does not guess admission on failure, and retains a failed completion for explicit retry', async () => {
  vi.mocked(apiFetch).mockResolvedValue(new Response('{}', { status: 503 }));
  await act(async () => root.render(<Probe />));
  expect(open).not.toHaveBeenCalled();
  await act(async () => admission.complete());
  expect(host.textContent).toContain('引导记录未保存');
  vi.mocked(apiFetch).mockResolvedValue(
    new Response(JSON.stringify({ userId: 'owner', version: 'collaboration-v1', status: 'completed' })),
  );
  await act(async () => admission.retry());
  expect(host.textContent).toBe('');
  expect(vi.mocked(apiFetch).mock.lastCall?.[1]).toMatchObject({
    method: 'PUT',
    body: JSON.stringify({ status: 'completed' }),
  });
});
