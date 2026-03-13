/**
 * WerewolfAIPlayer Tests (F101 Task B5)
 *
 * Tests that AI player produces structurally valid actions.
 * Does NOT test LLM quality — uses a deterministic mock provider.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GameViewBuilder } from '../dist/domains/cats/services/game/GameViewBuilder.js';
import { WerewolfAIPlayer } from '../dist/domains/cats/services/game/werewolf/WerewolfAIPlayer.js';
import { createWerewolfDefinition } from '../dist/domains/cats/services/game/werewolf/WerewolfDefinition.js';
import { buildWerewolfPrompt } from '../dist/domains/cats/services/game/werewolf/werewolf-prompts.js';

function create9pRuntime() {
  const def = createWerewolfDefinition(9);
  return {
    gameId: 'game-ai-test',
    threadId: 'thread-ai',
    gameType: 'werewolf',
    definition: def,
    seats: [
      { seatId: 'P1', actorType: 'cat', actorId: 'opus', role: 'wolf', alive: true, properties: {} },
      { seatId: 'P2', actorType: 'cat', actorId: 'codex', role: 'wolf', alive: true, properties: {} },
      { seatId: 'P3', actorType: 'human', actorId: 'alice', role: 'seer', alive: true, properties: {} },
      { seatId: 'P4', actorType: 'cat', actorId: 'gemini', role: 'witch', alive: true, properties: {} },
      { seatId: 'P5', actorType: 'cat', actorId: 'sonnet', role: 'hunter', alive: true, properties: {} },
      { seatId: 'P6', actorType: 'cat', actorId: 'haiku', role: 'guard', alive: true, properties: {} },
      { seatId: 'P7', actorType: 'human', actorId: 'bob', role: 'villager', alive: true, properties: {} },
      { seatId: 'P8', actorType: 'human', actorId: 'charlie', role: 'villager', alive: true, properties: {} },
      { seatId: 'P9', actorType: 'human', actorId: 'dave', role: 'villager', alive: true, properties: {} },
    ],
    currentPhase: 'night_wolf',
    round: 1,
    eventLog: [],
    pendingActions: {},
    status: 'playing',
    config: { timeoutMs: 30000, voiceMode: false, humanRole: 'player' },
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Mock LLM provider: always returns deterministic action */
function createMockProvider(response) {
  return {
    async generateAction(_prompt, _schema) {
      return response;
    },
    async generateSpeech(_prompt) {
      return response.text ?? 'I have nothing to say.';
    },
  };
}

describe('werewolf-prompts', () => {
  it('builds wolf prompt with faction knowledge', () => {
    const runtime = create9pRuntime();
    const view = GameViewBuilder.buildView(runtime, 'P1');
    const prompt = buildWerewolfPrompt('wolf', view, runtime.round);

    assert.ok(prompt.includes('wolf'), 'prompt should mention wolf role');
    assert.ok(prompt.includes('P2'), 'wolf should know teammate P2');
  });

  it('builds seer prompt without wolf knowledge', () => {
    const runtime = create9pRuntime();
    const view = GameViewBuilder.buildView(runtime, 'P3');
    const prompt = buildWerewolfPrompt('seer', view, runtime.round);

    assert.ok(prompt.includes('seer'), 'prompt should mention seer role');
    // Seer should NOT know wolf identities from prompt alone
    assert.ok(!prompt.includes('wolf: P1'), 'seer should not know wolf identities');
  });

  it('builds villager prompt with only public info', () => {
    const runtime = create9pRuntime();
    const view = GameViewBuilder.buildView(runtime, 'P7');
    const prompt = buildWerewolfPrompt('villager', view, runtime.round);

    assert.ok(prompt.includes('villager'), 'prompt should mention villager role');
  });
});

describe('WerewolfAIPlayer', () => {
  it('wolf produces valid kill action targeting alive non-wolf', async () => {
    const runtime = create9pRuntime();
    const view = GameViewBuilder.buildView(runtime, 'P1');

    const provider = createMockProvider({
      actionName: 'kill',
      targetSeat: 'P7',
    });

    const aiPlayer = new WerewolfAIPlayer(provider);
    const action = await aiPlayer.decideNightAction('P1', 'wolf', view, runtime.round);

    assert.equal(action.actionName, 'kill');
    assert.equal(action.targetSeat, 'P7');
    assert.ok(action.seatId, 'should include seatId');
  });

  it('guard produces valid guard action', async () => {
    const runtime = create9pRuntime();
    const view = GameViewBuilder.buildView(runtime, 'P6');

    const provider = createMockProvider({
      actionName: 'guard',
      targetSeat: 'P3',
    });

    const aiPlayer = new WerewolfAIPlayer(provider);
    const action = await aiPlayer.decideNightAction('P6', 'guard', view, runtime.round);

    assert.equal(action.actionName, 'guard');
    assert.equal(action.targetSeat, 'P3');
  });

  it('produces speech text for discussion phase', async () => {
    const runtime = create9pRuntime();
    runtime.currentPhase = 'day_discuss';
    const view = GameViewBuilder.buildView(runtime, 'P1');

    const provider = createMockProvider({
      text: 'I think P7 is suspicious because they were quiet last night.',
    });

    const aiPlayer = new WerewolfAIPlayer(provider);
    const speech = await aiPlayer.decideSpeech('P1', 'wolf', view, runtime.round);

    assert.equal(typeof speech, 'string');
    assert.ok(speech.length > 0, 'speech should not be empty');
  });

  it('produces vote action for day vote phase', async () => {
    const runtime = create9pRuntime();
    runtime.currentPhase = 'day_vote';
    const view = GameViewBuilder.buildView(runtime, 'P1');

    const provider = createMockProvider({
      actionName: 'vote',
      targetSeat: 'P7',
    });

    const aiPlayer = new WerewolfAIPlayer(provider);
    const action = await aiPlayer.decideVote('P1', 'wolf', view, runtime.round);

    assert.equal(action.actionName, 'vote');
    assert.equal(action.targetSeat, 'P7');
  });
});
