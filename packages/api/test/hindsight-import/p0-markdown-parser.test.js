import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasHindsightIncludeDirective,
  splitByLevel2Headings,
  stripMarkdownFrontmatter,
} from '../../dist/domains/cats/services/hindsight-import/p0-markdown-parser.js';

test('hasHindsightIncludeDirective returns true when frontmatter sets hindsight: include', () => {
  const content = ['---', 'title: discussion sample', 'hindsight: include', '---', '', '# Discussion'].join('\n');

  assert.equal(hasHindsightIncludeDirective(content), true);
});

test('hasHindsightIncludeDirective returns false without include marker', () => {
  const noFrontmatter = '# Discussion\nBody';
  assert.equal(hasHindsightIncludeDirective(noFrontmatter), false);

  const otherMarker = ['---', 'title: discussion sample', 'hindsight: skip', '---', '', '# Discussion'].join('\n');
  assert.equal(hasHindsightIncludeDirective(otherMarker), false);
});

test('stripMarkdownFrontmatter removes YAML header from markdown body', () => {
  const content = [
    '---',
    'title: discussion sample',
    'hindsight: include',
    '---',
    '',
    '# Discussion',
    'Body line',
  ].join('\n');

  const stripped = stripMarkdownFrontmatter(content);
  assert.equal(stripped.startsWith('---'), false);
  assert.ok(stripped.includes('# Discussion'));
  assert.ok(stripped.includes('Body line'));
});

test('splitByLevel2Headings filters by heading allowlist', () => {
  const content = [
    '# ADR',
    '',
    '## 背景',
    '这是背景段落。',
    '',
    '## 参考',
    '这里是低价值参考信息。',
    '',
    '## Decision',
    'Keep this section.',
  ].join('\n');

  const sections = splitByLevel2Headings(content, {
    headingAllowlist: ['背景', 'decision'],
  });

  assert.deepEqual(
    sections.map((section) => section.heading),
    ['背景', 'Decision'],
  );
});

test('splitByLevel2Headings filters by minChunkContentLength', () => {
  const content = [
    '# ADR',
    '',
    '## 决策',
    '日期：2026-02-14',
    '',
    '## 后果',
    '这个后果段落包含足够长的说明内容，用于验证最小长度过滤逻辑不会误删正常段落。',
    '它继续补充细节，确保超过阈值。',
    '详细说明'.repeat(40),
  ].join('\n');

  const sections = splitByLevel2Headings(content, {
    headingAllowlist: ['决策', '后果'],
    minChunkContentLength: 120,
  });

  assert.deepEqual(
    sections.map((section) => section.heading),
    ['后果'],
  );
});
