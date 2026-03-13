/**
 * Mode Routes Tests (F11)
 *
 * POST   /api/threads/:threadId/mode         — start a mode
 * GET    /api/threads/:threadId/mode         — get current mode
 * DELETE /api/threads/:threadId/mode         — end current mode
 * GET    /api/threads/:threadId/mode/history — mode history
 */

import './helpers/setup-cat-registry.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { ModeStore } from '../dist/domains/cats/services/stores/ports/ModeStore.js';
import { modesRoutes } from '../dist/routes/modes.js';

/** Auth header helper — thread-1 is createdBy 'user-1' */
const AUTH = { 'x-cat-cafe-user': 'user-1' };

function createMockSocketManager() {
  const events = [];
  return {
    broadcastAgentMessage() {},
    broadcastToRoom(room, event, data) {
      events.push({ room, event, data });
    },
    getEvents() {
      return events;
    },
  };
}

function createMockThreadStore() {
  const threads = {};
  return {
    create(userId, title) {
      const id = `thread-${Date.now()}`;
      threads[id] = { id, title, createdBy: userId, participants: [], lastActiveAt: Date.now(), createdAt: Date.now() };
      return threads[id];
    },
    get(id) {
      return threads[id] ?? null;
    },
    _seedThread(id, data) {
      threads[id] = {
        id,
        projectPath: data.projectPath ?? 'default',
        title: data.title ?? null,
        createdBy: data.createdBy ?? 'user-1',
        participants: data.participants ?? [],
        lastActiveAt: Date.now(),
        createdAt: Date.now(),
      };
    },
  };
}

async function buildApp() {
  const app = Fastify();
  const modeStore = new ModeStore();
  const socketManager = createMockSocketManager();
  const threadStore = createMockThreadStore();

  threadStore._seedThread('thread-1', { title: '测试对话', createdBy: 'user-1' });

  await app.register(modesRoutes, { modeStore, threadStore, socketManager });
  await app.ready();
  return { app, modeStore, socketManager, threadStore };
}

