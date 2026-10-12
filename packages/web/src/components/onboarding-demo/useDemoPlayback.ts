'use client';

import { useEffect, useState } from 'react';
import { DEMO_EVENTS } from './demo-story';

interface Playback {
  version: 1;
  index: number;
  paused: boolean;
}
const initial: Playback = { version: 1, index: -1, paused: true };

// This is a browser-local demo bookmark, not an account's onboarding completion.
export function useDemoPlayback(scope: string) {
  const key = `cat-cafe:scripted-onboarding:v1:${scope}`;
  const [state, setState] = useState<Playback>(initial);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (
        saved &&
        typeof saved === 'object' &&
        'version' in saved &&
        saved.version === 1 &&
        'index' in saved &&
        typeof saved.index === 'number' &&
        Number.isInteger(saved.index) &&
        saved.index >= -1 &&
        saved.index <= DEMO_EVENTS.length
      ) {
        setState({ version: 1, index: saved.index, paused: true });
      }
    } catch {
      /* Storage is optional; the demo also works in private browsing. */
    }
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* No persistence required. */
    }
  }, [key, ready, state]);
  useEffect(() => {
    const event = DEMO_EVENTS[state.index];
    if (!ready || state.paused || !event) return;
    const timer = setTimeout(() => setState((current) => ({ ...current, index: current.index + 1 })), event.duration);
    return () => clearTimeout(timer);
  }, [ready, state.index, state.paused]);
  return {
    ...state,
    ready,
    finished: state.index === DEMO_EVENTS.length,
    start: () => setState({ version: 1, index: 0, paused: false }),
    toggle: () => setState((current) => ({ ...current, paused: !current.paused })),
  };
}
