import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeMentionStats } from '../../dist/domains/leaderboard/mention-stats.js';

const CAT_NAMES = { opus: '布偶猫', codex: '缅因猫', gemini: '暹罗猫' };

/** Helper to build a minimal message-like object with numeric timestamp */
function msg(id, mentions, isoDate, catId = null, content = 'x') {
  return { id, mentions, timestamp: new Date(isoDate).getTime(), catId, content };
}

describe('computeMentionStats', () => {
  const messages = [
    msg('1', ['opus'], '2026-03-10T14:00:00Z'),
    msg('2', ['opus'], '2026-03-10T03:00:00Z'), // night
    msg('3', ['codex'], '2026-03-10T15:00:00Z'),
    msg('4', ['opus', 'codex'], '2026-03-09T10:00:00Z'),
    msg('5', ['gemini'], '2026-03-10T02:30:00Z'), // night
    msg('6', [], '2026-03-10T12:00:00Z', 'opus', 'hello from opus'),
    msg('7', [], '2026-03-10T13:00:00Z', 'opus', 'more from opus'),
    msg('8', [], '2026-03-10T14:00:00Z', 'codex', 'codex reply'),
  ];

  it('ranks favoriteCat by total mention count desc', () => {
    const result = computeMentionStats(messages, CAT_NAMES, 'all');
    assert.equal(result.favoriteCat[0].catId, 'opus');
    assert.equal(result.favoriteCat[0].count, 3); // msg 1,2,4
    assert.equal(result.favoriteCat[0].rank, 1);
    assert.equal(result.favoriteCat[1].catId, 'codex');
    assert.equal(result.favoriteCat[1].count, 2); // msg 3,4
    assert.equal(result.favoriteCat[1].rank, 2);
    assert.equal(result.favoriteCat[2].catId, 'gemini');
    assert.equal(result.favoriteCat[2].count, 1);
  });

  it('ranks nightOwl by 0:00-6:00 mentions only', () => {
    const result = computeMentionStats(messages, CAT_NAMES, 'all');
    // opus: 1 night mention (03:00 in msg 2), gemini: 1 (02:30 in msg 5)
    assert.equal(result.nightOwl.length, 2);
    assert.equal(result.nightOwl[0].count, 1);
    assert.equal(result.nightOwl[1].count, 1);
    const ids = result.nightOwl.map((c) => c.catId);
    assert.ok(ids.includes('opus'));
    assert.ok(ids.includes('gemini'));
  });

  it('ranks chatty by messages sent (catId != null)', () => {
    const result = computeMentionStats(messages, CAT_NAMES, 'all');
    assert.equal(result.chatty[0].catId, 'opus');
    assert.equal(result.chatty[0].count, 2); // msg 6,7
    assert.equal(result.chatty[1].catId, 'codex');
    assert.equal(result.chatty[1].count, 1); // msg 8
  });

  it('uses displayName from catNames map', () => {
    const result = computeMentionStats(messages, CAT_NAMES, 'all');
    assert.equal(result.favoriteCat[0].displayName, '布偶猫');
    assert.equal(result.favoriteCat[1].displayName, '缅因猫');
  });

  it('returns empty arrays for no messages', () => {
    const result = computeMentionStats([], CAT_NAMES, 'all');
    assert.deepEqual(result.favoriteCat, []);
    assert.deepEqual(result.nightOwl, []);
    assert.deepEqual(result.chatty, []);
    assert.deepEqual(result.streak, []);
  });
});

describe('computeMentionStats — streak', () => {
  it('computes consecutive days streak', () => {
    const msgs = [
      msg('1', ['opus'], '2026-03-10T10:00:00Z'), // numeric ts
      msg('2', ['opus'], '2026-03-09T10:00:00Z'),
      msg('3', ['opus'], '2026-03-08T10:00:00Z'),
      // gap: no mention on 03-07
      msg('4', ['opus'], '2026-03-06T10:00:00Z'),
      msg('5', ['codex'], '2026-03-10T10:00:00Z'),
      msg('6', ['codex'], '2026-03-09T10:00:00Z'),
    ];
    const result = computeMentionStats(msgs, CAT_NAMES, 'all');
    const opusStreak = result.streak.find((s) => s.catId === 'opus');
    assert.ok(opusStreak, 'opus should have streak data');
    assert.equal(opusStreak.currentStreak, 3); // 03-08, 03-09, 03-10
    assert.equal(opusStreak.maxStreak, 3);

    const codexStreak = result.streak.find((s) => s.catId === 'codex');
    assert.ok(codexStreak);
    assert.equal(codexStreak.currentStreak, 2); // 03-09, 03-10
  });

  it('ignores cat-authored mentions for favorite/night/streak rankings', () => {
    const msgs = [
      msg('1', ['codex'], '2026-03-10T02:00:00Z', null, '@codex from owner'),
      msg('2', ['codex', 'gemini'], '2026-03-09T02:00:00Z', 'opus', '@codex @gemini from cat'),
    ];

    const result = computeMentionStats(msgs, CAT_NAMES, 'all');

    assert.deepEqual(
      result.favoriteCat.map((c) => ({ catId: c.catId, count: c.count })),
      [{ catId: 'codex', count: 1 }],
    );

    assert.deepEqual(
      result.nightOwl.map((c) => ({ catId: c.catId, count: c.count })),
      [{ catId: 'codex', count: 1 }],
    );

    const codexStreak = result.streak.find((s) => s.catId === 'codex');
    assert.ok(codexStreak);
    assert.equal(codexStreak.currentStreak, 1);
    assert.equal(codexStreak.maxStreak, 1);
  });

  it('ignores connector-sourced messages even when catId is null', () => {
    const msgs = [
      msg('1', ['codex'], '2026-03-10T02:00:00Z', null, '@codex from owner'),
      { ...msg('2', ['codex'], '2026-03-10T03:00:00Z', null, '@codex from wechat'), source: { connector: 'wechat' } },
    ];

    const result = computeMentionStats(msgs, CAT_NAMES, 'all');

    assert.deepEqual(
      result.favoriteCat.map((c) => ({ catId: c.catId, count: c.count })),
      [{ catId: 'codex', count: 1 }],
    );

    assert.deepEqual(
      result.nightOwl.map((c) => ({ catId: c.catId, count: c.count })),
      [{ catId: 'codex', count: 1 }],
    );
  });
});
