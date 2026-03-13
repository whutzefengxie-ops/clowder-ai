/**
 * Dev-Loop Parser Tests
 *
 * parseReviewResult: APPROVED / NEEDS_FIX / mixed P levels / no VERDICT fallback
 * buildDevLoopSummary: with P3 / without P3 / multi-iteration
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDevLoopSummary, parseReviewResult } from '../dist/domains/cats/services/modes/dev-loop-parser.js';

describe('parseReviewResult', () => {
  it('extracts APPROVED verdict', () => {
    const text = 'Looks good!\n\nVERDICT: APPROVED';
    const result = parseReviewResult(text);
    assert.equal(result.approved, true);
    assert.equal(result.p1.length, 0);
    assert.equal(result.p2.length, 0);
    assert.equal(result.p3.length, 0);
  });

  it('extracts NEEDS_FIX verdict with P1/P2 issues', () => {
    const text = [
      '[P1] Missing error handling in save()',
      '[P2] Variable naming inconsistent',
      '[P3] Consider adding JSDoc',
      '',
      'VERDICT: NEEDS_FIX',
    ].join('\n');
    const result = parseReviewResult(text);
    assert.equal(result.approved, false);
    assert.deepEqual(result.p1, ['Missing error handling in save()']);
    assert.deepEqual(result.p2, ['Variable naming inconsistent']);
    assert.deepEqual(result.p3, ['Consider adding JSDoc']);
  });

  it('handles multiple P items of same level', () => {
    const text = ['[P1] Bug A', '[P1] Bug B', '[P2] Issue C', 'VERDICT: NEEDS_FIX'].join('\n');
    const result = parseReviewResult(text);
    assert.equal(result.p1.length, 2);
    assert.equal(result.p2.length, 1);
    assert.equal(result.approved, false);
  });

  it('fallback: no VERDICT but has P1 → not approved', () => {
    const text = '[P1] Critical bug\nNo verdict line here.';
    const result = parseReviewResult(text);
    assert.equal(result.approved, false);
    assert.deepEqual(result.p1, ['Critical bug']);
  });

  it('fail-closed: no VERDICT + substantial text → not approved', () => {
    const text = 'Everything looks fine.\n[P3] Minor style nit';
    const result = parseReviewResult(text);
    // Fail-closed: substantial text without explicit VERDICT → not approved
    assert.equal(result.approved, false);
    assert.deepEqual(result.p3, ['Minor style nit']);
  });

  it('case-insensitive VERDICT matching', () => {
    const text = 'verdict: approved';
    const result = parseReviewResult(text);
    assert.equal(result.approved, true);
  });

  it('empty text → not approved (no VERDICT = fail-closed)', () => {
    const result = parseReviewResult('');
    assert.equal(result.approved, false);
    assert.equal(result.p1.length, 0);
  });

  it('parses markdown list format: - [P1] text', () => {
    const text = [
      '- [P1] Missing error handling',
      '- [P2] Naming inconsistent',
      '- [P3] Consider docs',
      '',
      'VERDICT: NEEDS_FIX',
    ].join('\n');
    const result = parseReviewResult(text);
    assert.equal(result.approved, false);
    assert.deepEqual(result.p1, ['Missing error handling']);
    assert.deepEqual(result.p2, ['Naming inconsistent']);
    assert.deepEqual(result.p3, ['Consider docs']);
  });

  it('parses backtick-wrapped format: `[P1]` text', () => {
    const text = '`[P1]` Critical bug\nVERDICT: NEEDS_FIX';
    const result = parseReviewResult(text);
    assert.equal(result.approved, false);
    assert.deepEqual(result.p1, ['Critical bug']);
  });

  it('parses numbered list format: 1. [P1] text', () => {
    const text = '1. [P1] Bug A\n2. [P2] Issue B\nVERDICT: NEEDS_FIX';
    const result = parseReviewResult(text);
    assert.deepEqual(result.p1, ['Bug A']);
    assert.deepEqual(result.p2, ['Issue B']);
  });

  it('fail-closed: long text without VERDICT or P items → not approved', () => {
    const text = 'The code has serious issues with error handling and needs significant rework.';
    const result = parseReviewResult(text);
    assert.equal(result.approved, false);
  });

  it('short text without VERDICT → not approved (fail-closed)', () => {
    const text = 'OK';
    const result = parseReviewResult(text);
    assert.equal(result.approved, false);
  });

  it('negative short text without VERDICT → not approved', () => {
    const text = '需要修复';
    const result = parseReviewResult(text);
    assert.equal(result.approved, false);
  });

  it('multi-VERDICT: APPROVED then NEEDS_FIX → NOT approved (R4 P1-2)', () => {
    const text = [
      'First pass: everything looks good',
      'VERDICT: APPROVED',
      '',
      'Wait, found more issues:',
      'VERDICT: NEEDS_FIX',
    ].join('\n');
    const result = parseReviewResult(text);
    assert.equal(result.approved, false, 'any NEEDS_FIX should override earlier APPROVED');
  });

  it('multi-VERDICT: NEEDS_FIX then APPROVED → NOT approved (R4 P1-2)', () => {
    const text = ['VERDICT: NEEDS_FIX', 'Actually after re-review:', 'VERDICT: APPROVED'].join('\n');
    const result = parseReviewResult(text);
    assert.equal(result.approved, false, 'any NEEDS_FIX anywhere → fail-closed');
  });

  it('multi-VERDICT: all APPROVED → approved (R4 P1-2)', () => {
    const text = ['Section 1: VERDICT: APPROVED', 'Section 2: VERDICT: APPROVED'].join('\n');
    const result = parseReviewResult(text);
    assert.equal(result.approved, true, 'all APPROVED → approved');
  });

  it('VERDICT: APPROVED with P1 items → NOT approved (P1 overrides)', () => {
    const text = '[P1] critical bug\nVERDICT: APPROVED';
    const result = parseReviewResult(text);
    assert.equal(result.approved, false, 'P1 items must override APPROVED verdict');
    assert.deepEqual(result.p1, ['critical bug']);
  });

  it('VERDICT: APPROVED with P2 items → NOT approved (P2 overrides)', () => {
    const text = '[P2] naming issue\nVERDICT: APPROVED';
    const result = parseReviewResult(text);
    assert.equal(result.approved, false, 'P2 items must override APPROVED verdict');
    assert.deepEqual(result.p2, ['naming issue']);
  });

  it('VERDICT: APPROVED with only P3 items → approved (P3 does not block)', () => {
    const text = '[P3] minor style nit\nVERDICT: APPROVED';
    const result = parseReviewResult(text);
    assert.equal(result.approved, true, 'P3 alone should not block approval');
    assert.deepEqual(result.p3, ['minor style nit']);
  });
});

describe('buildDevLoopSummary', () => {
  it('generates summary with P3 issues', () => {
    const config = { requirement: 'Add login', leadCat: 'opus', reviewCat: 'codex' };
    const summary = buildDevLoopSummary(config, 2, ['Consider caching', 'Add docs']);
    assert.ok(summary.includes('开发自闭环完成'));
    assert.ok(summary.includes('Add login'));
    assert.ok(summary.includes('2 轮'));
    assert.ok(summary.includes('2 个 P3'));
    assert.ok(summary.includes('Consider caching'));
    assert.ok(summary.includes('Add docs'));
  });

  it('generates summary without P3 issues', () => {
    const config = { requirement: 'Fix bug', leadCat: 'opus', reviewCat: 'codex' };
    const summary = buildDevLoopSummary(config, 1, []);
    assert.ok(summary.includes('Fix bug'));
    assert.ok(summary.includes('1 轮'));
    assert.ok(summary.includes('无 P3'));
    assert.ok(!summary.includes('待owner'));
  });

  it('includes cat info', () => {
    const config = { requirement: 'Test', leadCat: 'gemini', reviewCat: 'opus' };
    const summary = buildDevLoopSummary(config, 3, []);
    assert.ok(summary.includes('@gemini'));
    assert.ok(summary.includes('@opus'));
  });
});
