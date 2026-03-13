/**
 * #80 Cloud R7 P1 regression tests: first-flush bypass timing.
 *
 * Verifies that the very first event (tool or small text) creates a draft
 * immediately, even when it arrives within the 2s FLUSH_INTERVAL_MS window.
 *
 * These tests exercise the WRITE path in routeSerial/routeParallel via
 * mock draftStore spies — complementing the READ path tests in
 * draft-messages-merge.test.js.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Minimal mock service: tool-only stream (no text at all)
// This isolates the tool-event flush path — if text were present, the text
// branch could mask a regression where tool_use alone doesn't trigger upsert.
function createToolFirstService(catId) {
  return {
    async *invoke() {
      yield { type: 'tool_use', catId, toolName: 'read_file', toolInput: '{}', timestamp: Date.now() };
      yield { type: 'tool_result', catId, content: 'file content', timestamp: Date.now() };
      yield { type: 'done', catId, timestamp: Date.now() };
    },
  };
}

function createSmallTextService(catId) {
  return {
    async *invoke() {
      // Single small text chunk (< 2000 chars, < 2s from start)
      yield { type: 'text', catId, content: 'Hi', timestamp: Date.now() };
      yield { type: 'done', catId, timestamp: Date.now() };
    },
  };
}

function createMockDeps(services) {
  let counter = 0;
  return {
    services,
    invocationDeps: {
      registry: {
        create: () => ({ invocationId: `inv-${++counter}`, callbackToken: `tok-${counter}` }),
        verify: () => null,
      },
      sessionManager: {
        getOrCreate: async () => ({}),
        resolveWorkingDirectory: () => '/tmp/test',
      },
      threadStore: null,
      apiUrl: 'http://127.0.0.1:3002',
    },
    messageStore: {
      append: async () => ({ id: `msg-${counter}`, userId: '', catId: null, content: '', mentions: [], timestamp: 0 }),
      getRecent: () => [],
      getMentionsFor: () => [],
      getBefore: () => [],
      getByThread: () => [],
      getByThreadAfter: () => [],
      getByThreadBefore: () => [],
    },
  };
}

function createSpyDraftStore() {
  /** @type {Array<{method: string, args: unknown[]}>} */
  const calls = [];
  return {
    calls,
    upsert: (...args) => {
      calls.push({ method: 'upsert', args });
    },
    touch: (...args) => {
      calls.push({ method: 'touch', args });
    },
    delete: (...args) => {
      calls.push({ method: 'delete', args });
    },
    deleteByThread: (...args) => {
      calls.push({ method: 'deleteByThread', args });
    },
    getByThread: () => [],
  };
}

describe('#80 draft flush timing — first event bypass (cloud R7 P1)', () => {
  describe('routeSerial', () => {
    it('first tool_use creates draft immediately (no 2s wait)', async () => {
      const { routeSerial } = await import('../dist/domains/cats/services/agents/routing/route-serial.js');
      const deps = createMockDeps({ opus: createToolFirstService('opus') });
      const spy = createSpyDraftStore();
      deps.draftStore = spy;

      // Drain the generator
      const msgs = [];
      for await (const msg of routeSerial(deps, ['opus'], 'do something', 'user-1', 'thread-1')) {
        msgs.push(msg);
      }

      // R10 P1: The very FIRST draftStore call must be upsert, not touch.
      // If neverFlushed bypass regresses, the first call would be touch (heartbeat).
      assert.ok(spy.calls.length >= 1, `Expected at least 1 draftStore call, got ${spy.calls.length}`);
      assert.equal(spy.calls[0].method, 'upsert', `First draftStore call must be upsert, got "${spy.calls[0].method}"`);

      // No touch should precede the first upsert
      const firstUpsertIdx = spy.calls.findIndex((c) => c.method === 'upsert');
      const firstTouchIdx = spy.calls.findIndex((c) => c.method === 'touch');
      assert.ok(
        firstTouchIdx === -1 || firstTouchIdx > firstUpsertIdx,
        `touch (idx=${firstTouchIdx}) must not precede first upsert (idx=${firstUpsertIdx})`,
      );

      // First upsert should carry tool events
      const firstUpsert = spy.calls[0].args[0];
      assert.ok(firstUpsert.toolEvents && firstUpsert.toolEvents.length > 0, 'First upsert should include tool events');
    });

    it('first small text creates draft immediately (no 2s wait)', async () => {
      const { routeSerial } = await import('../dist/domains/cats/services/agents/routing/route-serial.js');
      const deps = createMockDeps({ opus: createSmallTextService('opus') });
      const spy = createSpyDraftStore();
      deps.draftStore = spy;

      const msgs = [];
      for await (const msg of routeSerial(deps, ['opus'], 'hello', 'user-1', 'thread-1')) {
        msgs.push(msg);
      }

      // R10 P1: First draftStore call must be upsert (not touch)
      assert.ok(spy.calls.length >= 1, `Expected at least 1 draftStore call, got ${spy.calls.length}`);
      assert.equal(spy.calls[0].method, 'upsert', `First draftStore call must be upsert, got "${spy.calls[0].method}"`);

      // No touch should precede the first upsert
      const firstUpsertIdx = spy.calls.findIndex((c) => c.method === 'upsert');
      const firstTouchIdx = spy.calls.findIndex((c) => c.method === 'touch');
      assert.ok(
        firstTouchIdx === -1 || firstTouchIdx > firstUpsertIdx,
        `touch (idx=${firstTouchIdx}) must not precede first upsert (idx=${firstUpsertIdx})`,
      );

      // First upsert should contain the text
      const firstUpsert = spy.calls[0].args[0];
      assert.ok(firstUpsert.content.includes('Hi'), 'First upsert should contain text content');
    });
  });

  describe('routeParallel', () => {
    it('first tool_use per cat creates draft immediately (no 2s wait)', async () => {
      const { routeParallel } = await import('../dist/domains/cats/services/agents/routing/route-parallel.js');
      const deps = createMockDeps({ opus: createToolFirstService('opus') });
      const spy = createSpyDraftStore();
      deps.draftStore = spy;

      const msgs = [];
      for await (const msg of routeParallel(deps, ['opus'], 'do something', 'user-1', 'thread-1')) {
        msgs.push(msg);
      }

      // R10 P1: First draftStore call must be upsert, not touch
      assert.ok(spy.calls.length >= 1, `Expected at least 1 draftStore call, got ${spy.calls.length}`);
      assert.equal(spy.calls[0].method, 'upsert', `First draftStore call must be upsert, got "${spy.calls[0].method}"`);

      // No touch should precede the first upsert
      const firstUpsertIdx = spy.calls.findIndex((c) => c.method === 'upsert');
      const firstTouchIdx = spy.calls.findIndex((c) => c.method === 'touch');
      assert.ok(
        firstTouchIdx === -1 || firstTouchIdx > firstUpsertIdx,
        `touch (idx=${firstTouchIdx}) must not precede first upsert (idx=${firstUpsertIdx})`,
      );

      // First upsert should carry tool events
      const firstUpsert = spy.calls[0].args[0];
      assert.ok(firstUpsert.toolEvents && firstUpsert.toolEvents.length > 0, 'First upsert should include tool events');
    });
  });
});
