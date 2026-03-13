/**
 * F079 Phase 2: Vote interception tests
 * Tests the [VOTE:xxx] regex extraction + auto-close logic
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('extractVoteFromText', () => {
  test('extracts [VOTE:option] from text', async () => {
    const { extractVoteFromText } = await import('../dist/domains/cats/services/agents/routing/vote-intercept.js');
    const result = extractVoteFromText('我觉得 opus 最绿茶！[VOTE:opus]');
    assert.equal(result, 'opus');
  });

  test('extracts option with spaces trimmed', async () => {
    const { extractVoteFromText } = await import('../dist/domains/cats/services/agents/routing/vote-intercept.js');
    const result = extractVoteFromText('[VOTE: codex ]');
    assert.equal(result, 'codex');
  });

  test('returns null when no vote pattern', async () => {
    const { extractVoteFromText } = await import('../dist/domains/cats/services/agents/routing/vote-intercept.js');
    const result = extractVoteFromText('我不知道该投谁');
    assert.equal(result, null);
  });

  test('extracts first vote if multiple patterns', async () => {
    const { extractVoteFromText } = await import('../dist/domains/cats/services/agents/routing/vote-intercept.js');
    const result = extractVoteFromText('[VOTE:a] 其实 [VOTE:b] 也不错');
    assert.equal(result, 'a');
  });

  test('handles Chinese option names', async () => {
    const { extractVoteFromText } = await import('../dist/domains/cats/services/agents/routing/vote-intercept.js');
    const result = extractVoteFromText('我选 [VOTE:布偶猫]');
    assert.equal(result, '布偶猫');
  });
});

describe('checkVoteCompletion', () => {
  test('returns true when all voters have voted', async () => {
    const { checkVoteCompletion } = await import('../dist/domains/cats/services/agents/routing/vote-intercept.js');
    const state = {
      v: 1,
      question: 'test?',
      options: ['a', 'b'],
      votes: { opus: 'a', codex: 'b' },
      anonymous: false,
      deadline: Date.now() + 60000,
      createdBy: 'user-1',
      status: 'active',
      voters: ['opus', 'codex'],
    };
    assert.equal(checkVoteCompletion(state), true);
  });

  test('returns false when not all voters voted', async () => {
    const { checkVoteCompletion } = await import('../dist/domains/cats/services/agents/routing/vote-intercept.js');
    const state = {
      v: 1,
      question: 'test?',
      options: ['a', 'b'],
      votes: { opus: 'a' },
      anonymous: false,
      deadline: Date.now() + 60000,
      createdBy: 'user-1',
      status: 'active',
      voters: ['opus', 'codex'],
    };
    assert.equal(checkVoteCompletion(state), false);
  });

  test('returns false when no voters field (Phase 1 compat)', async () => {
    const { checkVoteCompletion } = await import('../dist/domains/cats/services/agents/routing/vote-intercept.js');
    const state = {
      v: 1,
      question: 'test?',
      options: ['a', 'b'],
      votes: { opus: 'a' },
      anonymous: false,
      deadline: Date.now() + 60000,
      createdBy: 'user-1',
      status: 'active',
    };
    assert.equal(checkVoteCompletion(state), false);
  });
});

describe('buildVoteNotification', () => {
  test('builds notification message with options', async () => {
    const { buildVoteNotification } = await import('../dist/domains/cats/services/agents/routing/vote-intercept.js');
    const msg = buildVoteNotification('谁最绿茶？', ['opus', 'codex', 'gemini']);
    assert.ok(msg.includes('谁最绿茶？'));
    assert.ok(msg.includes('opus'));
    assert.ok(msg.includes('[VOTE:'));
  });
});

describe('buildVoteTally', () => {
  test('builds tally from votes', async () => {
    const { buildVoteTally } = await import('../dist/domains/cats/services/agents/routing/vote-intercept.js');
    const tally = buildVoteTally(['a', 'b'], { u1: 'a', u2: 'a', u3: 'b' });
    assert.equal(tally.a, 2);
    assert.equal(tally.b, 1);
  });

  test('includes zero-vote options', async () => {
    const { buildVoteTally } = await import('../dist/domains/cats/services/agents/routing/vote-intercept.js');
    const tally = buildVoteTally(['a', 'b', 'c'], { u1: 'a' });
    assert.equal(tally.a, 1);
    assert.equal(tally.b, 0);
    assert.equal(tally.c, 0);
  });
});
