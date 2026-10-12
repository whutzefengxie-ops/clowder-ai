import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuidedOnboarding } from '../../onboarding-demo/GuidedOnboarding';

let root: Root, host: HTMLDivElement;
const close = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('No API should be used by demo'))),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const button = (text: string) => {
  const element = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
};
const mount = () => act(() => root.render(<GuidedOnboarding open storageScope="demo-user" onClose={close} />));
const tick = async () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });

it('automates all handoffs without clients or API calls and opens a working deliverable', async () => {
  await mount();
  act(() => button('开始引导').click());
  for (let i = 0; i < 16; i++) await tick();
  expect(document.body.textContent).toContain('审查通过');
  expect(document.body.textContent).toContain('已修正');
  expect(document.querySelectorAll('[data-demo-handoff]').length).toBeGreaterThanOrEqual(6);
  const frame = document.querySelector('iframe');
  expect(frame?.title).toBe('今天待办 · 演示成果');
  expect(fetch).not.toHaveBeenCalled();
  expect(document.querySelector('a[href*="view=add"]')).toBeNull();
  await act(async () => {
    window.dispatchEvent(
      new window.MessageEvent('message', {
        source: frame?.contentWindow,
        data: { type: 'clowder-onboarding-ready', version: 1 },
      }),
    );
  });
  expect(document.querySelector('a')?.getAttribute('href')).toBe('/settings?s=members&shell=v2&view=add');
  expect(document.querySelector('a')?.textContent).toContain('创建我的猫猫');
});

it('ignores unrelated frames, offers retry on timeout, and accepts the current frame only', async () => {
  localStorage.setItem('cat-cafe:scripted-onboarding:v1:demo-user', JSON.stringify({ version: 1, index: 9 }));
  await mount();
  act(() =>
    window.dispatchEvent(
      new window.MessageEvent('message', { source: window, data: { type: 'clowder-onboarding-ready', version: 1 } }),
    ),
  );
  expect(document.querySelector('a')).toBeNull();
  await tick();
  expect(document.body.textContent).toContain('成果暂时没有打开');
  const oldFrame = document.querySelector('iframe')?.contentWindow;
  act(() => button('重新打开').click());
  expect(document.body.textContent).toContain('正在打开成果');
  act(() =>
    window.dispatchEvent(
      new window.MessageEvent('message', { source: oldFrame, data: { type: 'clowder-onboarding-ready', version: 1 } }),
    ),
  );
  expect(document.querySelector('a')).toBeNull();
  act(() =>
    window.dispatchEvent(
      new window.MessageEvent('message', {
        source: document.querySelector('iframe')?.contentWindow,
        data: { type: 'clowder-onboarding-ready', version: 1 },
      }),
    ),
  );
  expect(document.querySelector('a')?.textContent).toContain('创建我的猫猫');
  expect(fetch).not.toHaveBeenCalled();
});

it('recovers corrupt bookmarks and does not skip steps under StrictMode', async () => {
  localStorage.setItem('cat-cafe:scripted-onboarding:v1:demo-user', '{broken');
  act(() =>
    root.render(
      <StrictMode>
        <GuidedOnboarding open storageScope="demo-user" onClose={close} />
      </StrictMode>,
    ),
  );
  act(() => button('开始引导').click());
  expect(document.body.textContent).toContain('1 / 9');
  await tick();
  expect(document.body.textContent).toContain('2 / 9');
  act(() => root.render(<GuidedOnboarding open storageScope="another-demo" onClose={close} />));
  expect(button('开始引导')).toBeDefined();
  expect(fetch).not.toHaveBeenCalled();
});

it('works without browser storage and cleans up timers on close', async () => {
  vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  await mount();
  act(() => button('开始引导').click());
  await tick();
  act(() => root.render(<GuidedOnboarding open={false} storageScope="demo-user" onClose={close} />));
  await tick();
  expect(vi.getTimerCount()).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

it('pauses the script and restores the same point paused after reopening', async () => {
  await mount();
  act(() => button('开始引导').click());
  await tick();
  act(() => button('暂停').click());
  const before = document.querySelector('[data-testid="demo-transcript"]')?.textContent;
  await tick();
  expect(document.querySelector('[data-testid="demo-transcript"]')?.textContent).toBe(before);
  act(() => root.render(<GuidedOnboarding open={false} storageScope="demo-user" onClose={close} />));
  await mount();
  expect(button('继续')).toBeDefined();
  expect(document.querySelector('[data-testid="demo-transcript"]')?.textContent).toBe(before);
  expect(fetch).not.toHaveBeenCalled();
});
