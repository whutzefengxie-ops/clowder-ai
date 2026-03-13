import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ActivityTracker } from '../dist/domains/health/ActivityTracker.js';

describe('ActivityTracker', () => {
  /** @type {ActivityTracker} */
  let tracker;
  const USER = 'user-1';
  const THRESHOLD = 90 * 60_000; // 90 minutes in ms

  beforeEach(() => {
    tracker = new ActivityTracker();
  });

  // Base timestamp (never 0 — lastActivityTs > 0 guard needs real timestamps)
  const T0 = 1_000_000;
  const TICK = 60_000; // 1min intervals (within 5min gap)

  /** Simulate continuous work for `minutes` by ticking every 1min from startMs */
  function simulateWork(userId, startMs, minutes) {
    for (let i = 0; i <= minutes; i++) {
      tracker.recordActivity(userId, startMs + i * TICK);
    }
  }

  describe('recordActivity', () => {
    it('initializes state for new user', () => {
      tracker.recordActivity(USER, T0);
      const s = tracker.getState(USER);
      assert.equal(s.lastActivityTs, T0);
      assert.equal(s.activeWorkMs, 0); // first ping = baseline, no elapsed
    });

    it('accumulates time within 5min gap', () => {
      tracker.recordActivity(USER, T0);
      tracker.recordActivity(USER, T0 + 60_000); // +1min
      tracker.recordActivity(USER, T0 + 180_000); // +2min more
      const s = tracker.getState(USER);
      assert.equal(s.activeWorkMs, 180_000); // 3 min total
    });

    it('resets gap if > 5min since last activity', () => {
      tracker.recordActivity(USER, T0);
      tracker.recordActivity(USER, T0 + 60_000); // +1min accumulated
      tracker.recordActivity(USER, T0 + 400_000); // +5:40 gap → no add
      const s = tracker.getState(USER);
      assert.equal(s.activeWorkMs, 60_000); // stayed at 1min
    });

    it('resumes accumulation after a gap', () => {
      tracker.recordActivity(USER, T0);
      tracker.recordActivity(USER, T0 + 60_000); // +1min
      tracker.recordActivity(USER, T0 + 400_000); // gap — no add
      tracker.recordActivity(USER, T0 + 430_000); // +30s within new window
      const s = tracker.getState(USER);
      assert.equal(s.activeWorkMs, 90_000); // 60s + 30s
    });
  });

  describe('shouldTrigger', () => {
    it('returns 0 when under threshold', () => {
      simulateWork(USER, T0, 89); // 89 min < 90 min threshold
      assert.equal(tracker.shouldTrigger(USER, THRESHOLD), 0);
    });

    it('returns 1 at threshold (90min)', () => {
      simulateWork(USER, T0, 90);
      assert.equal(tracker.shouldTrigger(USER, THRESHOLD), 1);
    });

    it('returns 2 at 2x threshold (180min)', () => {
      simulateWork(USER, T0, 180);
      assert.equal(tracker.shouldTrigger(USER, THRESHOLD), 2);
    });

    it('returns 3 at 3x threshold (270min)', () => {
      simulateWork(USER, T0, 270);
      assert.equal(tracker.shouldTrigger(USER, THRESHOLD), 3);
    });

    it('returns 0 when dismissed', () => {
      simulateWork(USER, T0, 180);
      tracker.handleCheckin(USER, 'rest', undefined, T0 + 180 * TICK);
      assert.equal(tracker.shouldTrigger(USER, THRESHOLD), 0);
    });
  });

  describe('handleCheckin', () => {
    it('rest resets timer and dismisses with short cooldown', () => {
      simulateWork(USER, T0, 90);
      tracker.handleCheckin(USER, 'rest', undefined, T0 + 90 * TICK);
      const s = tracker.getState(USER);
      assert.equal(s.activeWorkMs, 0);
      assert.equal(s.dismissed, true);
      assert.equal(s.dismissCooldownMs, 5 * 60_000);
      assert.equal(s.triggerLevel, 0);
    });

    it('wrap_up dismisses with 10min cooldown', () => {
      simulateWork(USER, T0, 90);
      tracker.handleCheckin(USER, 'wrap_up', undefined, T0 + 90 * TICK);
      const s = tracker.getState(USER);
      assert.equal(s.dismissed, true);
      assert.equal(s.dismissCooldownMs, 10 * 60_000);
    });

    it('continue records bypass with escalating cooldown', () => {
      simulateWork(USER, T0, 90);
      const r1 = tracker.handleCheckin(USER, 'continue', 'fixing bug', T0 + 90 * TICK);
      assert.equal(r1.nextCheckMinutes, 30);
      assert.equal(tracker.getState(USER).bypassCount, 1);

      tracker._setDismissed(USER, false);
      const r2 = tracker.handleCheckin(USER, 'continue', 'still fixing', T0 + 120 * TICK);
      assert.equal(r2.nextCheckMinutes, 45);
      assert.equal(tracker.getState(USER).bypassCount, 2);

      tracker._setDismissed(USER, false);
      const r3 = tracker.handleCheckin(USER, 'continue', 'almost done', T0 + 165 * TICK);
      assert.equal(r3.nextCheckMinutes, -1);
      assert.equal(tracker.getState(USER).bypassCount, 3);
    });
  });

  describe('auto-reset dismissed after cooldown', () => {
    it('dismissed resets after cooldown expires', () => {
      simulateWork(USER, T0, 90);
      const checkinTs = T0 + 90 * TICK;
      tracker.handleCheckin(USER, 'rest', undefined, checkinTs);
      assert.equal(tracker.getState(USER).dismissed, true);

      // Within 5min cooldown — still dismissed
      tracker.recordActivity(USER, checkinTs + 4 * 60_000);
      assert.equal(tracker.getState(USER).dismissed, true);

      // After cooldown — auto un-dismiss
      tracker.recordActivity(USER, checkinTs + 6 * 60_000);
      assert.equal(tracker.getState(USER).dismissed, false);
    });

    it('resets lastTriggeredLevel on cooldown expiry so same level can re-trigger', () => {
      simulateWork(USER, T0, 90);
      // Trigger L1 and mark
      const level = tracker.shouldTrigger(USER, THRESHOLD);
      assert.equal(level, 1);
      tracker.markTriggered(USER, 1);

      // wrap_up — 10min cooldown
      const checkinTs = T0 + 90 * TICK;
      tracker.handleCheckin(USER, 'wrap_up', undefined, checkinTs);

      // After 10min cooldown, continue working — same level should trigger again
      const afterCooldown = checkinTs + 11 * 60_000;
      tracker.recordActivity(USER, afterCooldown);
      assert.equal(tracker.shouldTrigger(USER, THRESHOLD), 1);
    });
  });

  describe('isNightMode', () => {
    it('returns true for 23:00-05:59 hours', () => {
      // We test the static method with injected hour
      assert.equal(ActivityTracker.isNightModeForHour(23), true);
      assert.equal(ActivityTracker.isNightModeForHour(0), true);
      assert.equal(ActivityTracker.isNightModeForHour(3), true);
      assert.equal(ActivityTracker.isNightModeForHour(5), true);
    });

    it('returns false for 06:00-22:59 hours', () => {
      assert.equal(ActivityTracker.isNightModeForHour(6), false);
      assert.equal(ActivityTracker.isNightModeForHour(12), false);
      assert.equal(ActivityTracker.isNightModeForHour(22), false);
    });
  });

  describe('bypass 4h window (AC13)', () => {
    it('resets bypass count after 4h window expires', () => {
      simulateWork(USER, T0, 90);
      const t1 = T0 + 90 * TICK;
      tracker.handleCheckin(USER, 'continue', 'urgent', t1);
      assert.equal(tracker.getState(USER).bypassCount, 1);

      // 4h later — bypass count should reset
      const t2 = t1 + 4 * 60 * 60_000 + 1;
      tracker._setDismissed(USER, false);
      simulateWork(USER, t2, 90);
      const r = tracker.handleCheckin(USER, 'continue', 'urgent again', t2 + 90 * TICK);
      // Should be treated as 1st bypass again (30min), not 2nd (45min)
      assert.equal(r.nextCheckMinutes, 30);
    });

    it('counts only bypasses within 4h window', () => {
      simulateWork(USER, T0, 90);
      const t1 = T0 + 90 * TICK;
      // 1st bypass
      tracker.handleCheckin(USER, 'continue', 'fix1', t1);
      // 2nd bypass 1h later (within 4h)
      const t2 = t1 + 60 * 60_000;
      tracker._setDismissed(USER, false);
      const r2 = tracker.handleCheckin(USER, 'continue', 'fix2', t2);
      assert.equal(r2.nextCheckMinutes, 45); // 2nd within window
    });
  });

  describe('bypassDisabled in response', () => {
    it('returns bypassDisabled: true on 3rd bypass', () => {
      simulateWork(USER, T0, 90);
      const t1 = T0 + 90 * TICK;
      tracker.handleCheckin(USER, 'continue', 'fix1', t1);
      tracker._setDismissed(USER, false);
      tracker.handleCheckin(USER, 'continue', 'fix2', t1 + 10 * TICK);
      tracker._setDismissed(USER, false);
      const r3 = tracker.handleCheckin(USER, 'continue', 'fix3', t1 + 20 * TICK);
      assert.equal(r3.nextCheckMinutes, -1);
      assert.equal(r3.bypassDisabled, true);
    });

    it('returns bypassDisabled: undefined on normal bypass', () => {
      simulateWork(USER, T0, 90);
      const r1 = tracker.handleCheckin(USER, 'continue', 'fix1', T0 + 90 * TICK);
      assert.equal(r1.bypassDisabled, undefined);
    });
  });

  describe('forced-nag after 3rd bypass resets dedup', () => {
    it('shouldTrigger returns level after 3rd bypass (nag mode)', () => {
      simulateWork(USER, T0, 90);
      const t1 = T0 + 90 * TICK;
      // Trigger and mark L1
      tracker.markTriggered(USER, 1);

      // 3 bypasses within 4h
      tracker.handleCheckin(USER, 'continue', 'fix1', t1);
      tracker._setDismissed(USER, false);
      tracker.handleCheckin(USER, 'continue', 'fix2', t1 + 10 * TICK);
      tracker._setDismissed(USER, false);
      tracker.handleCheckin(USER, 'continue', 'fix3', t1 + 20 * TICK);
      // After 3rd bypass: dismissed=false, should be able to re-trigger
      assert.equal(tracker.shouldTrigger(USER, THRESHOLD), 1);
    });
  });

  describe('trigger dedup', () => {
    it('shouldTrigger returns 0 if same level already triggered', () => {
      simulateWork(USER, T0, 90);
      const level1 = tracker.shouldTrigger(USER, THRESHOLD);
      assert.equal(level1, 1);

      // Mark as triggered
      tracker.markTriggered(USER, 1);

      // Same level should not re-trigger
      assert.equal(tracker.shouldTrigger(USER, THRESHOLD), 0);
    });

    it('shouldTrigger returns new level when escalated', () => {
      simulateWork(USER, T0, 90);
      tracker.markTriggered(USER, 1);

      // Work more to reach L2
      simulateWork(USER, T0 + 90 * TICK, 90);
      assert.equal(tracker.shouldTrigger(USER, THRESHOLD), 2);
    });
  });

  describe('settings (AC28+AC31)', () => {
    it('returns default settings for new user', () => {
      const s = tracker.getSettings(USER);
      assert.deepEqual(s, { enabled: true, thresholdMinutes: 90 });
    });

    it('updates enabled flag', () => {
      tracker.updateSettings(USER, { enabled: false });
      assert.equal(tracker.getSettings(USER).enabled, false);
    });

    it('updates threshold', () => {
      tracker.updateSettings(USER, { thresholdMinutes: 60 });
      assert.equal(tracker.getSettings(USER).thresholdMinutes, 60);
    });

    it('shouldTrigger returns 0 when disabled', () => {
      tracker.updateSettings(USER, { enabled: false });
      simulateWork(USER, T0, 120);
      assert.equal(tracker.shouldTrigger(USER), 0);
    });

    it('shouldTrigger uses custom threshold from settings', () => {
      tracker.updateSettings(USER, { thresholdMinutes: 60 });
      simulateWork(USER, T0, 60);
      assert.equal(tracker.shouldTrigger(USER), 1);
      // Would be 0 at default 90min threshold
    });

    it('rejects threshold below 30', () => {
      const result = tracker.updateSettings(USER, { thresholdMinutes: 10 });
      assert.equal('error' in result, true);
    });

    it('rejects threshold above 240', () => {
      const result = tracker.updateSettings(USER, { thresholdMinutes: 300 });
      assert.equal('error' in result, true);
    });

    it('rejects non-number threshold', () => {
      const result = tracker.updateSettings(USER, { thresholdMinutes: /** @type {any} */ ('abc') });
      assert.equal('error' in result, true);
    });

    it('rejects non-boolean enabled (P1: string "false" must not coerce to true)', () => {
      const result = tracker.updateSettings(USER, { enabled: /** @type {any} */ ('false') });
      assert.equal('error' in result, true);
      // Ensure settings unchanged
      const settings = tracker.getSettings(USER);
      assert.equal(settings.enabled, true);
    });
  });

  describe('isolation between users', () => {
    it('tracks users independently', () => {
      simulateWork('user-a', T0, 90);
      simulateWork('user-b', T0, 1); // only 1 min

      assert.equal(tracker.shouldTrigger('user-a', THRESHOLD), 1);
      assert.equal(tracker.shouldTrigger('user-b', THRESHOLD), 0);
    });
  });
});
