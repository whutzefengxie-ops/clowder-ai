/**
 * Multi-Mention Callback Route Tests (F086 M1)
 *
 * Tests POST /api/callbacks/multi-mention and GET /api/callbacks/multi-mention-status
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { CAT_CONFIGS, catRegistry } from '@cat-cafe/shared';
import Fastify from 'fastify';
import { resetMultiMentionOrchestrator } from '../dist/routes/callback-multi-mention-routes.js';

// Bootstrap catRegistry from CAT_CONFIGS (same as server startup)
for (const [id, config] of Object.entries(CAT_CONFIGS)) {
  if (!catRegistry.has(id)) catRegistry.register(id, config);
}

// ── Mocks ──────────────────────────────────────────────────────────────

function createMockRegistry() {
  const records = new Map();
  return {
    register(catId, threadId, userId) {
      const id = `inv-${records.size}`;
      const token = `tok-${records.size}`;
      records.set(id, { catId, threadId, userId, invocationId: id, callbackToken: token });
      return { invocationId: id, callbackToken: token };
    },
    verify(invocationId, callbackToken) {
      const r = records.get(invocationId);
      if (!r || r.callbackToken !== callbackToken) return null;
      return r;
    },
    isLatest() {
      return true;
    },
    claimClientMessageId() {
      return true;
    },
  };
}

function createMockSocketManager() {
  const messages = [];
  const roomEvents = [];
  return {
    broadcastAgentMessage(msg, threadId) {
      messages.push({ ...msg, threadId });
    },
    broadcastToRoom(room, event, data) {
      roomEvents.push({ room, event, data });
    },
    getMessages() {
      return messages;
    },
    getRoomEvents() {
      return roomEvents;
    },
  };
}

function createMockMessageStore() {
  const messages = [];
  return {
    append(msg) {
      const stored = { id: `msg-${messages.length}`, ...msg };
      messages.push(stored);
      return stored;
    },
    getMessages() {
      return messages;
    },
  };
}

function createMockInvocationRecordStore() {
  let counter = 0;
  const created = [];
  return {
    create(input) {
      const id = `inv-mm-${counter++}`;
      created.push({ id, ...input });
      return { outcome: 'created', invocationId: id };
    },
    update() {},
    getCreated() {
      return created;
    },
  };
}

function createMockRouter(responses = {}) {
  const executions = [];
  return {
    async *routeExecution(userId, message, threadId, _invId, targetCats, _intent, _opts) {
      executions.push({ userId, message, threadId, targetCats });
      const catId = targetCats[0];
      const text = responses[catId] ?? `Response from ${catId}`;
      yield { type: 'text', catId, content: text, timestamp: Date.now() };
      yield { type: 'done', catId, isFinal: true, timestamp: Date.now() };
    },
    getExecutions() {
      return executions;
    },
  };
}

// ── Test setup ─────────────────────────────────────────────────────────

describe('Multi-Mention Routes', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;
  let mockRegistry;
  let mockSocket;
  let mockMessageStore;
  let mockInvocationRecordStore;
  let mockRouter;
  let creds;

  beforeEach(async () => {
    resetMultiMentionOrchestrator();

    mockRegistry = createMockRegistry();
    mockSocket = createMockSocketManager();
    mockMessageStore = createMockMessageStore();
    mockInvocationRecordStore = createMockInvocationRecordStore();
    mockRouter = createMockRouter({ codex: 'Codex says hello', gemini: 'Gemini says hi' });

    // Register a caller invocation (opus calling)
    creds = mockRegistry.register('opus', 'thread-1', 'user-1');

    app = Fastify({ logger: false });

    const { registerMultiMentionRoutes } = await import('../dist/routes/callback-multi-mention-routes.js');

    registerMultiMentionRoutes(app, {
      registry: mockRegistry,
      messageStore: mockMessageStore,
      socketManager: mockSocket,
      router: mockRouter,
      invocationRecordStore: mockInvocationRecordStore,
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── POST /api/callbacks/multi-mention ──────────────────────────────

  test('creates multi-mention request and returns requestId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/callbacks/multi-mention',
      payload: {
        invocationId: creds.invocationId,
        callbackToken: creds.callbackToken,
        targets: ['codex'],
        question: 'What do you think?',
        callbackTo: 'opus',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.requestId);
    assert.equal(body.status, 'running');
  });

  test('rejects invalid callback credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/callbacks/multi-mention',
      payload: {
        invocationId: 'fake',
        callbackToken: 'fake',
        targets: ['codex'],
        question: 'test',
        callbackTo: 'opus',
      },
    });

    assert.equal(res.statusCode, 401);
  });

  test('rejects unknown target cat', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/callbacks/multi-mention',
      payload: {
        invocationId: creds.invocationId,
        callbackToken: creds.callbackToken,
        targets: ['nonexistent-cat'],
        question: 'test',
        callbackTo: 'opus',
      },
    });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.error.includes('Unknown cat'));
  });

  test('rejects unknown callbackTo cat', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/callbacks/multi-mention',
      payload: {
        invocationId: creds.invocationId,
        callbackToken: creds.callbackToken,
        targets: ['codex'],
        question: 'test',
        callbackTo: 'nonexistent-cat',
      },
    });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.error.includes('callbackTo'));
  });

  test('dispatches to all targets', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/callbacks/multi-mention',
      payload: {
        invocationId: creds.invocationId,
        callbackToken: creds.callbackToken,
        targets: ['codex', 'gemini'],
        question: 'Review this design',
        callbackTo: 'opus',
      },
    });

    // Wait for async dispatch to complete
    await new Promise((r) => setTimeout(r, 100));

    // Should have dispatched to both targets
    const executions = mockRouter.getExecutions();
    assert.equal(executions.length, 2);
    assert.ok(executions.some((e) => e.targetCats[0] === 'codex'));
    assert.ok(executions.some((e) => e.targetCats[0] === 'gemini'));
  });

  test('includes multi-mention prefix in dispatched message', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/callbacks/multi-mention',
      payload: {
        invocationId: creds.invocationId,
        callbackToken: creds.callbackToken,
        targets: ['codex'],
        question: 'What is your opinion?',
        callbackTo: 'opus',
      },
    });

    await new Promise((r) => setTimeout(r, 100));

    const executions = mockRouter.getExecutions();
    assert.equal(executions.length, 1);
    assert.ok(executions[0].message.includes('[Multi-Mention from opus]'));
    assert.ok(executions[0].message.includes('What is your opinion?'));
  });

  test('uses default timeout when not specified', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/callbacks/multi-mention',
      payload: {
        invocationId: creds.invocationId,
        callbackToken: creds.callbackToken,
        targets: ['codex'],
        question: 'test',
        callbackTo: 'opus',
      },
    });

    assert.equal(res.statusCode, 200);
  });

  test('accepts optional fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/callbacks/multi-mention',
      payload: {
        invocationId: creds.invocationId,
        callbackToken: creds.callbackToken,
        targets: ['codex'],
        question: 'test',
        callbackTo: 'opus',
        context: 'Some context',
        idempotencyKey: 'key-1',
        timeoutMinutes: 10,
        triggerType: 'design_review',
        searchEvidenceRefs: ['ref-1'],
      },
    });

    assert.equal(res.statusCode, 200);
  });

  // ── GET /api/callbacks/multi-mention-status ────────────────────────

  test('returns status for existing request', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/callbacks/multi-mention',
      payload: {
        invocationId: creds.invocationId,
        callbackToken: creds.callbackToken,
        targets: ['codex'],
        question: 'test',
        callbackTo: 'opus',
      },
    });

    const { requestId } = JSON.parse(createRes.body);

    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/callbacks/multi-mention-status',
      query: {
        invocationId: creds.invocationId,
        callbackToken: creds.callbackToken,
        requestId,
      },
    });

    assert.equal(statusRes.statusCode, 200);
    const body = JSON.parse(statusRes.body);
    assert.equal(body.requestId, requestId);
    assert.ok(['running', 'partial', 'done'].includes(body.status));
  });

  test('returns 404 for unknown requestId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/callbacks/multi-mention-status',
      query: {
        invocationId: creds.invocationId,
        callbackToken: creds.callbackToken,
        requestId: 'nonexistent',
      },
    });

    assert.equal(res.statusCode, 404);
  });

  test('rejects status query with invalid credentials', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/callbacks/multi-mention-status',
      query: {
        invocationId: 'fake',
        callbackToken: 'fake',
        requestId: 'any',
      },
    });

    assert.equal(res.statusCode, 401);
  });

  // ── Result aggregation ────────────────────────────────────────────

  test('flushes aggregated result when all targets respond', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/callbacks/multi-mention',
      payload: {
        invocationId: creds.invocationId,
        callbackToken: creds.callbackToken,
        targets: ['codex'],
        question: 'Quick question',
        callbackTo: 'opus',
      },
    });

    // Wait for dispatch + flush
    await new Promise((r) => setTimeout(r, 200));

    // Should have stored the aggregated result
    const stored = mockMessageStore.getMessages();
    assert.ok(stored.length > 0);

    const resultMsg = stored.find((m) => m.content.includes('Multi-Mention 结果汇总'));
    assert.ok(resultMsg, 'Should have stored aggregated result message');
    assert.ok(resultMsg.content.includes('Quick question'));

    // Should have broadcast via connector_message
    const roomEvents = mockSocket.getRoomEvents();
    const connectorEvent = roomEvents.find((e) => e.event === 'connector_message');
    assert.ok(connectorEvent, 'Should have broadcast connector_message');
  });

  // ── Anti-cascade ──────────────────────────────────────────────────

  test('rejects multi-mention from active target cat (anti-cascade)', async () => {
    // Manually set up orchestrator state: opus created a multi-mention targeting codex
    const { getMultiMentionOrchestrator } = await import('../dist/routes/callback-multi-mention-routes.js');
    const orch = getMultiMentionOrchestrator();
    const { createCatId } = await import('@cat-cafe/shared');
    const req = orch.create({
      threadId: 'thread-1',
      initiator: createCatId('opus'),
      callbackTo: createCatId('opus'),
      targets: [createCatId('codex')],
      question: 'First question',
      timeoutMinutes: 8,
    });
    orch.start(req.id);

    // Register codex invocation in same thread
    const codexCreds = mockRegistry.register('codex', 'thread-1', 'user-1');

    // codex tries to create another multi-mention — should be rejected
    const res = await app.inject({
      method: 'POST',
      url: '/api/callbacks/multi-mention',
      payload: {
        invocationId: codexCreds.invocationId,
        callbackToken: codexCreds.callbackToken,
        targets: ['gemini'],
        question: 'Cascading question',
        callbackTo: 'codex',
      },
    });

    assert.equal(res.statusCode, 409);
    const body = JSON.parse(res.body);
    assert.ok(body.error.includes('Anti-cascade'));
  });

  // ── InvocationTracker concurrent abort bug ──────────────────────

  test('concurrent dispatches are NOT aborted by InvocationTracker (per-thread singleton)', async () => {
    // Reproduce the bug: InvocationTracker.start() aborts prior invocation
    // for the same threadId, causing all but the last dispatch to lose their response.
    resetMultiMentionOrchestrator();

    const { InvocationTracker } = await import('../dist/domains/cats/services/agents/invocation/InvocationTracker.js');
    const tracker = new InvocationTracker();

    // Slow mock router: each target yields text after a delay, giving tracker
    // time to abort earlier dispatches
    const slowRouter = {
      async *routeExecution(_userId, _message, _threadId, _invId, targetCats, _intent, opts) {
        const catId = targetCats[0];
        // Small delay to let concurrent starts happen
        await new Promise((r) => setTimeout(r, 30));
        // Check if we've been aborted
        if (opts?.signal?.aborted) return;
        yield { type: 'text', catId, content: `Reply from ${catId}`, timestamp: Date.now() };
        yield { type: 'done', catId, isFinal: true, timestamp: Date.now() };
      },
    };

    // Re-create app with invocationTracker
    const trackerApp = Fastify({ logger: false });
    const { registerMultiMentionRoutes } = await import('../dist/routes/callback-multi-mention-routes.js');
    registerMultiMentionRoutes(trackerApp, {
      registry: mockRegistry,
      messageStore: mockMessageStore,
      socketManager: mockSocket,
      router: slowRouter,
      invocationRecordStore: mockInvocationRecordStore,
      invocationTracker: tracker,
    });
    await trackerApp.ready();

    // Use a separate creds so initiator (codex) is different from all targets
    const callerCreds = mockRegistry.register('codex', 'thread-1', 'user-1');

    await trackerApp.inject({
      method: 'POST',
      url: '/api/callbacks/multi-mention',
      payload: {
        invocationId: callerCreds.invocationId,
        callbackToken: callerCreds.callbackToken,
        targets: ['opus', 'gemini'],
        question: 'Test concurrent dispatch',
        callbackTo: 'codex',
      },
    });

    // Wait for all dispatches to complete
    await new Promise((r) => setTimeout(r, 500));

    // The aggregated result should contain replies from BOTH cats
    const stored = mockMessageStore.getMessages();
    const resultMsg = stored.find((m) => m.content.includes('Multi-Mention 结果汇总'));
    assert.ok(resultMsg, 'Should have aggregated result');
    assert.ok(resultMsg.content.includes('Reply from opus'), `Opus response missing. Got:\n${resultMsg?.content}`);
    assert.ok(resultMsg.content.includes('Reply from gemini'), `Gemini response missing. Got:\n${resultMsg?.content}`);

    await trackerApp.close();
  });

  // ── Idempotency ───────────────────────────────────────────────────

  test('idempotency key returns same requestId', async () => {
    const payload = {
      invocationId: creds.invocationId,
      callbackToken: creds.callbackToken,
      targets: ['codex'],
      question: 'test',
      callbackTo: 'opus',
      idempotencyKey: 'idem-1',
    };

    const res1 = await app.inject({ method: 'POST', url: '/api/callbacks/multi-mention', payload });
    const res2 = await app.inject({ method: 'POST', url: '/api/callbacks/multi-mention', payload });

    const body1 = JSON.parse(res1.body);
    const body2 = JSON.parse(res2.body);
    assert.equal(body1.requestId, body2.requestId);
  });
});
