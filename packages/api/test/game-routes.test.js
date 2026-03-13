/**
 * Game API Routes Tests (F101 Task A6)
 *
 * Tests HTTP endpoints for game lifecycle:
 * POST /api/threads/:threadId/game       — Start game
 * GET  /api/threads/:threadId/game       — Get current game view
 * POST /api/threads/:threadId/game/action — Submit action
 * DELETE /api/threads/:threadId/game     — Abort game
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Fastify from 'fastify';
import { gameRoutes } from '../dist/routes/games.js';

/** In-memory GameStore stub */
function createStubGameStore() {
  const games = new Map();
  const activeByThread = new Map();
  return {
    async createGame(runtime) {
      if (activeByThread.has(runtime.threadId)) {
        throw new Error(`Thread ${runtime.threadId} already has an active game`);
      }
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
  return {
    broadcastToRoom() {},
    emitToUser() {},
  };
}

function makeDefinition() {
  return {
    gameType: 'werewolf',
    displayName: 'Werewolf',
    minPlayers: 2,
    maxPlayers: 8,
    roles: [
      { name: 'wolf', faction: 'wolf', description: 'Kills at night' },
      { name: 'villager', faction: 'village', description: 'Votes by day' },
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
  };
}

describe('Game API Routes', () => {
  let app;
  let gameStore;

  before(async () => {
    gameStore = createStubGameStore();
    const socketManager = createStubSocket();

    app = Fastify();
    await app.register(gameRoutes, { gameStore, socketManager });
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  describe('POST /api/threads/:threadId/game', () => {
    it('starts a game and returns runtime', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/thread-route-1/game',
        payload: {
          definition: makeDefinition(),
          seats: [
            { seatId: 'P1', actorType: 'cat', actorId: 'opus', role: 'wolf', alive: true, properties: {} },
            { seatId: 'P2', actorType: 'human', actorId: 'owner', role: 'villager', alive: true, properties: {} },
          ],
          config: { timeoutMs: 30000, voiceMode: false, humanRole: 'player', humanSeat: 'P2' },
        },
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.threadId, 'thread-route-1');
      assert.equal(body.status, 'playing');
      assert.ok(body.gameId);
    });

    it('rejects if thread already has active game', async () => {
      // thread-route-1 already has a game from above test
      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/thread-route-1/game',
        payload: {
          definition: makeDefinition(),
          seats: [{ seatId: 'P1', actorType: 'cat', actorId: 'opus', role: 'wolf', alive: true, properties: {} }],
          config: { timeoutMs: 30000, voiceMode: false, humanRole: 'player', humanSeat: 'P2' },
        },
      });

      assert.equal(res.statusCode, 409);
    });
  });

  describe('GET /api/threads/:threadId/game', () => {
    it('returns current game view', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/threads/thread-route-1/game',
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.threadId, 'thread-route-1');
      assert.equal(body.status, 'playing');
    });

    it('returns 404 if no active game', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/threads/nonexistent/game',
      });

      assert.equal(res.statusCode, 404);
    });
  });

  describe('POST /api/threads/:threadId/game/action', () => {
    it('rejects invalid payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/thread-route-1/game/action',
        payload: { bad: 'data' },
      });

      assert.equal(res.statusCode, 400);
    });

    it('rejects action when seatId does not match humanSeat (P0-3)', async () => {
      // Start a game with humanSeat = P2
      await app.inject({
        method: 'POST',
        url: '/api/threads/thread-route-auth/game',
        payload: {
          definition: makeDefinition(),
          seats: [
            { seatId: 'P1', actorType: 'cat', actorId: 'opus', role: 'wolf', alive: true, properties: {} },
            { seatId: 'P2', actorType: 'human', actorId: 'owner', role: 'villager', alive: true, properties: {} },
          ],
          config: { timeoutMs: 30000, voiceMode: false, humanRole: 'player', humanSeat: 'P2' },
        },
      });

      // Try to submit an action as P1 (which is a cat seat, not the human's seat)
      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/thread-route-auth/game/action',
        payload: {
          seatId: 'P1',
          actionName: 'vote',
          targetSeat: 'P2',
        },
      });

      assert.equal(res.statusCode, 403, 'should reject action from non-humanSeat');
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('seat'), 'error should mention seat mismatch');
    });
  });

  describe('DELETE /api/threads/:threadId/game', () => {
    it('aborts the active game', async () => {
      // Start a fresh game on a new thread
      await app.inject({
        method: 'POST',
        url: '/api/threads/thread-route-del/game',
        payload: {
          definition: makeDefinition(),
          seats: [{ seatId: 'P1', actorType: 'cat', actorId: 'opus', role: 'wolf', alive: true, properties: {} }],
          config: { timeoutMs: 30000, voiceMode: false, humanRole: 'player', humanSeat: 'P2' },
        },
      });

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/threads/thread-route-del/game',
      });

      assert.equal(res.statusCode, 200);

      // Should no longer have active game
      const getRes = await app.inject({
        method: 'GET',
        url: '/api/threads/thread-route-del/game',
      });
      assert.equal(getRes.statusCode, 404);
    });

    it('returns 404 if no active game to abort', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/threads/no-game/game',
      });

      assert.equal(res.statusCode, 404);
    });
  });
});
