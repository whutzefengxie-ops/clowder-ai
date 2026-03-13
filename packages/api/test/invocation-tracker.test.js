/**
 * InvocationTracker Tests
 * userId 鉴权 + catId 追踪 + 基本调用追踪
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { InvocationTracker } = await import('../dist/domains/cats/services/agents/invocation/InvocationTracker.js');

describe('InvocationTracker userId auth', () => {
  test('start records userId and getUserId returns it', () => {
    const tracker = new InvocationTracker();
    tracker.start('thread-1', 'alice');
    assert.equal(tracker.getUserId('thread-1'), 'alice');
  });

  test('cancel with matching userId succeeds', () => {
    const tracker = new InvocationTracker();
    tracker.start('thread-1', 'alice');
    const result = tracker.cancel('thread-1', 'alice');
    assert.equal(result.cancelled, true);
    assert.equal(tracker.has('thread-1'), false);
  });

  test('cancel with mismatched userId is rejected', () => {
    const tracker = new InvocationTracker();
    tracker.start('thread-1', 'alice');
    const result = tracker.cancel('thread-1', 'bob');
    assert.equal(result.cancelled, false);
    // Invocation should still be active
    assert.equal(tracker.has('thread-1'), true);
    assert.equal(tracker.getUserId('thread-1'), 'alice');
  });

  test('cancel without requestUserId allows cancel (backward compat)', () => {
    const tracker = new InvocationTracker();
    tracker.start('thread-1', 'alice');
    const result = tracker.cancel('thread-1');
    assert.equal(result.cancelled, true);
    assert.equal(tracker.has('thread-1'), false);
  });
});

describe('InvocationTracker catId tracking', () => {
  test('start with catIds stores them, cancel returns them', () => {
    const tracker = new InvocationTracker();
    tracker.start('thread-1', 'alice', ['opus', 'gemini']);
    const result = tracker.cancel('thread-1', 'alice');
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.catIds, ['opus', 'gemini']);
  });

  test('start without catIds defaults to empty array', () => {
    const tracker = new InvocationTracker();
    tracker.start('thread-1', 'alice');
    const result = tracker.cancel('thread-1', 'alice');
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.catIds, []);
  });

  test('cancel non-existent thread returns empty catIds', () => {
    const tracker = new InvocationTracker();
    const result = tracker.cancel('thread-missing');
    assert.equal(result.cancelled, false);
    assert.deepEqual(result.catIds, []);
  });

  test('cancel with single catId returns it', () => {
    const tracker = new InvocationTracker();
    tracker.start('thread-1', 'alice', ['codex']);
    const result = tracker.cancel('thread-1');
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.catIds, ['codex']);
  });

  test('new start overwrites previous catIds', () => {
    const tracker = new InvocationTracker();
    tracker.start('thread-1', 'alice', ['opus']);
    tracker.start('thread-1', 'bob', ['gemini', 'codex']);
    const result = tracker.cancel('thread-1', 'bob');
    assert.equal(result.cancelled, true);
    assert.deepEqual(result.catIds, ['gemini', 'codex']);
  });
});
