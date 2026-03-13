/**
 * Game Type System Tests (F101 Task A2)
 * Verifies type guards for the game engine type system.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isGameEvent, isSeatId, isValidScope } from '@cat-cafe/shared';

describe('Game type guards', () => {
  describe('isSeatId', () => {
    it('accepts P1, P2, P12', () => {
      assert.ok(isSeatId('P1'));
      assert.ok(isSeatId('P2'));
      assert.ok(isSeatId('P12'));
    });

    it('rejects invalid seat IDs', () => {
      assert.ok(!isSeatId('P0'));
      assert.ok(!isSeatId('P'));
      assert.ok(!isSeatId(''));
      assert.ok(!isSeatId('player1'));
      assert.ok(!isSeatId('1'));
      assert.ok(!isSeatId('p1'));
    });
  });

  describe('isValidScope', () => {
    it('accepts valid scopes', () => {
      assert.ok(isValidScope('public'));
      assert.ok(isValidScope('seat:P1'));
      assert.ok(isValidScope('seat:P12'));
      assert.ok(isValidScope('faction:wolf'));
      assert.ok(isValidScope('faction:villager'));
      assert.ok(isValidScope('judge'));
      assert.ok(isValidScope('god'));
    });

    it('rejects invalid scopes', () => {
      assert.ok(!isValidScope(''));
      assert.ok(!isValidScope('private'));
      assert.ok(!isValidScope('seat:'));
      assert.ok(!isValidScope('seat:P0'));
      assert.ok(!isValidScope('faction:'));
      assert.ok(!isValidScope('admin'));
    });
  });

  describe('isGameEvent', () => {
    it('accepts valid game event', () => {
      const event = {
        eventId: 'evt-001',
        round: 1,
        phase: 'night_wolf',
        type: 'night_action',
        scope: 'faction:wolf',
        payload: { target: 'P3' },
        timestamp: Date.now(),
      };
      assert.ok(isGameEvent(event));
    });

    it('rejects missing fields', () => {
      assert.ok(!isGameEvent({}));
      assert.ok(!isGameEvent(null));
      assert.ok(!isGameEvent(undefined));
      assert.ok(!isGameEvent({ eventId: 'x' }));
    });

    it('rejects invalid scope in event', () => {
      const event = {
        eventId: 'evt-001',
        round: 1,
        phase: 'night_wolf',
        type: 'night_action',
        scope: 'invalid',
        payload: {},
        timestamp: Date.now(),
      };
      assert.ok(!isGameEvent(event));
    });
  });
});
