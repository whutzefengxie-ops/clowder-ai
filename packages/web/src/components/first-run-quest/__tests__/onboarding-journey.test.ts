import { describe, expect, it } from 'vitest';
import {
  buildRealMembers,
  canContinueClientSetup,
  createJourneyState,
  markFirstRealMessage,
  mergeDetectedAuthStatus,
  type OnboardingClient,
  restoreJourneyState,
} from '../onboarding-journey';

const readyClaude: OnboardingClient = {
  client: 'claude',
  label: 'Claude',
  installed: true,
  authStatus: 'ready',
};

describe('onboarding journey state', () => {
  it('starts with the three-cat demo and no real members', () => {
    const state = createJourneyState();
    expect(state.stage).toBe('demo');
    expect(state.demoParticipants).toHaveLength(3);
    expect(state.realMembers).toEqual([]);
    expect(state.completedAt).toBeUndefined();
    expect(state.demoScene).toBe('opening');
    expect(state.demoPaused).toBe(false);
  });

  it('restores demo scene and pause gate', () => {
    const state = createJourneyState();
    state.demoScene = 'review';
    state.demoPaused = true;
    const restored = restoreJourneyState(JSON.stringify(state));
    expect(restored?.demoScene).toBe('review');
    expect(restored?.demoPaused).toBe(true);
  });

  it('blocks setup when there are no clients or a client is not authenticated', () => {
    expect(canContinueClientSetup([])).toBe(false);
    expect(canContinueClientSetup([{ ...readyClaude, authStatus: 'login_required' }])).toBe(false);
    expect(canContinueClientSetup([readyClaude])).toBe(true);
  });

  it('keeps a local login pending marker until detection proves ready', () => {
    expect(mergeDetectedAuthStatus('login_required', 'pending')).toBe('pending');
    expect(mergeDetectedAuthStatus('pending', 'pending')).toBe('pending');
    expect(mergeDetectedAuthStatus('ready', 'pending')).toBe('ready');
    expect(mergeDetectedAuthStatus('login_required', 'login_required')).toBe('login_required');
  });

  it('projects only selected ready clients into real members', () => {
    const members = buildRealMembers([
      readyClaude,
      { client: 'codex', label: 'Codex', installed: true, authStatus: 'login_required' },
      { client: 'gemini', label: 'Gemini', installed: true, authStatus: 'ready' },
    ]);
    expect(members.map((member) => member.client)).toEqual(['claude', 'gemini']);
    expect(members.every((member) => member.isReal)).toBe(true);
  });

  it('restores unfinished state without replaying the demo', () => {
    const state = createJourneyState();
    state.stage = 'handoff';
    state.demoCompletedAt = 123;
    state.realMembers = [{ client: 'claude', label: 'Claude', isReal: true }];
    const restored = restoreJourneyState(JSON.stringify(state));
    expect(restored?.stage).toBe('handoff');
    expect(restored?.demoCompletedAt).toBe(123);
  });

  it('marks completion only after the first real user message', () => {
    const state = createJourneyState();
    state.stage = 'ready';
    const completed = markFirstRealMessage(state, 456);
    expect(completed.stage).toBe('complete');
    expect(completed.completedAt).toBe(456);
    expect(markFirstRealMessage(completed, 789)).toEqual(completed);
  });
});
