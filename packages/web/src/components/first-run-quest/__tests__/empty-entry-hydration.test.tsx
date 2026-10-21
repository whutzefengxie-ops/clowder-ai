import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { DemoEntryActions } from '../../onboarding-demo/DemoEntryActions';

it('hydrates before revealing a cached empty roster, then offers detection and manual enrollment', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  host.innerHTML = renderToString(<DemoEntryActions empty={false} onShowCollaboration={() => {}} />);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(host, <DemoEntryActions empty onShowCollaboration={() => {}} />);
    });
    expect(error).not.toHaveBeenCalled();
    expect(host.textContent).toContain('还没有成员');
    expect([...host.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
      '/settings?s=members&view=setup',
      '/settings?s=members&view=add&manual=1',
    ]);
  } finally {
    const mountedRoot = root;
    if (mountedRoot) act(() => mountedRoot.unmount());
    host.remove();
    error.mockRestore();
    vi.unstubAllGlobals();
  }
});
