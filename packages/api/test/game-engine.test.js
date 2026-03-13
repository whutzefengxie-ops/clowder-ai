/**
 * GameEngine Core Tests (F101 Task A3)
 * Event log, action validation, GameViewBuilder.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { GameEngine } from '../dist/domains/cats/services/game/GameEngine.js';
import { GameViewBuilder } from '../dist/domains/cats/services/game/GameViewBuilder.js';

/** Minimal test definition */
function createTestDefinition() {
  return {
    gameType: 'test-game',
    displayName: 'Test Game',
    minPlayers: 3,
    maxPlayers: 9,
    roles: [
      { name: 'wolf', faction: 'wolf', nightActionPhase: 'night_wolf', description: 'Wolf' },
      { name: 'seer', faction: 'villager', nightActionPhase: 'night_seer', description: 'Seer' },
      { name: 'villager', faction: 'villager', description: 'Villager' },
    ],
    phases: [
      { name: 'night_wolf', type: 'night_action', actingRole: 'wolf', timeoutMs: 30000, autoAdvance: true },
      { name: 'night_seer', type: 'night_action', actingRole: 'seer', timeoutMs: 30000, autoAdvance: true },
      { name: 'day_discuss', type: 'day_discuss', timeoutMs: 60000, autoAdvance: false },
      { name: 'day_vote', type: 'day_vote', timeoutMs: 30000, autoAdvance: true },
    ],
    actions: [
      { name: 'attack', allowedRole: 'wolf', allowedPhase: 'night_wolf', targetRequired: true, schema: {} },
      { name: 'divine', allowedRole: 'seer', allowedPhase: 'night_seer', targetRequired: true, schema: {} },
      { name: 'vote', allowedRole: '*', allowedPhase: 'day_vote', targetRequired: true, schema: {} },
    ],
    winConditions: [
      { faction: 'villager', description: 'All wolves dead', check: 'wolves_eliminated' },
      { faction: 'wolf', description: 'Wolves >= villagers', check: 'wolf_majority' },
    ],
  };
}

/** Minimal runtime for testing */
function createTestRuntime() {
  const definition = createTestDefinition();
  return {
    gameId: 'game-001',
    threadId: 'thread-001',
    gameType: 'test-game',
    definition,
    seats: [
      { seatId: 'P1', actorType: 'cat', actorId: 'opus', role: 'wolf', alive: true, properties: {} },
      { seatId: 'P2', actorType: 'cat', actorId: 'sonnet', role: 'seer', alive: true, properties: {} },
      { seatId: 'P3', actorType: 'human', actorId: 'owner', role: 'villager', alive: true, properties: {} },
    ],
    currentPhase: 'night_wolf',
    round: 1,
    eventLog: [],
    pendingActions: {},
    status: 'playing',
    config: { timeoutMs: 30000, voiceMode: false, humanSeat: 'P3', humanRole: 'player' },
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('GameEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new GameEngine(createTestRuntime());
  });

  describe('appendEvent', () => {
    it('adds event to log with auto-incrementing eventId', () => {
      engine.appendEvent({
        round: 1,
        phase: 'night_wolf',
        type: 'night_action',
        scope: 'faction:wolf',
        payload: { target: 'P3' },
      });

      const log = engine.getRuntime().eventLog;
      assert.equal(log.length, 1);
      assert.equal(log[0].eventId, 'evt-1');
      assert.equal(log[0].scope, 'faction:wolf');
      assert.ok(log[0].timestamp > 0);

      engine.appendEvent({
        round: 1,
        phase: 'night_seer',
        type: 'divine_result',
        scope: 'seat:P2',
        payload: { target: 'P1', result: 'wolf' },
      });

      assert.equal(log.length, 2);
      assert.equal(log[1].eventId, 'evt-2');
    });

    it('bumps version on append', () => {
      const v1 = engine.getRuntime().version;
      engine.appendEvent({
        round: 1,
        phase: 'night_wolf',
        type: 'test',
        scope: 'public',
        payload: {},
      });
      assert.equal(engine.getRuntime().version, v1 + 1);
    });
  });

  describe('getVisibleEvents', () => {
    it('filters by scope correctly', () => {
      engine.appendEvent({
        round: 1,
        phase: 'night_wolf',
        type: 'attack',
        scope: 'faction:wolf',
        payload: { target: 'P3' },
      });
      engine.appendEvent({
        round: 1,
        phase: 'night_seer',
        type: 'divine',
        scope: 'seat:P2',
        payload: { target: 'P1', result: 'wolf' },
      });
      engine.appendEvent({
        round: 1,
        phase: 'day_discuss',
        type: 'announce',
        scope: 'public',
        payload: { deaths: ['P3'] },
      });

      // Wolf (P1) sees faction:wolf + public
      const wolfEvents = engine.getVisibleEvents('P1');
      assert.equal(wolfEvents.length, 2);
      assert.ok(wolfEvents.some((e) => e.scope === 'faction:wolf'));
      assert.ok(wolfEvents.some((e) => e.scope === 'public'));

      // Seer (P2) sees seat:P2 + public
      const seerEvents = engine.getVisibleEvents('P2');
      assert.equal(seerEvents.length, 2);
      assert.ok(seerEvents.some((e) => e.scope === 'seat:P2'));
      assert.ok(seerEvents.some((e) => e.scope === 'public'));

      // Villager (P3) sees only public
      const villagerEvents = engine.getVisibleEvents('P3');
      assert.equal(villagerEvents.length, 1);
      assert.equal(villagerEvents[0].scope, 'public');
    });

    it('god sees all events', () => {
      engine.appendEvent({ round: 1, phase: 'night_wolf', type: 'attack', scope: 'faction:wolf', payload: {} });
      engine.appendEvent({ round: 1, phase: 'night_seer', type: 'divine', scope: 'seat:P2', payload: {} });
      engine.appendEvent({ round: 1, phase: 'day_discuss', type: 'announce', scope: 'public', payload: {} });
      engine.appendEvent({ round: 1, phase: 'resolve', type: 'resolve', scope: 'god', payload: {} });

      const godEvents = engine.getVisibleEvents('god');
      assert.equal(godEvents.length, 4);
    });
  });

  describe('submitAction', () => {
    it('validates phase + role + alive', () => {
      // P1 is wolf in night_wolf phase — should succeed
      engine.submitAction('P1', { seatId: 'P1', actionName: 'attack', targetSeat: 'P3', submittedAt: Date.now() });
      const actions = engine.getRuntime().pendingActions;
      assert.ok(actions.P1);
      assert.equal(actions.P1.actionName, 'attack');
    });

    it('rejects action from wrong role', () => {
      // P3 is villager, can't attack in night_wolf
      assert.throws(
        () =>
          engine.submitAction('P3', { seatId: 'P3', actionName: 'attack', targetSeat: 'P1', submittedAt: Date.now() }),
        /not allowed/i,
      );
    });

    it('rejects action from dead player', () => {
      const rt = engine.getRuntime();
      rt.seats[0].alive = false; // kill P1
      assert.throws(
        () =>
          engine.submitAction('P1', { seatId: 'P1', actionName: 'attack', targetSeat: 'P3', submittedAt: Date.now() }),
        /dead|not alive/i,
      );
    });

    it('rejects action in wrong phase', () => {
      // P2 is seer, can't divine in night_wolf phase
      assert.throws(
        () =>
          engine.submitAction('P2', { seatId: 'P2', actionName: 'divine', targetSeat: 'P1', submittedAt: Date.now() }),
        /phase/i,
      );
    });
  });

  describe('allActionsCollected', () => {
    it('returns true when all expected actors have submitted', () => {
      assert.ok(!engine.allActionsCollected());
      engine.submitAction('P1', { seatId: 'P1', actionName: 'attack', targetSeat: 'P3', submittedAt: Date.now() });
      // Only P1 is wolf, so only 1 action needed
      assert.ok(engine.allActionsCollected());
    });

    it('returns false when actions are missing', () => {
      // Switch to day_vote where all alive players need to vote
      engine.getRuntime().currentPhase = 'day_vote';
      assert.ok(!engine.allActionsCollected());
    });
  });
});

