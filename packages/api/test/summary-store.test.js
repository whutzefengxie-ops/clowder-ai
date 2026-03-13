import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

const { SummaryStore } = await import('../dist/domains/cats/services/stores/ports/SummaryStore.js');

describe('SummaryStore', () => {
  /** @type {InstanceType<typeof SummaryStore>} */
  let store;

  beforeEach(() => {
    store = new SummaryStore({ maxSummaries: 5 });
  });

  const makeInput = (overrides = {}) => ({
    threadId: 'thread-1',
    topic: '讨论 AgentRouter 重构',
    conclusions: ['拆分为 invoke-single-cat', '并行流用 mergeStreams'],
    openQuestions: ['是否需要进程池?'],
    createdBy: 'opus',
    ...overrides,
  });

  describe('create + get', () => {
    it('creates a summary with correct fields', () => {
      const summary = store.create(makeInput());
      assert.ok(summary.id);
      assert.equal(summary.threadId, 'thread-1');
      assert.equal(summary.topic, '讨论 AgentRouter 重构');
      assert.deepEqual(summary.conclusions, ['拆分为 invoke-single-cat', '并行流用 mergeStreams']);
      assert.deepEqual(summary.openQuestions, ['是否需要进程池?']);
      assert.equal(summary.createdBy, 'opus');
      assert.ok(summary.createdAt > 0);
    });

    it('retrieves by id', () => {
      const summary = store.create(makeInput());
      const retrieved = store.get(summary.id);
      assert.deepEqual(retrieved, summary);
    });

    it('returns null for nonexistent id', () => {
      assert.equal(store.get('nonexistent'), null);
    });
  });

  describe('listByThread', () => {
    it('returns summaries for a specific thread', () => {
      store.create(makeInput({ threadId: 'thread-1' }));
      store.create(makeInput({ threadId: 'thread-2' }));
      store.create(makeInput({ threadId: 'thread-1', topic: '第二个纪要' }));

      const list = store.listByThread('thread-1');
      assert.equal(list.length, 2);
      assert.ok(list.every((s) => s.threadId === 'thread-1'));
    });

    it('returns empty for unknown thread', () => {
      assert.deepEqual(store.listByThread('nonexistent'), []);
    });

    it('returns in sortable ID order', () => {
      const s1 = store.create(makeInput({ topic: 'First' }));
      const s2 = store.create(makeInput({ topic: 'Second' }));
      const list = store.listByThread('thread-1');
      assert.equal(list[0].id, s1.id);
      assert.equal(list[1].id, s2.id);
    });
  });

  describe('delete', () => {
    it('deletes an existing summary', () => {
      const summary = store.create(makeInput());
      assert.equal(store.delete(summary.id), true);
      assert.equal(store.get(summary.id), null);
    });

    it('returns false for nonexistent', () => {
      assert.equal(store.delete('nonexistent'), false);
    });
  });

  describe('capacity limit', () => {
    it('evicts oldest when at capacity', () => {
      const summaries = [];
      for (let i = 0; i < 5; i++) {
        summaries.push(store.create(makeInput({ topic: `topic-${i}` })));
      }
      // Create one more — should evict oldest
      store.create(makeInput({ topic: 'new-topic' }));
      assert.equal(store.size, 5);
      assert.equal(store.get(summaries[0].id), null);
    });
  });
});
