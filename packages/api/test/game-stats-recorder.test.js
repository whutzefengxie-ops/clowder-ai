/**
 * GameStatsRecorder Tests (F101 Task B10)
 *
 * Tests extraction of game stats from finished runtime for leaderboard integration.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GameStatsRecorder } from '../dist/domains/cats/services/game/GameStatsRecorder.js';

function makeFinishedRuntime(winner) {
  return {
    gameId: 'game-stats-test',
    threadId: 'thread-stats',
    gameType: 'werewolf',
    definition: {
      gameType: 'werewolf',
      displayName: 'Werewolf',
      minPlayers: 6,
      maxPlayers: 6,
      roles: [
        { name: 'wolf', faction: 'wolf', description: 'Kills' },
        { name: 'seer', faction: 'village', description: 'Divines' },
        { name: 'witch', faction: 'village', description: 'Saves or poisons' },
        { name: 'villager', faction: 'village', description: 'Votes' },
      ],
      phases: [],
      actions: [],
      winConditions: [],
    },
    seats: [
      { seatId: 'P1', actorType: 'cat', actorId: 'opus', role: 'wolf', alive: false, properties: {} },
      { seatId: 'P2', actorType: 'human', actorId: 'alice', role: 'seer', alive: true, properties: {} },
      { seatId: 'P3', actorType: 'cat', actorId: 'codex', role: 'witch', alive: true, properties: {} },
      { seatId: 'P4', actorType: 'cat', actorId: 'gemini', role: 'villager', alive: true, properties: {} },
      { seatId: 'P5', actorType: 'cat', actorId: 'sonnet', role: 'villager', alive: false, properties: {} },
      { seatId: 'P6', actorType: 'cat', actorId: 'haiku', role: 'villager', alive: true, properties: {} },
    ],
    currentPhase: 'finished',
    round: 3,
    eventLog: [],
    pendingActions: {},
    status: 'finished',
    winner,
    config: { timeoutMs: 30000, voiceMode: false, humanRole: 'player' },
    version: 10,
    createdAt: Date.now() - 60000,
    updatedAt: Date.now(),
  };
}

describe('GameStatsRecorder', () => {
  it('extracts stats from finished game — village wins', () => {
    const runtime = makeFinishedRuntime('village');
    const stats = GameStatsRecorder.extractStats(runtime);

    assert.equal(stats.gameId, 'game-stats-test');
    assert.equal(stats.gameType, 'werewolf');
    assert.equal(stats.winner, 'village');
    assert.equal(stats.players.length, 6);

    // Wolf (P1) lost — dead, faction lost
    const wolfStats = stats.players.find((p) => p.actorId === 'opus');
    assert.equal(wolfStats.role, 'wolf');
    assert.equal(wolfStats.faction, 'wolf');
    assert.equal(wolfStats.survived, false);
    assert.equal(wolfStats.won, false);

    // Seer (P2) won — alive, village won
    const seerStats = stats.players.find((p) => p.actorId === 'alice');
    assert.equal(seerStats.role, 'seer');
    assert.equal(seerStats.faction, 'village');
    assert.equal(seerStats.survived, true);
    assert.equal(seerStats.won, true);

    // Dead villager (P5) — village won but player died
    const deadVillager = stats.players.find((p) => p.actorId === 'sonnet');
    assert.equal(deadVillager.survived, false);
    assert.equal(deadVillager.won, true, 'dead villager still wins if village wins');
  });

  it('extracts stats — wolf wins', () => {
    const runtime = makeFinishedRuntime('wolf');
    const stats = GameStatsRecorder.extractStats(runtime);

    assert.equal(stats.winner, 'wolf');

    const wolfStats = stats.players.find((p) => p.role === 'wolf');
    assert.equal(wolfStats.won, true);

    const seerStats = stats.players.find((p) => p.role === 'seer');
    assert.equal(seerStats.won, false);
  });

  it('includes actorType for each player', () => {
    const runtime = makeFinishedRuntime('village');
    const stats = GameStatsRecorder.extractStats(runtime);

    const humanPlayer = stats.players.find((p) => p.actorId === 'alice');
    assert.equal(humanPlayer.actorType, 'human');

    const catPlayer = stats.players.find((p) => p.actorId === 'opus');
    assert.equal(catPlayer.actorType, 'cat');
  });

  it('includes endedAt timestamp', () => {
    const runtime = makeFinishedRuntime('village');
    const stats = GameStatsRecorder.extractStats(runtime);

    assert.equal(typeof stats.endedAt, 'number');
    assert.ok(stats.endedAt > 0);
  });
});