describe('GameViewBuilder', () => {
  it('builds scoped view for player', () => {
    const runtime = createTestRuntime();
    runtime.eventLog = [
      {
        eventId: 'evt-1',
        round: 1,
        phase: 'night_wolf',
        type: 'attack',
        scope: 'faction:wolf',
        payload: { target: 'P3' },
        timestamp: Date.now(),
      },
      {
        eventId: 'evt-2',
        round: 1,
        phase: 'day_discuss',
        type: 'announce',
        scope: 'public',
        payload: { deaths: ['P3'] },
        timestamp: Date.now(),
      },
    ];

    // Villager P3 should only see public events, and roles should be hidden
    const view = GameViewBuilder.buildView(runtime, 'P3');
    assert.equal(view.visibleEvents.length, 1);
    assert.equal(view.visibleEvents[0].scope, 'public');
    // Roles should be hidden for non-wolf, non-self seats
    const p1View = view.seats.find((s) => s.seatId === 'P1');
    assert.equal(p1View.role, undefined);
    // Own role should be visible
    const p3View = view.seats.find((s) => s.seatId === 'P3');
    assert.equal(p3View.role, 'villager');
  });

  it('builds full view for god', () => {
    const runtime = createTestRuntime();
    runtime.eventLog = [
      {
        eventId: 'evt-1',
        round: 1,
        phase: 'night_wolf',
        type: 'attack',
        scope: 'faction:wolf',
        payload: {},
        timestamp: Date.now(),
      },
      {
        eventId: 'evt-2',
        round: 1,
        phase: 'resolve',
        type: 'internal',
        scope: 'god',
        payload: {},
        timestamp: Date.now(),
      },
      {
        eventId: 'evt-3',
        round: 1,
        phase: 'day_discuss',
        type: 'announce',
        scope: 'public',
        payload: {},
        timestamp: Date.now(),
      },
    ];

    const view = GameViewBuilder.buildView(runtime, 'god');
    assert.equal(view.visibleEvents.length, 3);
    // God sees all roles
    const p1View = view.seats.find((s) => s.seatId === 'P1');
    assert.equal(p1View.role, 'wolf');
    assert.equal(p1View.faction, 'wolf');
  });

  it('wolf player sees faction mates roles', () => {
    const runtime = createTestRuntime();
    // Add a second wolf for testing
    runtime.seats.push({ seatId: 'P4', actorType: 'cat', actorId: 'codex', role: 'wolf', alive: true, properties: {} });

    const view = GameViewBuilder.buildView(runtime, 'P1');
    // P1 (wolf) should see P4's role as wolf
    const p4View = view.seats.find((s) => s.seatId === 'P4');
    assert.equal(p4View.role, 'wolf');
    assert.equal(p4View.faction, 'wolf');
    // But should NOT see seer's role
    const p2View = view.seats.find((s) => s.seatId === 'P2');
    assert.equal(p2View.role, undefined);
  });
});
