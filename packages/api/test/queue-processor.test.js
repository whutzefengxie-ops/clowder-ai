import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

const { InvocationQueue } = await import('../dist/domains/cats/services/agents/invocation/InvocationQueue.js');
const { QueueProcessor } = await import('../dist/domains/cats/services/agents/invocation/QueueProcessor.js');

/** Build a stub deps object for QueueProcessor */
function stubDeps(overrides = {}) {
  return {
    queue: new InvocationQueue(),
    invocationTracker: {
      start: mock.fn(() => new AbortController()),
      complete: mock.fn(),
      has: mock.fn(() => false),
    },
    invocationRecordStore: {
      create: mock.fn(async () => ({
        outcome: 'created',
        invocationId: 'inv-stub',
      })),
      update: mock.fn(async () => {}),
    },
    router: {
      routeExecution: mock.fn(async function* () {
        yield { type: 'done', catId: 'opus', timestamp: Date.now() };
      }),
      ackCollectedCursors: mock.fn(async () => {}),
    },
    socketManager: {
      broadcastAgentMessage: mock.fn(),
      broadcastToRoom: mock.fn(),
      emitToUser: mock.fn(),
    },
    messageStore: {
      append: mock.fn(async () => ({ id: 'msg-stub' })),
      getById: mock.fn(async () => null),
    },
    log: {
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
    },
    ...overrides,
  };
}

/** Helper: enqueue an entry and return it */
function enqueueEntry(queue, overrides = {}) {
  const result = queue.enqueue({
    threadId: 't1',
    userId: 'u1',
    content: 'hello',
    source: 'user',
    targetCats: ['opus'],
    intent: 'execute',
    ...overrides,
  });
  return result.entry;
}

