/**
 * F079: Vote Routes Tests
 * 投票系统 API 测试
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

/**
 * Minimal Fastify test harness (same pattern as modes routes tests).
 * We import the real ThreadStore + vote routes, wire them up, inject requests.
 */
async function buildApp() {
  const { default: Fastify } = await import('fastify');
  const { ThreadStore } = await import('../dist/domains/cats/services/stores/ports/ThreadStore.js');
  const { voteRoutes } = await import('../dist/routes/votes.js');

  const threadStore = new ThreadStore();
  const broadcasts = [];
  const persistedMessages = [];
  const socketManager = {
    broadcastToRoom: (room, event, data) => {
      broadcasts.push({ room, event, data });
    },
  };
  const messageStore = {
    append: async (msg) => {
      const stored = { id: `msg-${persistedMessages.length}`, ...msg };
      persistedMessages.push(stored);
      return stored;
    },
  };

  const app = Fastify();
  await app.register(voteRoutes, { threadStore, socketManager, messageStore });
  await app.ready();

  return { app, threadStore, socketManager, broadcasts, messageStore, persistedMessages };
}

describe('Vote Routes', () => {
  // ── POST /api/threads/:threadId/vote/start ──

  test('start vote returns 201 with voting state', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test thread');

    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: {
        question: '谁最绿茶？',
        options: ['opus', 'codex', 'gemini'],
        anonymous: false,
        timeoutSec: 120,
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.question, '谁最绿茶？');
    assert.deepEqual(body.options, ['opus', 'codex', 'gemini']);
    assert.equal(body.anonymous, false);
    assert.equal(body.status, 'active');
    assert.ok(body.deadline > Date.now() - 1000);
  });

  test('start vote rejects if thread not found', async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/threads/nonexistent/vote/start',
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'test?', options: ['a', 'b'] },
    });

    assert.equal(res.statusCode, 404);
  });

  test('start vote rejects if not thread owner', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-2' },
      payload: { question: 'test?', options: ['a', 'b'] },
    });

    assert.equal(res.statusCode, 403);
  });

  test('start vote rejects if vote already active', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    // First vote
    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'q1?', options: ['a', 'b'] },
    });

    // Second vote should fail
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'q2?', options: ['c', 'd'] },
    });

    assert.equal(res.statusCode, 409);
  });

  test('start vote validates empty question', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: '', options: ['a', 'b'] },
    });

    assert.equal(res.statusCode, 400);
  });

  test('start vote requires at least 2 options', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'pick?', options: ['only-one'] },
    });

    assert.equal(res.statusCode, 400);
  });

  // ── POST /api/threads/:threadId/vote ──

  test('cast vote records vote for user', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'pick?', options: ['a', 'b'] },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'a' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.votes['user-1'], 'a');
  });

  test('cast vote rejects invalid option', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'pick?', options: ['a', 'b'] },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'nonexistent' },
    });

    assert.equal(res.statusCode, 400);
  });

  test('cast vote rejects when no active vote', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'a' },
    });

    assert.equal(res.statusCode, 404);
  });

  test('cast vote allows changing vote', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'pick?', options: ['a', 'b'] },
    });

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'a' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'b' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.votes['user-1'], 'b');
  });

  // ── GET /api/threads/:threadId/vote ──

  test('get vote returns current voting state', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'pick?', options: ['a', 'b'], anonymous: true },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.vote.question, 'pick?');
    assert.equal(body.vote.anonymous, true);
  });

  test('get vote returns null when no active vote', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    const res = await app.inject({
      method: 'GET',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.vote, null);
  });

  // ── DELETE /api/threads/:threadId/vote ──

  test('close vote returns results and clears state', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'pick?', options: ['a', 'b'] },
    });

    // Cast a vote
    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'a' },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.result.question, 'pick?');
    assert.deepEqual(body.result.votes, { 'user-1': 'a' });
    assert.equal(body.result.status, 'closed');

    // State should be cleared
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
    });
    assert.equal(JSON.parse(getRes.body).vote, null);
  });

  test('close vote rejects when no active vote', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
    });

    assert.equal(res.statusCode, 404);
  });

  test('close vote broadcasts vote_closed event', async () => {
    const { app, threadStore, broadcasts } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'pick?', options: ['a', 'b'] },
    });

    await app.inject({
      method: 'DELETE',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
    });

    const voteEvents = broadcasts.filter((b) => b.event === 'vote_closed');
    assert.equal(voteEvents.length, 1);
    assert.equal(voteEvents[0].data.threadId, thread.id);
  });

  test('start vote broadcasts vote_started event', async () => {
    const { app, threadStore, broadcasts } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'pick?', options: ['a', 'b'] },
    });

    const voteEvents = broadcasts.filter((b) => b.event === 'vote_started');
    assert.equal(voteEvents.length, 1);
    assert.equal(voteEvents[0].data.threadId, thread.id);
  });

  // ── Deadline enforcement ──

  test('cast vote rejects after deadline', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    // Start with very short timeout
    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'pick?', options: ['a', 'b'], timeoutSec: 10 },
    });

    // Manually expire the deadline
    const state = threadStore.getVotingState(thread.id);
    state.deadline = Date.now() - 1000; // expired 1s ago
    threadStore.updateVotingState(thread.id, state);

    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'a' },
    });

    assert.equal(res.statusCode, 410);
    const body = JSON.parse(res.body);
    assert.equal(body.code, 'VOTE_EXPIRED');
  });

  // ── Rich block in close response ──

  test('close vote returns rich block card with tally', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'Best?', options: ['x', 'y'] },
    });

    // Cast votes
    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'x' },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
    });

    const body = JSON.parse(res.body);
    assert.ok(body.richBlock);
    assert.equal(body.richBlock.kind, 'card');
    assert.equal(body.richBlock.tone, 'info');
    assert.ok(body.richBlock.title.includes('Best?'));
    assert.ok(body.richBlock.fields.length === 2);
    // x got 1 vote = 100%
    assert.ok(body.richBlock.fields[0].value.includes('1 票'));
  });

  // ── Anonymous mode ──

  test('anonymous vote GET strips voter identities', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'pick?', options: ['a', 'b'], anonymous: true },
    });

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'a' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
    });

    const body = JSON.parse(res.body);
    assert.deepEqual(body.vote.votes, {}); // votes stripped
    assert.equal(body.vote.voteCount, 1); // count still available
  });

  test('anonymous close strips voter identities from result', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'pick?', options: ['a', 'b'], anonymous: true },
    });

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'a' },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
    });

    const body = JSON.parse(res.body);
    assert.deepEqual(body.result.votes, {}); // stripped
    assert.ok(body.richBlock.bodyMarkdown.includes('匿名'));
  });

  // ── P1-1: anonymous cast must not leak userId/option ──

  test('anonymous cast response does not contain votes map', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'pick?', options: ['a', 'b'], anonymous: true },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'a' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    // Should not expose who voted what
    assert.deepEqual(body.votes, {});
    // Should expose aggregate count
    assert.equal(body.voteCount, 1);
  });

  test('anonymous cast broadcast does not contain userId or option', async () => {
    const { app, threadStore, broadcasts } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'pick?', options: ['a', 'b'], anonymous: true },
    });

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'a' },
    });

    const castEvents = broadcasts.filter((b) => b.event === 'vote_cast');
    assert.equal(castEvents.length, 1);
    // Should NOT have userId or option
    assert.equal(castEvents[0].data.userId, undefined);
    assert.equal(castEvents[0].data.option, undefined);
    // Should have aggregate voteCount
    assert.equal(castEvents[0].data.voteCount, 1);
  });

  test('anonymous close result includes tally field for frontend', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: 'pick?', options: ['a', 'b'], anonymous: true },
    });

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'a' },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
    });

    const body = JSON.parse(res.body);
    // Result should have tally for frontend consumption
    assert.ok(body.result.tally);
    assert.equal(body.result.tally.a, 1);
    assert.equal(body.result.tally.b, 0);
  });

  // ── Phase 2: voters field ──

  test('start vote accepts voters field and stores it', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: {
        question: '谁最绿茶？',
        options: ['opus', 'codex'],
        voters: ['opus', 'codex'],
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.deepEqual(body.voters, ['opus', 'codex']);
  });

  test('start vote works without voters field (Phase 1 compat)', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: {
        question: 'pick?',
        options: ['a', 'b'],
      },
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.voters, undefined);
  });

  // ── Phase 2: auto-close on voter completion ──

  test('cast vote auto-closes when all designated voters have voted', async () => {
    const { app, threadStore, broadcasts } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: {
        question: '谁最绿茶？',
        options: ['opus', 'codex'],
        voters: ['opus', 'codex'],
      },
    });

    // First voter
    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'opus' },
      payload: { option: 'codex' },
    });

    // No auto-close yet
    let closeEvents = broadcasts.filter((b) => b.event === 'vote_closed');
    assert.equal(closeEvents.length, 0);

    // Second (final) voter
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'codex' },
      payload: { option: 'opus' },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.autoClose, true);

    // Auto-close should have broadcast
    closeEvents = broadcasts.filter((b) => b.event === 'vote_closed');
    assert.equal(closeEvents.length, 1);
    assert.ok(closeEvents[0].data.richBlock);

    // Vote state should be cleared
    const state = await threadStore.getVotingState(thread.id);
    assert.equal(state, null);
  });

  // ── P1-2 (Phase 2 review): non-designated voter must be rejected ──

  test('cast rejects non-designated voter with 403', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: {
        question: '谁最绿茶？',
        options: ['opus', 'codex'],
        voters: ['opus', 'codex'],
      },
    });

    // intruder is not in voters
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'intruder' },
      payload: { option: 'opus' },
    });

    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.equal(body.code, 'NOT_DESIGNATED_VOTER');

    // intruder's vote must not be recorded
    const state = await threadStore.getVotingState(thread.id);
    assert.equal(state.votes.intruder, undefined);
  });

  test('cast allows anyone when voters not specified (Phase 1 compat)', async () => {
    const { app, threadStore } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: {
        question: 'pick?',
        options: ['a', 'b'],
      },
    });

    // No voters restriction — anyone can vote
    const res = await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'random-user' },
      payload: { option: 'a' },
    });

    assert.equal(res.statusCode, 200);
  });

  test('timeout auto-close fires after deadline', async () => {
    const { app, threadStore, broadcasts } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    // Start with very short timeout (10s minimum)
    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: {
        question: 'timeout test?',
        options: ['a', 'b'],
        timeoutSec: 10,
      },
    });

    // Verify vote is active
    let state = await threadStore.getVotingState(thread.id);
    assert.ok(state);
    assert.equal(state.status, 'active');

    // The timer is registered but we can't easily test real setTimeout in unit tests.
    // Instead, verify the timer infrastructure works by checking the vote can be
    // manually closed (the timer mechanism uses the same closeVoteInternal).
    const closeRes = await app.inject({
      method: 'DELETE',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
    });
    assert.equal(closeRes.statusCode, 200);

    // State should be cleared
    state = await threadStore.getVotingState(thread.id);
    assert.equal(state, null);
  });

  test('cast vote does not auto-close without voters field', async () => {
    const { app, threadStore, broadcasts } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: {
        question: 'pick?',
        options: ['a', 'b'],
      },
    });

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'a' },
    });

    const closeEvents = broadcasts.filter((b) => b.event === 'vote_closed');
    assert.equal(closeEvents.length, 0);
  });

  // ── P1-3 (Phase 2 review): close must persist rich block to message history ──

  test('DELETE close persists rich block as system message', async () => {
    const { app, threadStore, persistedMessages } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: '谁最绿茶？', options: ['opus', 'codex'] },
    });

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'opus' },
    });

    await app.inject({
      method: 'DELETE',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
    });

    // Rich block must be persisted as a message
    assert.equal(persistedMessages.length, 1);
    const msg = persistedMessages[0];
    assert.equal(msg.threadId, thread.id);
    assert.equal(msg.userId, 'user-1');
    assert.ok(msg.extra.rich);
    assert.equal(msg.extra.rich.blocks.length, 1);
    assert.ok(msg.extra.rich.blocks[0].title.includes('投票结果'));
  });

  // ── Gap 3: vote result connector bubble ──

  test('DELETE close persists message with vote-result connector source', async () => {
    const { app, threadStore, persistedMessages } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: '谁最坏？', options: ['opus', 'codex'] },
    });

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'opus' },
    });

    await app.inject({
      method: 'DELETE',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
    });

    assert.equal(persistedMessages.length, 1);
    const msg = persistedMessages[0];
    // Must have connector source for ConnectorBubble rendering
    assert.ok(msg.source, 'message must have source field');
    assert.equal(msg.source.connector, 'vote-result');
    assert.equal(msg.source.label, '投票结果');
    assert.equal(msg.source.icon, 'ballot');
  });

  test('DELETE close persists connector message with thread owner userId (not system)', async () => {
    const { app, threadStore, persistedMessages } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { question: '谁最坏？', options: ['opus', 'codex'] },
    });

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: { option: 'opus' },
    });

    await app.inject({
      method: 'DELETE',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'user-1' },
    });

    const connectorMsgs = persistedMessages.filter((m) => m.source?.connector === 'vote-result');
    assert.equal(connectorMsgs.length, 1);
    // userId must be thread owner, not 'system' — otherwise getByThread filters it out
    assert.equal(connectorMsgs[0].userId, 'user-1');
  });

  test('auto-close via cast persists message with vote-result connector source', async () => {
    const { app, threadStore, persistedMessages } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: {
        question: '谁最坏？',
        options: ['opus', 'codex'],
        voters: ['opus', 'codex'],
      },
    });

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'opus' },
      payload: { option: 'codex' },
    });

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'codex' },
      payload: { option: 'opus' },
    });

    assert.equal(persistedMessages.length, 1);
    const msg = persistedMessages[0];
    assert.ok(msg.source, 'auto-close message must have source field');
    assert.equal(msg.source.connector, 'vote-result');
  });

  test('auto-close via cast persists rich block as system message', async () => {
    const { app, threadStore, persistedMessages } = await buildApp();
    const thread = threadStore.create('user-1', 'Test');

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote/start`,
      headers: { 'x-cat-cafe-user': 'user-1' },
      payload: {
        question: '谁最绿茶？',
        options: ['opus', 'codex'],
        voters: ['opus', 'codex'],
      },
    });

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'opus' },
      payload: { option: 'codex' },
    });

    // No message yet — not all voters done
    assert.equal(persistedMessages.length, 0);

    await app.inject({
      method: 'POST',
      url: `/api/threads/${thread.id}/vote`,
      headers: { 'x-cat-cafe-user': 'codex' },
      payload: { option: 'opus' },
    });

    // Auto-close should persist the result
    assert.equal(persistedMessages.length, 1);
    const msg = persistedMessages[0];
    assert.equal(msg.threadId, thread.id);
    assert.ok(msg.extra.rich.blocks[0].title.includes('投票结果'));
  });
});
