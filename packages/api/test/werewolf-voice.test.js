/**
 * Werewolf Voice Mode Tests (F101 Task B7)
 *
 * When config.voiceMode = true, AI speech output wraps in audio rich block.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GameViewBuilder } from '../dist/domains/cats/services/game/GameViewBuilder.js';
import { WerewolfAIPlayer } from '../dist/domains/cats/services/game/werewolf/WerewolfAIPlayer.js';
import { createWerewolfDefinition } from '../dist/domains/cats/services/game/werewolf/WerewolfDefinition.js';

function create4pRuntime(voiceMode) {
  const def = createWerewolfDefinition(6);
  return {
    gameId: 'game-voice-test',
    threadId: 'thread-voice',
    gameType: 'werewolf',
    definition: def,
    seats: [
      { seatId: 'P1', actorType: 'cat', actorId: 'opus', role: 'wolf', alive: true, properties: {} },
      { seatId: 'P2', actorType: 'human', actorId: 'alice', role: 'villager', alive: true, properties: {} },
      { seatId: 'P3', actorType: 'cat', actorId: 'codex', role: 'seer', alive: true, properties: {} },
      { seatId: 'P4', actorType: 'cat', actorId: 'gemini', role: 'witch', alive: true, properties: {} },
      { seatId: 'P5', actorType: 'cat', actorId: 'sonnet', role: 'villager', alive: true, properties: {} },
      { seatId: 'P6', actorType: 'cat', actorId: 'haiku', role: 'villager', alive: true, properties: {} },
    ],
    currentPhase: 'day_discuss',
    round: 1,
    eventLog: [],
    pendingActions: {},
    status: 'playing',
    config: { timeoutMs: 30000, voiceMode, humanRole: 'player' },
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createMockProvider(text) {
  return {
    async generateAction() {
      return { actionName: 'vote', targetSeat: 'P2' };
    },
    async generateSpeech() {
      return text;
    },
  };
}

describe('Werewolf Voice Mode', () => {
  it('voiceMode=true: decideSpeechWithFormat returns audio rich block', async () => {
    const runtime = create4pRuntime(true);
    const view = GameViewBuilder.buildView(runtime, 'P1');
    const provider = createMockProvider('I think P2 is suspicious.');
    const aiPlayer = new WerewolfAIPlayer(provider);

    const result = await aiPlayer.decideSpeechWithFormat('P1', 'wolf', view, runtime.round, true);

    assert.equal(result.kind, 'audio', 'should be audio rich block');
    assert.equal(result.text, 'I think P2 is suspicious.');
    assert.equal(result.seatId, 'P1');
  });

  it('voiceMode=false: decideSpeechWithFormat returns text rich block', async () => {
    const runtime = create4pRuntime(false);
    const view = GameViewBuilder.buildView(runtime, 'P1');
    const provider = createMockProvider('I think P2 is suspicious.');
    const aiPlayer = new WerewolfAIPlayer(provider);

    const result = await aiPlayer.decideSpeechWithFormat('P1', 'wolf', view, runtime.round, false);

    assert.equal(result.kind, 'text', 'should be text block');
    assert.equal(result.text, 'I think P2 is suspicious.');
  });
});
