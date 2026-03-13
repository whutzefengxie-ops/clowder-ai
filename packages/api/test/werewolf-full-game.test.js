/**
 * Full 9-Person Werewolf Integration Test (F101 Task B9)
 *
 * Simulates a complete game: lobby → deal → night/day cycles → win.
 * Verifies information isolation at each step.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GameViewBuilder } from '../dist/domains/cats/services/game/GameViewBuilder.js';
import { WerewolfEngine } from '../dist/domains/cats/services/game/werewolf/WerewolfEngine.js';
import { WerewolfLobby } from '../dist/domains/cats/services/game/werewolf/WerewolfLobby.js';

function makePlayers(count) {
  return Array.from({ length: count }, (_, i) => ({
    actorType: i === 0 ? 'human' : 'cat',
    actorId: `actor-${i + 1}`,
  }));
}

describe('Full 9-Person Werewolf Game', () => {
  it('complete game: lobby → role assignment → night/day → village wins', () => {
    // === Phase 1: Lobby + Role Assignment ===
    const lobby = new WerewolfLobby();
    const runtime = lobby.createLobby({
      threadId: 'thread-full-game',
      playerCount: 9,
      players: makePlayers(9),
    });

    assert.equal(runtime.status, 'lobby');
    assert.equal(runtime.seats.length, 9);

    lobby.startGame(runtime);

    assert.equal(runtime.status, 'playing');
    assert.equal(runtime.round, 1);

    // Verify all roles assigned
    for (const seat of runtime.seats) {
      assert.ok(seat.role, `${seat.seatId} should have role`);
    }

    // Count roles — should match 9p preset
    const roleCounts = {};
    for (const seat of runtime.seats) {
      roleCounts[seat.role] = (roleCounts[seat.role] ?? 0) + 1;
    }
    assert.equal(roleCounts.wolf, 2);
    assert.equal(roleCounts.seer, 1);
    assert.equal(roleCounts.witch, 1);
    assert.equal(roleCounts.hunter, 1);
    assert.equal(roleCounts.guard, 1);
    assert.equal(roleCounts.villager, 3);

    // Verify role_assigned events are seat-scoped
    const roleEvents = runtime.eventLog.filter((e) => e.type === 'role_assigned');
    assert.equal(roleEvents.length, 9);
    for (const e of roleEvents) {
      assert.ok(e.scope.startsWith('seat:'));
    }

    // === Phase 2: Information Isolation Check ===
    const wolves = runtime.seats.filter((s) => s.role === 'wolf');
    const villagers = runtime.seats.filter((s) => s.role === 'villager');
    const seer = runtime.seats.find((s) => s.role === 'seer');
    const witch = runtime.seats.find((s) => s.role === 'witch');
    const guard = runtime.seats.find((s) => s.role === 'guard');

    // Wolf view: sees own role + teammate
    const wolfView = GameViewBuilder.buildView(runtime, wolves[0].seatId);
    const wolfSelfSeat = wolfView.seats.find((s) => s.seatId === wolves[0].seatId);
    assert.equal(wolfSelfSeat.role, 'wolf');
    const wolfTeammate = wolfView.seats.find((s) => s.seatId === wolves[1].seatId);
    assert.equal(wolfTeammate.role, 'wolf', 'wolf should see teammate role');

    // Villager view: sees own role, not wolf role
    const villagerView = GameViewBuilder.buildView(runtime, villagers[0].seatId);
    const villagerSelfSeat = villagerView.seats.find((s) => s.seatId === villagers[0].seatId);
    assert.equal(villagerSelfSeat.role, 'villager');
    const villagerWolfSeat = villagerView.seats.find((s) => s.seatId === wolves[0].seatId);
    assert.equal(villagerWolfSeat.role, undefined, 'villager must not see wolf role');

    // Each player's role_assigned event only visible to themselves
    for (const e of roleEvents) {
      const targetSeatId = e.payload.seatId;
      const otherSeatId = runtime.seats.find((s) => s.seatId !== targetSeatId).seatId;
      const otherView = GameViewBuilder.buildView(runtime, otherSeatId);
      const canSee = otherView.visibleEvents.find(
        (ev) => ev.type === 'role_assigned' && ev.payload.seatId === targetSeatId,
      );
      // Only same-faction wolves can see each other's role events (they share faction:wolf... no, these are seat-scoped)
      // Actually role_assigned events are seat-scoped, so only the seat owner can see them
      // Exception: wolves don't get each other's role_assigned event (those are seat:Px scoped)
      if (otherSeatId !== targetSeatId) {
        assert.equal(canSee, undefined, `${otherSeatId} must not see ${targetSeatId}'s role_assigned`);
      }
    }

    // === Phase 3: Night 1 ===
    const engine = new WerewolfEngine(runtime);

    // Guard protects seer
    engine.setNightAction(guard.seatId, 'guard', seer.seatId);
    // Wolves kill a villager
    engine.setNightAction(wolves[0].seatId, 'kill', villagers[0].seatId);
    // Seer divines wolf (add divine result event manually for isolation check)
    engine.appendEvent({
      round: 1,
      phase: 'night_seer',
      type: 'divine_result',
      scope: `seat:${seer.seatId}`,
      payload: { target: wolves[0].seatId, result: 'wolf' },
    });

    const night1 = engine.resolveNight();
    assert.ok(night1.deaths.includes(villagers[0].seatId), 'villager should die');
    assert.equal(night1.deaths.length, 1, 'only one death');

    // Verify villager is dead
    const deadVillager = engine.getRuntime().seats.find((s) => s.seatId === villagers[0].seatId);
    assert.equal(deadVillager.alive, false);

    // Seer can see their divine result, wolf cannot
    const seerViewN1 = GameViewBuilder.buildView(engine.getRuntime(), seer.seatId);
    const divineEvent = seerViewN1.visibleEvents.find((e) => e.type === 'divine_result');
    assert.ok(divineEvent, 'seer should see divine result');

    const wolfViewN1 = GameViewBuilder.buildView(engine.getRuntime(), wolves[0].seatId);
    const wolfSeeDivine = wolfViewN1.visibleEvents.find((e) => e.type === 'divine_result');
    assert.equal(wolfSeeDivine, undefined, 'wolf must not see seer divine result');

    // === Phase 4: Day 1 — Vote out wolf ===
    // All alive players vote for wolf (seer's guidance)
    const aliveNonWolf = engine.getRuntime().seats.filter((s) => s.alive && s.role !== 'wolf');
    for (const s of aliveNonWolf) {
      engine.castVote(s.seatId, wolves[0].seatId);
    }
    // Wolves vote for seer
    for (const w of wolves.filter((w) => w.alive)) {
      engine.castVote(w.seatId, seer.seatId);
    }

    const day1 = engine.resolveVotes();
    assert.equal(day1.exiled, wolves[0].seatId, 'wolf should be exiled');
    assert.equal(day1.tied, false);

    // Record last words
    engine.recordLastWords(wolves[0].seatId, 'Good game.');

    // === Phase 5: Night 2 ===
    engine.getRuntime().round = 2;

    // Remaining wolf kills seer
    engine.setNightAction(wolves[1].seatId, 'kill', seer.seatId);
    // Guard protects seer again (but already guarded last night — should be rejected)
    // Actually guard tracked protection via lastGuardTarget, so cannot guard same target
    assert.throws(() => engine.setNightAction(guard.seatId, 'guard', seer.seatId), /cannot guard same target/i);
    // Guard protects witch instead
    engine.setNightAction(guard.seatId, 'guard', witch.seatId);
    // Witch saves seer
    engine.setNightAction(witch.seatId, 'heal', seer.seatId);

    const night2 = engine.resolveNight();
    assert.ok(!night2.deaths.includes(seer.seatId), 'seer saved by witch');

    // === Phase 6: Day 2 — Vote out second wolf ===
    const aliveDay2 = engine.getRuntime().seats.filter((s) => s.alive);
    for (const s of aliveDay2.filter((s) => s.role !== 'wolf')) {
      engine.castVote(s.seatId, wolves[1].seatId);
    }
    engine.castVote(wolves[1].seatId, seer.seatId);

    const day2 = engine.resolveVotes();
    assert.equal(day2.exiled, wolves[1].seatId, 'second wolf exiled');

    // === Phase 7: Win Condition ===
    const winner = engine.checkWinCondition();
    assert.equal(winner, 'village', 'village should win (all wolves dead)');

    // Verify both wolves are dead
    for (const w of wolves) {
      const seat = engine.getRuntime().seats.find((s) => s.seatId === w.seatId);
      assert.equal(seat.alive, false, `${w.seatId} should be dead`);
    }
  });

  it('wolf wins when wolves >= good players', () => {
    const lobby = new WerewolfLobby();
    const runtime = lobby.createLobby({
      threadId: 'thread-wolf-wins',
      playerCount: 9,
      players: makePlayers(9),
    });
    lobby.startGame(runtime);

    const engine = new WerewolfEngine(runtime);
    const _wolves = runtime.seats.filter((s) => s.role === 'wolf');
    const good = runtime.seats.filter((s) => s.role !== 'wolf');

    // Kill good players until wolves >= good
    // Need to kill 5 of 7 good (leave 2 good, 2 wolves)
    for (let i = 0; i < 5; i++) {
      good[i].alive = false;
    }

    const winner = engine.checkWinCondition();
    assert.equal(winner, 'wolf', 'wolves win when >= good count');
  });

  it('dead player isolation — only sees public events after death', () => {
    const lobby = new WerewolfLobby();
    const runtime = lobby.createLobby({
      threadId: 'thread-dead-iso',
      playerCount: 9,
      players: makePlayers(9),
    });
    lobby.startGame(runtime);

    const engine = new WerewolfEngine(runtime);
    const wolves = runtime.seats.filter((s) => s.role === 'wolf');
    const villagers = runtime.seats.filter((s) => s.role === 'villager');

    // Kill a villager
    engine.setNightAction(wolves[0].seatId, 'kill', villagers[0].seatId);
    engine.resolveNight();

    // Add events for round 2
    engine.appendEvent({
      round: 2,
      phase: 'night_wolf',
      type: 'wolf_kill',
      scope: 'faction:wolf',
      payload: { target: villagers[1].seatId },
    });
    engine.appendEvent({
      round: 2,
      phase: 'day_vote',
      type: 'announcement',
      scope: 'public',
      payload: { message: 'Day 2' },
    });

    // Dead villager should only see public events
    const deadView = GameViewBuilder.buildView(engine.getRuntime(), villagers[0].seatId);
    const visibleTypes = deadView.visibleEvents.map((e) => e.type);
    assert.ok(!visibleTypes.includes('wolf_kill'), 'dead player must not see wolf events');
    assert.ok(visibleTypes.includes('announcement'), 'dead player sees public events');
  });
});