describe('Mode Routes', () => {
  // ── POST /api/threads/:threadId/mode ──

  describe('POST /api/threads/:threadId/mode', () => {
    it('starts a brainstorm mode', async () => {
      const { app, socketManager } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'brainstorm',
          config: { topic: '如何改善猫咖体验', participants: ['opus', 'codex'] },
        },
      });

      assert.equal(res.statusCode, 201);
      const body = JSON.parse(res.body);
      assert.equal(body.record.name, 'brainstorm');
      assert.equal(body.record.config.topic, '如何改善猫咖体验');
      assert.deepEqual(body.record.config.participants, ['opus', 'codex']);
      assert.equal(body.state.roundOneComplete, false);
      assert.equal(body.state.currentRound, 1);

      // Socket event
      const events = socketManager.getEvents();
      assert.equal(events.length, 1);
      assert.equal(events[0].event, 'mode_changed');
      assert.equal(events[0].data.action, 'started');

      await app.close();
    });

    it('starts a debate mode', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'debate',
          config: { topic: 'Redis vs 内存存储', catA: 'opus', catB: 'codex', rounds: 3 },
        },
      });

      assert.equal(res.statusCode, 201);
      const body = JSON.parse(res.body);
      assert.equal(body.record.name, 'debate');
      assert.equal(body.record.config.catA, 'opus');
      assert.equal(body.record.config.catB, 'codex');
      assert.equal(body.record.config.rounds, 3);
      assert.equal(body.state.currentRound, 1);

      await app.close();
    });

    it('returns 404 for non-existent thread', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/no-such-thread/mode',
        headers: AUTH,
        payload: {
          name: 'brainstorm',
          config: { topic: 'test', participants: ['opus'] },
        },
      });

      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.equal(body.code, 'THREAD_NOT_FOUND');

      await app.close();
    });

    it('returns 403 when user is not thread owner (R2 P2)', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: { 'x-cat-cafe-user': 'other-user' },
        payload: {
          name: 'brainstorm',
          config: { topic: 'test', participants: ['opus'] },
        },
      });

      assert.equal(res.statusCode, 403);
      const body = JSON.parse(res.body);
      assert.equal(body.code, 'FORBIDDEN');

      await app.close();
    });

    it('returns 400 for invalid mode name', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'invalid-mode',
          config: { topic: 'test' },
        },
      });

      assert.equal(res.statusCode, 400);

      await app.close();
    });

    it('returns 400 for invalid brainstorm config (missing participants)', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'brainstorm',
          config: { topic: 'test' },
        },
      });

      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('brainstorm'));

      await app.close();
    });

    it('returns 400 for invalid debate config (missing catA)', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'debate',
          config: { topic: 'test', catB: 'codex' },
        },
      });

      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('debate'));

      await app.close();
    });

    it('returns 400 for invalid catId in brainstorm participants (P2-4)', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'brainstorm',
          config: { topic: 'test', participants: ['opus', 'not-a-cat'] },
        },
      });

      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('brainstorm'));

      await app.close();
    });

    it('returns 400 for invalid catId in debate config (P2-4)', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'debate',
          config: { topic: 'test', catA: 'opus', catB: 'invalid-cat' },
        },
      });

      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('debate'));

      await app.close();
    });

    it('returns 400 when catA equals catB in debate (P2-4)', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'debate',
          config: { topic: 'test', catA: 'opus', catB: 'opus' },
        },
      });

      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.ok(body.error.includes('debate'));

      await app.close();
    });

    it('extracts triggeredBy from auth header (P2-5)', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'brainstorm',
          config: { topic: '验证身份', participants: ['opus'] },
        },
      });

      assert.equal(res.statusCode, 201);
      const body = JSON.parse(res.body);
      assert.equal(body.record.triggeredBy, 'user-1');

      await app.close();
    });

    it('auto-ends previous mode when starting a new one', async () => {
      const { app, modeStore } = await buildApp();

      // Start first mode
      await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'brainstorm',
          config: { topic: '第一次头脑风暴', participants: ['opus'] },
        },
      });

      // Start second mode (should auto-end first)
      const res = await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'debate',
          config: { topic: '辩论', catA: 'opus', catB: 'codex' },
        },
      });

      assert.equal(res.statusCode, 201);
      const body = JSON.parse(res.body);
      assert.equal(body.record.name, 'debate');

      // History should contain the ended brainstorm
      const history = modeStore.getModeHistory('thread-1');
      assert.equal(history.length, 2); // ended brainstorm + active debate
      assert.equal(history[0].name, 'brainstorm');
      assert.ok(history[0].endedAt);

      await app.close();
    });
  });

  // ── GET /api/threads/:threadId/mode ──

  describe('GET /api/threads/:threadId/mode', () => {
    it('returns null when no active mode', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.mode, null);

      await app.close();
    });

    it('returns active mode after starting one', async () => {
      const { app } = await buildApp();

      await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'brainstorm',
          config: { topic: '测试', participants: ['opus', 'gemini'] },
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.mode.record.name, 'brainstorm');
      assert.deepEqual(body.mode.record.config.participants, ['opus', 'gemini']);

      await app.close();
    });

    it('returns 403 when non-owner reads mode', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/threads/thread-1/mode',
        headers: { 'x-cat-cafe-user': 'other-user' },
      });

      assert.equal(res.statusCode, 403);
      const body = JSON.parse(res.body);
      assert.equal(body.code, 'FORBIDDEN');

      await app.close();
    });

    it('returns 404 for nonexistent thread', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/threads/nonexistent/mode',
        headers: AUTH,
      });

      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.equal(body.code, 'THREAD_NOT_FOUND');

      await app.close();
    });
  });

  // ── DELETE /api/threads/:threadId/mode ──

  describe('DELETE /api/threads/:threadId/mode', () => {
    it('returns 404 when no active mode', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
      });

      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.equal(body.code, 'NO_ACTIVE_MODE');

      await app.close();
    });

    it('returns 403 when non-owner tries to end mode (R2 P2)', async () => {
      const { app } = await buildApp();

      // Owner starts mode
      await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'brainstorm',
          config: { topic: '测试', participants: ['opus'] },
        },
      });

      // Other user tries to end
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/threads/thread-1/mode',
        headers: { 'x-cat-cafe-user': 'other-user' },
      });

      assert.equal(res.statusCode, 403);
      const body = JSON.parse(res.body);
      assert.equal(body.code, 'FORBIDDEN');

      await app.close();
    });

    it('ends an active mode', async () => {
      const { app, socketManager } = await buildApp();

      // Start mode
      await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'brainstorm',
          config: { topic: '测试', participants: ['opus'] },
        },
      });

      // End mode
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: { outcome: '达成共识' },
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ended.name, 'brainstorm');
      assert.equal(body.ended.outcome, '达成共识');
      assert.ok(body.ended.endedAt);

      // Socket events: started + ended
      const events = socketManager.getEvents();
      assert.equal(events.length, 2);
      assert.equal(events[1].event, 'mode_changed');
      assert.equal(events[1].data.action, 'ended');
      assert.equal(events[1].data.mode, null);

      await app.close();
    });

    it('ends mode without outcome', async () => {
      const { app } = await buildApp();

      await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'debate',
          config: { topic: '测试', catA: 'opus', catB: 'codex' },
        },
      });

      const res = await app.inject({
        method: 'DELETE',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ended.name, 'debate');
      assert.equal(body.ended.outcome, undefined);

      await app.close();
    });
  });

  // ── GET /api/threads/:threadId/mode/history ──

  describe('GET /api/threads/:threadId/mode/history', () => {
    it('returns empty history for fresh thread', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/threads/thread-1/mode/history',
        headers: AUTH,
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.deepEqual(body.history, []);

      await app.close();
    });

    it('tracks mode lifecycle in history', async () => {
      const { app } = await buildApp();

      // Start and end brainstorm
      await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'brainstorm',
          config: { topic: '第一次', participants: ['opus'] },
        },
      });
      await app.inject({
        method: 'DELETE',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: { outcome: '结论A' },
      });

      // Start debate (still active)
      await app.inject({
        method: 'POST',
        url: '/api/threads/thread-1/mode',
        headers: AUTH,
        payload: {
          name: 'debate',
          config: { topic: '第二次', catA: 'opus', catB: 'codex' },
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/threads/thread-1/mode/history',
        headers: AUTH,
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.history.length, 2);
      assert.equal(body.history[0].name, 'brainstorm');
      assert.equal(body.history[0].outcome, '结论A');
      assert.ok(body.history[0].endedAt);
      assert.equal(body.history[1].name, 'debate');

      await app.close();
    });

    it('returns 403 when non-owner reads history', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/threads/thread-1/mode/history',
        headers: { 'x-cat-cafe-user': 'other-user' },
      });

      assert.equal(res.statusCode, 403);
      const body = JSON.parse(res.body);
      assert.equal(body.code, 'FORBIDDEN');

      await app.close();
    });

    it('returns 404 for nonexistent thread history', async () => {
      const { app } = await buildApp();

      const res = await app.inject({
        method: 'GET',
        url: '/api/threads/nonexistent/mode/history',
        headers: AUTH,
      });

      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.equal(body.code, 'THREAD_NOT_FOUND');

      await app.close();
    });
  });
});

