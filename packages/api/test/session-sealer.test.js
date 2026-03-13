/**
 * SessionSealer Tests (in-memory)
 * F24 Phase B: Session lifecycle transitions.
 *
 * Red→Green: These tests are written BEFORE the implementation is complete.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('SessionSealer', () => {
  async function createFixtures() {
    const { SessionChainStore } = await import('../dist/domains/cats/services/stores/ports/SessionChainStore.js');
    const { SessionSealer } = await import('../dist/domains/cats/services/session/SessionSealer.js');
    const store = new SessionChainStore();
    const sealer = new SessionSealer(store);
    return { store, sealer };
  }

  const BASE_INPUT = {
    cliSessionId: 'cli-sess-1',
    threadId: 'thread-1',
    catId: 'opus',
    userId: 'user-1',
  };

  describe('requestSeal()', () => {
    test('seals active session → returns accepted=true, status=sealing', async () => {
      const { store, sealer } = await createFixtures();
      const record = store.create(BASE_INPUT);

      const result = await sealer.requestSeal({
        sessionId: record.id,
        reason: 'threshold',
      });

      assert.equal(result.accepted, true);
      assert.equal(result.status, 'sealing');
      assert.equal(result.sessionId, record.id);
    });

    test('sets sealReason on the record', async () => {
      const { store, sealer } = await createFixtures();
      const record = store.create(BASE_INPUT);

      await sealer.requestSeal({ sessionId: record.id, reason: 'manual' });

      const updated = store.get(record.id);
      assert.equal(updated?.sealReason, 'manual');
      assert.equal(updated?.status, 'sealing');
    });

    test('clears active pointer after seal', async () => {
      const { store, sealer } = await createFixtures();
      const record = store.create(BASE_INPUT);

      // Before seal: active should exist
      assert.ok(store.getActive('opus', 'thread-1'));

      await sealer.requestSeal({ sessionId: record.id, reason: 'threshold' });

      // After seal: active should be cleared
      assert.equal(store.getActive('opus', 'thread-1'), null);
    });

    test('is idempotent: sealing already sealing session returns accepted=false', async () => {
      const { store, sealer } = await createFixtures();
      const record = store.create(BASE_INPUT);

      const first = await sealer.requestSeal({ sessionId: record.id, reason: 'threshold' });
      assert.equal(first.accepted, true);

      const second = await sealer.requestSeal({ sessionId: record.id, reason: 'threshold' });
      assert.equal(second.accepted, false);
      assert.equal(second.status, 'sealing');
    });

    test('rejects sealing already sealed session', async () => {
      const { store, sealer } = await createFixtures();
      const record = store.create(BASE_INPUT);
      store.update(record.id, { status: 'sealed', sealedAt: Date.now() });

      const result = await sealer.requestSeal({ sessionId: record.id, reason: 'manual' });
      assert.equal(result.accepted, false);
      assert.equal(result.status, 'sealed');
    });

    test('returns accepted=false for non-existent session', async () => {
      const { sealer } = await createFixtures();

      const result = await sealer.requestSeal({
        sessionId: 'non-existent-id',
        reason: 'error',
      });
      assert.equal(result.accepted, false);
    });

    test('reason=error is supported', async () => {
      const { store, sealer } = await createFixtures();
      const record = store.create(BASE_INPUT);

      const result = await sealer.requestSeal({ sessionId: record.id, reason: 'error' });
      assert.equal(result.accepted, true);

      const updated = store.get(record.id);
      assert.equal(updated?.sealReason, 'error');
    });
  });

  describe('finalize()', () => {
    test('transitions sealing → sealed with sealedAt', async () => {
      const { store, sealer } = await createFixtures();
      const record = store.create(BASE_INPUT);

      await sealer.requestSeal({ sessionId: record.id, reason: 'threshold' });
      await sealer.finalize({ sessionId: record.id });

      const updated = store.get(record.id);
      assert.equal(updated?.status, 'sealed');
      assert.ok(updated?.sealedAt, 'should have sealedAt timestamp');
      assert.ok(updated.sealedAt > 0);
    });

    test('does nothing for non-sealing sessions', async () => {
      const { store, sealer } = await createFixtures();
      const record = store.create(BASE_INPUT);

      // Still active — finalize should be no-op
      await sealer.finalize({ sessionId: record.id });

      const updated = store.get(record.id);
      assert.equal(updated?.status, 'active');
    });

    test('does nothing for already sealed sessions', async () => {
      const { store, sealer } = await createFixtures();
      const record = store.create(BASE_INPUT);
      const now = Date.now();
      store.update(record.id, { status: 'sealed', sealedAt: now });

      await sealer.finalize({ sessionId: record.id });

      const updated = store.get(record.id);
      assert.equal(updated?.sealedAt, now, 'sealedAt should not change');
    });

    test('does nothing for non-existent session', async () => {
      const { sealer } = await createFixtures();
      // Should not throw
      await sealer.finalize({ sessionId: 'non-existent-id' });
    });
  });

  describe('full lifecycle: active → sealing → sealed', () => {
    test('complete seal + finalize + new session creation', async () => {
      const { store, sealer } = await createFixtures();

      // Create session 0
      const s0 = store.create(BASE_INPUT);
      assert.equal(s0.seq, 0);
      assert.equal(s0.status, 'active');

      // Seal session 0
      const sealResult = await sealer.requestSeal({
        sessionId: s0.id,
        reason: 'threshold',
      });
      assert.equal(sealResult.accepted, true);

      // Active pointer cleared → new session can be created
      assert.equal(store.getActive('opus', 'thread-1'), null);

      // Create session 1 (like invoke-single-cat would on next invocation)
      const s1 = store.create({ ...BASE_INPUT, cliSessionId: 'cli-sess-2' });
      assert.equal(s1.seq, 1);
      assert.equal(s1.status, 'active');

      // Finalize session 0 (background)
      await sealer.finalize({ sessionId: s0.id });
      const s0Final = store.get(s0.id);
      assert.equal(s0Final?.status, 'sealed');

      // Chain should show both
      const chain = store.getChain('opus', 'thread-1');
      assert.equal(chain.length, 2);
      assert.equal(chain[0].seq, 0);
      assert.equal(chain[0].status, 'sealed');
      assert.equal(chain[1].seq, 1);
      assert.equal(chain[1].status, 'active');
    });
  });
});
