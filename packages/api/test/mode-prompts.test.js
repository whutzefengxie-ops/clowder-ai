/**
 * Mode Prompts Tests (F11 Step 7)
 *
 * Validates brainstorm/debate mode-specific system prompts
 * and mode switch instruction.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildBrainstormPrompt,
  buildDebatePrompt,
  buildModeSwitchInstruction,
} from '../dist/domains/cats/services/modes/mode-prompts.js';

describe('buildBrainstormPrompt', () => {
  const config = {
    topic: 'AI 协作的未来',
    participants: ['opus', 'codex'],
  };

  it('returns round 1 independent thinking prompt when roundOneComplete is false', () => {
    const state = { roundOneComplete: false, currentRound: 1 };
    const prompt = buildBrainstormPrompt(config, state, 'opus');

    assert.ok(prompt.includes('头脑风暴模式'));
    assert.ok(prompt.includes('AI 协作的未来'));
    assert.ok(prompt.includes('第一轮：独立思考'));
    assert.ok(prompt.includes('独立观点'));
    assert.ok(!prompt.includes('第 1 轮：讨论'));
  });

  it('returns round 2+ discussion prompt when roundOneComplete is true', () => {
    const state = { roundOneComplete: true, currentRound: 3 };
    const prompt = buildBrainstormPrompt(config, state, 'opus');

    assert.ok(prompt.includes('第 3 轮：讨论'));
    assert.ok(prompt.includes('回应和讨论'));
    assert.ok(!prompt.includes('独立思考'));
  });

  it('lists all participant display names', () => {
    const state = { roundOneComplete: false, currentRound: 1 };
    const prompt = buildBrainstormPrompt(config, state, 'opus');

    assert.ok(prompt.includes('布偶猫'));
    assert.ok(prompt.includes('缅因猫'));
  });

  it('mentions other cats in discussion round', () => {
    const state = { roundOneComplete: true, currentRound: 2 };
    const prompt = buildBrainstormPrompt(config, state, 'opus');

    // Other participant names should appear in discussion context
    assert.ok(prompt.includes('缅因猫'));
  });
});

describe('buildDebatePrompt', () => {
  const config = {
    topic: 'Monorepo vs Polyrepo',
    catA: 'opus',
    catB: 'codex',
    rounds: 3,
  };

  it('assigns positive side to catA', () => {
    const state = { currentRound: 1, nextSpeaker: 'catA' };
    const prompt = buildDebatePrompt(config, state, 'opus');

    assert.ok(prompt.includes('辩论模式'));
    assert.ok(prompt.includes('Monorepo vs Polyrepo'));
    assert.ok(prompt.includes('正方'));
    assert.ok(prompt.includes('缅因猫')); // opponent
  });

  it('assigns negative side to catB', () => {
    const state = { currentRound: 1, nextSpeaker: 'catA' };
    const prompt = buildDebatePrompt(config, state, 'codex');

    assert.ok(prompt.includes('反方'));
    assert.ok(prompt.includes('布偶猫')); // opponent
  });

  it('shows current round and max rounds', () => {
    const state = { currentRound: 2, nextSpeaker: 'catB' };
    const prompt = buildDebatePrompt(config, state, 'opus');

    assert.ok(prompt.includes('2/3'));
  });

  it('includes debate rules', () => {
    const state = { currentRound: 1, nextSpeaker: 'catA' };
    const prompt = buildDebatePrompt(config, state, 'opus');

    assert.ok(prompt.includes('坚持你的立场'));
    assert.ok(prompt.includes('回应对手'));
  });
});

describe('buildModeSwitchInstruction', () => {
  it('includes @mode: pattern instruction', () => {
    const instruction = buildModeSwitchInstruction();

    assert.ok(instruction.includes('@mode:'));
    assert.ok(instruction.includes('切换'));
  });
});