// ── ModeStore unit tests ──

describe('ModeStore', () => {
  it('getMode returns null for unknown thread', () => {
    const store = new ModeStore();
    assert.equal(store.getMode('unknown'), null);
  });

  it('startMode + getMode round-trip', () => {
    const store = new ModeStore();
    const mode = store.startMode('t1', 'brainstorm', { topic: 'test', participants: ['opus'] }, 'user-1', {
      roundOneComplete: false,
      currentRound: 1,
    });
    assert.equal(mode.record.name, 'brainstorm');
    assert.equal(store.getMode('t1').record.name, 'brainstorm');
  });

  it('updateState mutates active mode', () => {
    const store = new ModeStore();
    store.startMode('t1', 'brainstorm', { topic: 'test', participants: ['opus'] }, 'user-1', {
      roundOneComplete: false,
      currentRound: 1,
    });
    store.updateState('t1', { roundOneComplete: true, currentRound: 2 });
    assert.equal(store.getMode('t1').state.roundOneComplete, true);
    assert.equal(store.getMode('t1').state.currentRound, 2);
  });

  it('endMode removes active and adds to history', () => {
    const store = new ModeStore();
    store.startMode('t1', 'brainstorm', { topic: 'test', participants: ['opus'] }, 'user-1', {
      roundOneComplete: false,
      currentRound: 1,
    });
    const ended = store.endMode('t1', '完成');
    assert.equal(ended.name, 'brainstorm');
    assert.equal(ended.outcome, '完成');
    assert.ok(ended.endedAt);
    assert.equal(store.getMode('t1'), null);
    assert.equal(store.getModeHistory('t1').length, 1);
  });

  it('endMode returns null when no active mode', () => {
    const store = new ModeStore();
    assert.equal(store.endMode('t1'), null);
  });
});

// ── Dev-Loop Route Tests ──

describe('POST /mode dev-loop', () => {
  it('starts a dev-loop mode with valid config', async () => {
    const { app, socketManager } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/threads/thread-1/mode',
      headers: AUTH,
      payload: {
        name: 'dev-loop',
        config: { requirement: '实现登录功能', leadCat: 'opus', reviewCat: 'codex' },
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.record.name, 'dev-loop');
    assert.equal(body.record.config.requirement, '实现登录功能');
    assert.equal(body.state.phase, 'developing');
    assert.equal(body.state.iteration, 0);

    const events = socketManager.getEvents();
    assert.ok(events.some((e) => e.data.action === 'started'));
  });

  it('rejects dev-loop with leadCat === reviewCat', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/threads/thread-1/mode',
      headers: AUTH,
      payload: {
        name: 'dev-loop',
        config: { requirement: '测试', leadCat: 'opus', reviewCat: 'opus' },
      },
    });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.error.includes('dev-loop'));
  });

  it('rejects dev-loop with invalid cat ID', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/threads/thread-1/mode',
      headers: AUTH,
      payload: {
        name: 'dev-loop',
        config: { requirement: '测试', leadCat: 'invalid-cat', reviewCat: 'codex' },
      },
    });

    assert.equal(res.statusCode, 400);
  });

  it('rejects dev-loop with empty requirement', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/threads/thread-1/mode',
      headers: AUTH,
      payload: {
        name: 'dev-loop',
        config: { requirement: '', leadCat: 'opus', reviewCat: 'codex' },
      },
    });

    assert.equal(res.statusCode, 400);
  });

  it('accepts dev-loop with optional maxIterations', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/threads/thread-1/mode',
      headers: AUTH,
      payload: {
        name: 'dev-loop',
        config: { requirement: '测试', leadCat: 'opus', reviewCat: 'codex', maxIterations: 3 },
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.record.config.maxIterations, 3);
  });
});
