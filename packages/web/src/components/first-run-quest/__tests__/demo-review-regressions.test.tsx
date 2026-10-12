import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DemoInvitation } from '../../onboarding-demo/DemoInvitation';
import { DemoTranscript } from '../../onboarding-demo/DemoTranscript';
import { DEMO_EVENTS, DEMO_SETTINGS_URL } from '../../onboarding-demo/demo-story';
import { GuidedOnboarding } from '../../onboarding-demo/GuidedOnboarding';

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  localStorage.clear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

it('offers setup in the initial invitation without starting or completing the demo', () => {
  const onStart = vi.fn(),
    onSkip = vi.fn();
  act(() => root.render(<DemoInvitation onSkip={onSkip} onStart={onStart} />));
  const setup = host.querySelector('a');
  expect(setup?.getAttribute('href')).toBe(DEMO_SETTINGS_URL);
  act(() => {
    setup?.addEventListener('click', (event) => event.preventDefault());
    setup?.click();
  });
  expect(onSkip).toHaveBeenCalledOnce();
  expect(onStart).not.toHaveBeenCalled();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([-1, 3, 9])('keeps real setup available at bookmark %s, independently of preview readiness', async (index) => {
  localStorage.setItem('cat-cafe:scripted-onboarding:v1:review', JSON.stringify({ version: 1, index }));
  act(() => root.render(<GuidedOnboarding open storageScope="review" onClose={vi.fn()} />));
  expect(document.querySelector('a')?.getAttribute('href')).toBe(DEMO_SETTINGS_URL);
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(document.body.textContent).toContain('成果暂时没有打开');
  expect(document.querySelector('a')?.getAttribute('href')).toBe(DEMO_SETTINGS_URL);
  expect(document.body.textContent).not.toContain('成果已就绪');
});

it('freezes the visible task prefix immediately on pause and continues without shrinking', async () => {
  const events = [DEMO_EVENTS[1]];
  act(() => root.render(<DemoTranscript events={events} playing />));
  await act(async () => vi.advanceTimersByTimeAsync(70));
  const before = host.querySelector('article p')?.textContent;
  expect(before?.length).toBeGreaterThan(0);
  expect(before?.length).toBeLessThan(events[0].text.length);
  act(() => root.render(<DemoTranscript events={events} playing={false} />));
  expect(host.querySelector('article p')?.textContent).toBe(before);
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(host.querySelector('article p')?.textContent).toBe(before);
  act(() => root.render(<DemoTranscript events={events} playing />));
  expect(host.querySelector('article p')?.textContent).toBe(before);
  await act(async () => vi.advanceTimersByTimeAsync(70));
  expect(host.querySelector('article p')?.textContent).toBe(events[0].text.slice(0, (before?.length ?? 0) + 6));
});
