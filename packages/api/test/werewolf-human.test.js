/**
 * Human Player Integration Tests (F101 Task B6)
 *
 * Tests player-mode scoped views, god-view full access,
 * and action submission restrictions.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import Fastify from 'fastify';
import { gameRoutes } from '../dist/routes/games.js';

function createStubStore() {
  const games = new Map();
  const activeByThread = new Map();
  return {
    async createGame(runtime) {
      games.set(runtime.gameId, structuredClone(runtime));
      activeByThread.set(runtime.threadId, runtime.gameId);
      return structuredClone(runtime);
    },
    async getGame(gameId) {
      const g = games.get(gameId);
      return g ? structuredClone(g) : null;
    },
    async getActiveGame(threadId) {
      const id = activeByThread.get(threadId);
      if (!id) return null;
      return this.getGame(id);
    },
    async updateGame(gameId, runtime) {
      games.set(gameId, structuredClone(runtime));
    },
    async endGame(gameId, winner) {
      const g = games.get(gameId);
      if (g) {
        g.status = 'finished';
        g.winner = winner;
        activeByThread.delete(g.threadId);
      }
    },
  };
}

function createStubSocket() {
  return { broadcastToRoom() {}, emitToUser() {} };
}

function make4pRuntime(threadId, humanRole = 'player') {
  return {
    gameId: `game-${threadId}`,
    threadId,
    gameType: 'werewolf',
    definition: {
      gameType: 'werewolf',
      displayName: 'Werewolf',
      minPlayers: 4,
      maxPlayers: 4,
      roles: [
        { name: 'wolf', faction: 'wolf', description: 'Kills' },
        { name: 'villager', faction: 'village', description: 'Votes' },
        { name: 'seer', faction: 'village', description: 'Divines' },
      ],
      phases: [
        { name: 'night_wolf', type: 'night_action', actingRole: 'wolf', timeoutMs: 30000, autoAdvance: true },
        { name: 'day_vote', type: 'day_vote', actingRole: '*', timeoutMs: 60000, autoAdvance: true },
      ],
      actions: [
        { name: 'kill', allowedRole: 'wolf', allowedPhase: 'night_wolf', targetRequired: true, schema: {} },
        { name: 'vote', allowedRole: '*', allowedPhase: 'day_vote', targetRequired: true, schema: {} },
      ],
      winConditions: [],
    },
    seats: [
      { seatId: 'P1', actorType: 'cat', actorId: 'opus', role: 'wolf', alive: true, properties: {} },
      { seatId: 'P2', actorType: 'human', actorId: 'alice', role: 'villager', alive: true, properties: {} },
      { seatId: 'P3', actorType: 'cat', actorId: 'codex', role: 'seer', alive: true, properties: {} },
      { seatId: 'P4', actorType: 'cat', actorId: 'gemini', role: 'villager', alive: true, properties: {} },
    ],
    currentPhase: 'day_vote',
    round: 1,
    eventLog: [
      {
        eventId: 'e1',
        round: 1,
        phase: 'night_wolf',
        type: 'wolf_kill',
        scope: 'faction:wolf',
        payload: { target: 'P4' },
        timestamp: Date.now(),
      },
      {
        eventId: 'e2',
        round: 1,
        phase: 'day_vote',
        type: 'announcement',
        scope: 'public',
        payload: { message: 'Day begins' },
        timestamp: Date.now(),
      },
    ],
    pendingActions: {},
    status: 'playing',
    config: { timeoutMs: 30000, voiceMode: false, humanRole, humanSeat: 'P2' },
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('Human Player Integration', () => {
  let app;
  let store;

  beforeEach(async () => {
    store = createStubStore();
    app = Fastify();
    await app.register(gameRoutes, { gameStore: store, socketManager: createStubSocket() });
    await app.ready();
  });

  it('player-mode GET with viewer param → scoped view (no wolf events)', async () => {
    const runtime = make4pRuntime('thread-human-1', 'player');
    await store.createGame(runtime);

    const res = await app.inject({
      method: 'GET',
      url: '/api/threads/thread-human-1/game?viewer=P2',
    });

    assert.equal(res.statusCode, 200);
    const view = JSON.parse(res.payload);

    // P2 is villager — should NOT see wolf_kill event
    const wolfEvent = view.visibleEvents.find((e) => e.type === 'wolf_kill');
    assert.equal(wolfEvent, undefined, 'Villager must not see wolf events');

    // Should see public event
    const publicEvent = view.visibleEvents.find((e) => e.type === 'announcement');
    assert.ok(publicEvent, 'Villager should see public events');

    // P2 should see own role but not wolf role
    const self = view.seats.find((s) => s.seatId === 'P2');
    assert.equal(self.role, 'villager');
    const wolf = view.seats.find((s) => s.seatId === 'P1');
    assert.equal(wolf.role, undefined, 'Villager should not see wolf role');
  });

  it('god-view GET → full view (all events, all roles)', async () => {
    const runtime = make4pRuntime('thread-god-1', 'god-view');
    await store.createGame(runtime);

    const res = await app.inject({
      method: 'GET',
      url: '/api/threads/thread-god-1/game?viewer=god',
    });

    assert.equal(res.statusCode, 200);
    const view = JSON.parse(res.payload);

    assert.equal(view.visibleEvents.length, 2, 'God sees all events');
    const wolfSeat = view.seats.find((s) => s.seatId === 'P1');
    assert.equal(wolfSeat.role, 'wolf', 'God sees wolf role');
  });

  it('player-mode GET without viewer param → scoped to humanSeat (no god leak)', async () => {
    const runtime = make4pRuntime('thread-noviewer', 'player');
    await store.createGame(runtime);

    const res = await app.inject({
      method: 'GET',
      url: '/api/threads/thread-noviewer/game',
    });

    assert.equal(res.statusCode, 200);
    const view = JSON.parse(res.payload);
    // P2 (humanSeat) is villager — should NOT see wolf_kill (only public announcement)
    assert.equal(view.visibleEvents.length, 1, 'player-mode default must NOT return god view');
    const wolfEvent = view.visibleEvents.find((e) => e.type === 'wolf_kill');
    assert.equal(wolfEvent, undefined, 'player-mode must not leak faction events');
  });

  it('player-mode GET with viewer=god → rejected (403)', async () => {
    const runtime = make4pRuntime('thread-godtrick', 'player');
    await store.createGame(runtime);

    const res = await app.inject({
      method: 'GET',
      url: '/api/threads/thread-godtrick/game?viewer=god',
    });

    assert.equal(res.statusCode, 403, 'player-mode must not allow viewer=god');
  });

  it('player-mode GET with viewer=P1 (not own seat) → rejected (403)', async () => {
    const runtime = make4pRuntime('thread-snoop', 'player');
    await store.createGame(runtime);

    // humanSeat is P2, trying to view as P1 (wolf)
    const res = await app.inject({
      method: 'GET',
      url: '/api/threads/thread-snoop/game?viewer=P1',
    });

    assert.equal(res.statusCode, 403, 'player-mode must not allow viewing other seats');
  });

  it('player-mode GET without humanSeat → 400 (no god fallback)', async () => {
    // Manually create a runtime with humanRole='player' but NO humanSeat
    const runtime = make4pRuntime('thread-noseat', 'player');
    delete runtime.config.humanSeat;
    await store.createGame(runtime);

    const res = await app.inject({
      method: 'GET',
      url: '/api/threads/thread-noseat/game',
    });

    assert.equal(res.statusCode, 400, 'player mode without humanSeat must not fall back to god');
    const body = JSON.parse(res.payload);
    assert.ok(body.error.includes('humanSeat'), 'error should mention humanSeat');
  });

  it('POST start game: player mode without humanSeat → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/threads/thread-noseat-start/game',
      payload: {
        definition: {
          gameType: 'werewolf',
          displayName: 'Werewolf',
          minPlayers: 2,
          maxPlayers: 4,
          roles: [{ name: 'wolf', faction: 'wolf', description: 'Kills' }],
          phases: [
            { name: 'night_wolf', type: 'night_action', actingRole: 'wolf', timeoutMs: 30000, autoAdvance: true },
          ],
          actions: [
            { name: 'kill', allowedRole: 'wolf', allowedPhase: 'night_wolf', targetRequired: true, schema: {} },
          ],
          winConditions: [],
        },
        seats: [
          { seatId: 'P1', actorType: 'cat', actorId: 'opus', role: 'wolf', alive: true, properties: {} },
          { seatId: 'P2', actorType: 'human', actorId: 'alice', role: 'wolf', alive: true, properties: {} },
        ],
        config: { timeoutMs: 30000, voiceMode: false, humanRole: 'player' },
      },
    });

    assert.equal(res.statusCode, 400, 'player mode without humanSeat should be rejected at start');
  });

  it('player-mode: human can submit valid action', async () => {
    const runtime = make4pRuntime('thread-action-1', 'player');
    await store.createGame(runtime);

    const res = await app.inject({
      method: 'POST',
      url: '/api/threads/thread-action-1/game/action',
      payload: { seatId: 'P2', actionName: 'vote', targetSeat: 'P1' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.ok, true);
  });

  it('god-view: cannot submit actions (403)', async () => {
    const runtime = make4pRuntime('thread-godaction', 'god-view');
    await store.createGame(runtime);

    const res = await app.inject({
      method: 'POST',
      url: '/api/threads/thread-godaction/game/action',
      payload: { seatId: 'P2', actionName: 'vote', targetSeat: 'P1' },
    });

    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.payload);
    assert.ok(body.error.includes('god-view'));
  });
});
