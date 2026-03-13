/**
 * Unit tests for WorklistRegistry (F27)
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('WorklistRegistry', () => {
  let _registryModule;

  // Import fresh each time to avoid cross-test contamination
  // (registry is a module-level Map)
  test('register + push + unregister lifecycle', async () => {
    const { registerWorklist, unregisterWorklist, pushToWorklist, hasWorklist, getWorklist } = await import(
      '../dist/domains/cats/services/agents/routing/WorklistRegistry.js'
    );

    const threadId = 'test-lifecycle';
    const worklist = ['opus'];

    // Before register
    assert.equal(hasWorklist(threadId), false);
    assert.deepEqual(pushToWorklist(threadId, ['codex']), []);

    // Register
    const entry = registerWorklist(threadId, worklist, 10);
    assert.equal(hasWorklist(threadId), true);
    assert.equal(entry.a2aCount, 0);
    assert.equal(entry.maxDepth, 10);
    assert.strictEqual(entry.list, worklist);

    // Push unique
    const pushed = pushToWorklist(threadId, ['codex']);
    assert.deepEqual(pushed, ['codex']);
    assert.deepEqual(worklist, ['opus', 'codex']);
    assert.equal(entry.a2aCount, 1);

    // Push duplicate — no-op
    const pushDup = pushToWorklist(threadId, ['codex']);
    assert.deepEqual(pushDup, []);
    assert.deepEqual(worklist, ['opus', 'codex']);
    assert.equal(entry.a2aCount, 1);

    // Push multiple
    const pushMulti = pushToWorklist(threadId, ['gemini', 'codex']);
    assert.deepEqual(pushMulti, ['gemini']); // codex deduplicated
    assert.deepEqual(worklist, ['opus', 'codex', 'gemini']);
    assert.equal(entry.a2aCount, 2);

    // Unregister with owner check
    unregisterWorklist(threadId, entry);
    assert.equal(hasWorklist(threadId), false);
    assert.deepEqual(pushToWorklist(threadId, ['opus']), []);
  });

  test('push respects maxDepth', async () => {
    const { registerWorklist, unregisterWorklist, pushToWorklist } = await import(
      '../dist/domains/cats/services/agents/routing/WorklistRegistry.js'
    );

    const threadId = 'test-depth';
    const worklist = ['opus'];
    registerWorklist(threadId, worklist, 2);

    try {
      // Push 1st (a2aCount: 0 → 1) — ok
      assert.deepEqual(pushToWorklist(threadId, ['codex']), ['codex']);
      // Push 2nd (a2aCount: 1 → 2) — ok
      assert.deepEqual(pushToWorklist(threadId, ['gemini']), ['gemini']);
      // Push 3rd (a2aCount: 2 >= maxDepth: 2) — blocked
      assert.deepEqual(pushToWorklist(threadId, ['opus']), []);
    } finally {
      unregisterWorklist(threadId);
    }
  });

  test('R1 P1-1: preempt race — old unregister does not delete new worklist', async () => {
    const { registerWorklist, unregisterWorklist, hasWorklist, pushToWorklist } = await import(
      '../dist/domains/cats/services/agents/routing/WorklistRegistry.js'
    );

    const threadId = 'test-preempt';

    // Old invocation registers its worklist
    const oldEntry = registerWorklist(threadId, ['opus'], 10);
    assert.equal(hasWorklist(threadId), true);

    // New invocation preempts: registers a new worklist for the same thread
    const newEntry = registerWorklist(threadId, ['codex'], 10);
    assert.equal(hasWorklist(threadId), true);
    assert.notStrictEqual(oldEntry, newEntry);

    // Old invocation's finally block tries to unregister with stale owner
    unregisterWorklist(threadId, oldEntry);

    // New invocation's worklist must still be alive
    assert.equal(hasWorklist(threadId), true, 'new worklist must survive old unregister');
    const pushed = pushToWorklist(threadId, ['gemini']);
    assert.deepEqual(pushed, ['gemini'], 'push to new worklist must still work');

    // Cleanup: new owner unregisters
    unregisterWorklist(threadId, newEntry);
    assert.equal(hasWorklist(threadId), false);
  });

  test('cloud Codex P1: stale callback caller rejected by callerCatId guard', async () => {
    const { registerWorklist, unregisterWorklist, pushToWorklist, getWorklist } = await import(
      '../dist/domains/cats/services/agents/routing/WorklistRegistry.js'
    );

    const threadId = 'test-caller-guard';

    // New invocation registers worklist: opus executes first, then codex
    const entry = registerWorklist(threadId, ['opus', 'codex'], 10);

    try {
      // executedIndex = 0 → current cat is opus
      // A callback from opus (current cat) should be allowed
      assert.deepEqual(pushToWorklist(threadId, ['gemini'], 'opus'), ['gemini']);
      assert.equal(entry.a2aCount, 1);

      // A callback from codex (not currently executing) should be rejected
      // This simulates a stale callback from a preempted invocation whose catId is codex
      assert.deepEqual(pushToWorklist(threadId, ['opus'], 'codex'), []);
      assert.equal(entry.a2aCount, 1, 'stale caller must not increase a2aCount');

      // Advance executedIndex to 1 → now codex is current
      entry.executedIndex = 1;

      // Now codex's callback should be allowed
      assert.deepEqual(pushToWorklist(threadId, ['opus'], 'codex'), ['opus']);
      assert.equal(entry.a2aCount, 2);

      // But opus callback should now be rejected (it's no longer current)
      assert.deepEqual(pushToWorklist(threadId, ['gemini'], 'opus'), []);
      assert.equal(entry.a2aCount, 2, 'past caller must not increase a2aCount');

      // Without callerCatId (legacy path from routeSerial text detection), always allowed.
      // Use a cat not already in pending to avoid dedup: worklist is now
      // ['opus','codex','gemini','opus'] with executedIndex=1, pending=['codex','gemini','opus'].
      // Push 'codex' would be deduped, so we push a cat that's not in pending.
      // Actually at this point pending already includes codex/gemini/opus.
      // Register a fresh worklist to test legacy path cleanly.
      unregisterWorklist(threadId, entry);
      const fresh = registerWorklist(threadId, ['opus'], 10);
      assert.deepEqual(pushToWorklist(threadId, ['codex']), ['codex']);
      assert.equal(fresh.a2aCount, 1, 'legacy path without callerCatId must still work');
      unregisterWorklist(threadId, fresh);
      return; // Skip the finally block cleanup since we already cleaned up
    } finally {
      unregisterWorklist(threadId, entry);
    }
  });

  test('P1: do not overwrite reply target for pending original cats', async () => {
    const { registerWorklist, unregisterWorklist, pushToWorklist, getWorklist } = await import(
      '../dist/domains/cats/services/agents/routing/WorklistRegistry.js'
    );

    const threadId = 'test-original-target-reply';
    const entry = registerWorklist(threadId, ['opus', 'codex'], 10);

    try {
      // codex is an original pending target; mention should NOT set A2A sender mapping
      assert.deepEqual(pushToWorklist(threadId, ['codex'], 'opus'), []);
      assert.equal(getWorklist(threadId).a2aFrom.get('codex'), undefined);

      // A2A-added pending targets may still refresh to latest sender before execution
      assert.deepEqual(pushToWorklist(threadId, ['gemini'], 'opus'), ['gemini']);
      assert.equal(getWorklist(threadId).a2aFrom.get('gemini'), 'opus');

      entry.executedIndex = 1; // now codex is current, gemini still pending
      assert.deepEqual(pushToWorklist(threadId, ['gemini'], 'codex'), []);
      assert.equal(getWorklist(threadId).a2aFrom.get('gemini'), 'codex');
    } finally {
      unregisterWorklist(threadId, entry);
    }
  });

  test('multiple threads are independent', async () => {
    const { registerWorklist, unregisterWorklist, pushToWorklist, getWorklist } = await import(
      '../dist/domains/cats/services/agents/routing/WorklistRegistry.js'
    );

    const wl1 = ['opus'];
    const wl2 = ['codex'];
    registerWorklist('t1', wl1, 10);
    registerWorklist('t2', wl2, 10);

    try {
      pushToWorklist('t1', ['codex']);
      pushToWorklist('t2', ['opus']);

      assert.deepEqual(wl1, ['opus', 'codex']);
      assert.deepEqual(wl2, ['codex', 'opus']);
      assert.equal(getWorklist('t1').a2aCount, 1);
      assert.equal(getWorklist('t2').a2aCount, 1);
    } finally {
      unregisterWorklist('t1');
      unregisterWorklist('t2');
    }
  });
});