describe('QueueProcessor', () => {
  let deps;
  let processor;

  beforeEach(() => {
    deps = stubDeps();
    processor = new QueueProcessor(deps);
  });

  // ── onInvocationComplete ──

  it('succeeded + queue has entries → auto-dequeues and starts execution', async () => {
    const entry = enqueueEntry(deps.queue);
    deps.queue.backfillMessageId('t1', 'u1', entry.id, 'msg-1');

    await processor.onInvocationComplete('t1', 'succeeded');

    // Should have started execution (invocationTracker.start called)
    assert.ok(deps.invocationTracker.start.mock.calls.length > 0);
    // Entry should be marked processing then removed
    // Wait a tick for background execution
    await new Promise((r) => setTimeout(r, 50));
  });

  it('succeeded + empty queue → no action', async () => {
    await processor.onInvocationComplete('t1', 'succeeded');
    assert.equal(deps.invocationTracker.start.mock.calls.length, 0);
  });

  it('canceled → pauses queue, emits queue_paused', async () => {
    enqueueEntry(deps.queue);

    await processor.onInvocationComplete('t1', 'canceled');

    // Should NOT start new execution
    assert.equal(deps.invocationTracker.start.mock.calls.length, 0);
    // Should emit queue_paused
    const emitCalls = deps.socketManager.emitToUser.mock.calls;
    assert.ok(emitCalls.length > 0);
    const pausedCall = emitCalls.find((c) => c.arguments[1] === 'queue_paused');
    assert.ok(pausedCall, 'should emit queue_paused');
    assert.equal(pausedCall.arguments[2].reason, 'canceled');
  });

  it('canceled with processing-only queue → does not emit queue_paused', async () => {
    enqueueEntry(deps.queue);
    // Simulate steer immediate: queued entry is promoted to processing before the canceled cleanup runs.
    deps.queue.markProcessing('t1', 'u1');

    await processor.onInvocationComplete('t1', 'canceled');

    assert.equal(processor.isPaused('t1'), false);
    const emitCalls = deps.socketManager.emitToUser.mock.calls;
    const pausedCall = emitCalls.find((c) => c.arguments[1] === 'queue_paused');
    assert.equal(pausedCall, undefined);
  });

  it('failed → pauses queue, emits queue_paused', async () => {
    enqueueEntry(deps.queue);

    await processor.onInvocationComplete('t1', 'failed');

    assert.equal(deps.invocationTracker.start.mock.calls.length, 0);
    const emitCalls = deps.socketManager.emitToUser.mock.calls;
    const pausedCall = emitCalls.find((c) => c.arguments[1] === 'queue_paused');
    assert.ok(pausedCall);
    assert.equal(pausedCall.arguments[2].reason, 'failed');
  });

  // ── processNext ──

  it('processNext starts next entry when paused', async () => {
    const entry = enqueueEntry(deps.queue);
    deps.queue.backfillMessageId('t1', 'u1', entry.id, 'msg-1');

    const result = await processor.processNext('t1', 'u1');
    assert.equal(result.started, true);
    assert.ok(result.entry);
  });

  it('processNext returns started=false when queue empty', async () => {
    const result = await processor.processNext('t1', 'u1');
    assert.equal(result.started, false);
  });

  // ── Mutex ──

  it('concurrent tryExecuteNext on same thread → only one starts', async () => {
    // Make executeEntry slow
    const slowDeps = stubDeps({
      router: {
        routeExecution: mock.fn(async function* () {
          await new Promise((r) => setTimeout(r, 100));
          yield { type: 'done', catId: 'opus', timestamp: Date.now() };
        }),
        ackCollectedCursors: mock.fn(async () => {}),
      },
    });
    const slowProcessor = new QueueProcessor(slowDeps);

    enqueueEntry(slowDeps.queue, { content: 'a', targetCats: ['a'] });
    enqueueEntry(slowDeps.queue, { content: 'b', targetCats: ['b'] });

    // Fire two processNext concurrently
    const [r1, r2] = await Promise.all([slowProcessor.processNext('t1', 'u1'), slowProcessor.processNext('t1', 'u1')]);

    // One should start, other should not (mutex)
    const startedCount = [r1, r2].filter((r) => r.started).length;
    assert.equal(startedCount, 1, 'only one should start due to mutex');
  });

  // ── executeEntry creates InvocationRecord ──

  it('executeEntry creates InvocationRecord with queue idempotency key', async () => {
    const entry = enqueueEntry(deps.queue);
    deps.queue.backfillMessageId('t1', 'u1', entry.id, 'msg-1');

    await processor.processNext('t1', 'u1');
    await new Promise((r) => setTimeout(r, 50));

    const createCalls = deps.invocationRecordStore.create.mock.calls;
    assert.ok(createCalls.length > 0);
    const createArg = createCalls[0].arguments[0];
    assert.ok(createArg.idempotencyKey.startsWith('queue-'));
  });

  // ── P1-2 fix: isPaused state tracking ──

  it('isPaused returns true after canceled when queue has entries', async () => {
    enqueueEntry(deps.queue);
    assert.equal(processor.isPaused('t1'), false);

    await processor.onInvocationComplete('t1', 'canceled');
    assert.equal(processor.isPaused('t1'), true);

    // processNext clears paused
    await processor.processNext('t1', 'u1');
    assert.equal(processor.isPaused('t1'), false);
  });

  it('isPaused returns false when queue is empty even after failed', async () => {
    // No entries in queue — no pause should be persisted
    await processor.onInvocationComplete('t1', 'failed');
    assert.equal(processor.isPaused('t1'), false);

    // Add entry → still not paused
    enqueueEntry(deps.queue);
    assert.equal(processor.isPaused('t1'), false);

    // Succeeded clears paused flag
    await processor.onInvocationComplete('t1', 'succeeded');
    assert.equal(processor.isPaused('t1'), false);
  });

  // ── P1 fix: chain auto-dequeue ──

  it('chain auto-dequeue: entry1 succeed → entry2 auto-starts', async () => {
    // Enqueue two entries from different users
    const e1 = enqueueEntry(deps.queue, { userId: 'u1', content: 'first', targetCats: ['a'] });
    deps.queue.backfillMessageId('t1', 'u1', e1.id, 'msg-1');
    const e2 = enqueueEntry(deps.queue, { userId: 'u2', content: 'second', targetCats: ['b'] });
    deps.queue.backfillMessageId('t1', 'u2', e2.id, 'msg-2');

    // Trigger first entry via onInvocationComplete('succeeded')
    await processor.onInvocationComplete('t1', 'succeeded');

    // Wait for both executions to complete (e1 finishes → chains → e2 starts)
    await new Promise((r) => setTimeout(r, 200));

    // Both entries should have been processed (tracker.start called twice)
    assert.ok(
      deps.invocationTracker.start.mock.calls.length >= 2,
      `expected >=2 tracker.start calls, got ${deps.invocationTracker.start.mock.calls.length}`,
    );
  });

  // ── P1 fix: executeEntry failure marks InvocationRecord ──

  it('executeEntry failure marks InvocationRecord as failed', async () => {
    const failDeps = stubDeps({
      router: {
        routeExecution: mock.fn(async function* () {
          throw new Error('route boom');
        }),
        ackCollectedCursors: mock.fn(async () => {}),
      },
    });
    const failProcessor = new QueueProcessor(failDeps);

    const entry = enqueueEntry(failDeps.queue);
    failDeps.queue.backfillMessageId('t1', 'u1', entry.id, 'msg-1');

    await failProcessor.processNext('t1', 'u1');
    // Wait for background execution to complete
    await new Promise((r) => setTimeout(r, 100));

    // InvocationRecord should be updated with status='failed'
    const updateCalls = failDeps.invocationRecordStore.update.mock.calls;
    const failedUpdate = updateCalls.find((c) => c.arguments[1]?.status === 'failed');
    assert.ok(failedUpdate, 'should mark InvocationRecord as failed');
    assert.ok(failedUpdate.arguments[1].error, 'should include error message');
  });

  // ── F039 remaining bugfix: queue execution should include contentBlocks ──

  it('executeEntry passes aggregated contentBlocks (messageId + mergedMessageIds) to routeExecution', async () => {
    const contentBlocks1 = [{ type: 'image', url: 'https://example.com/1.png' }];
    const contentBlocks2 = [{ type: 'image', url: 'https://example.com/2.png' }];

    deps.messageStore.getById = mock.fn(async (id) => {
      if (id === 'm1') return { id: 'm1', contentBlocks: contentBlocks1 };
      if (id === 'm2') return { id: 'm2', contentBlocks: contentBlocks2 };
      return null;
    });

    const entry = enqueueEntry(deps.queue);
    deps.queue.backfillMessageId('t1', 'u1', entry.id, 'm1');
    deps.queue.appendMergedMessageId('t1', 'u1', entry.id, 'm2');

    await processor.processNext('t1', 'u1');
    await new Promise((r) => setTimeout(r, 50));

    assert.ok(deps.router.routeExecution.mock.calls.length > 0);
    const call = deps.router.routeExecution.mock.calls[0];
    const opts = call.arguments[6];
    assert.ok(opts && typeof opts === 'object', 'expected opts object');
    assert.deepEqual(opts.contentBlocks, [...contentBlocks1, ...contentBlocks2]);
  });

  it('degrades when messageStore.getById throws: still executes without contentBlocks', async () => {
    deps.messageStore.getById = mock.fn(async () => {
      throw new Error('redis down');
    });

    const entry = enqueueEntry(deps.queue);
    deps.queue.backfillMessageId('t1', 'u1', entry.id, 'm1');

    await processor.processNext('t1', 'u1');
    await new Promise((r) => setTimeout(r, 50));

    assert.ok(deps.router.routeExecution.mock.calls.length > 0, 'should still execute');
    const call = deps.router.routeExecution.mock.calls[0];
    const opts = call.arguments[6];
    assert.ok(opts && typeof opts === 'object', 'expected opts object');
    assert.equal(opts.contentBlocks, undefined);

    const succeededUpdate = deps.invocationRecordStore.update.mock.calls.find(
      (c) => c.arguments[1]?.status === 'succeeded',
    );
    assert.ok(succeededUpdate, 'should mark InvocationRecord succeeded');

    assert.ok(deps.log.warn.mock.calls.length > 0, 'should warn on messageStore failure');
  });
});
