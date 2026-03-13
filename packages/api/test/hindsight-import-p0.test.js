import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildImportItemsFromMarkdown,
  buildP0RetainOptions,
} from '../dist/domains/cats/services/hindsight-import/p0-importer.js';

test('buildImportItemsFromMarkdown emits ADR retain items with required tags', () => {
  const items = buildImportItemsFromMarkdown({
    sourcePath: 'docs/decisions/005-hindsight-integration-decisions.md',
    sourceCommit: 'abc1234',
    author: 'codex',
    content: [
      '# ADR-005 Hindsight Integration Decisions',
      '',
      '## 问题1：是否启用 Hindsight',
      '结论：启用。',
      '为了保证决策可追溯，这里补充完整背景、替代方案评估和风险控制说明，确保段落长度超过最小导入阈值。',
      '我们需要统一配置来源、故障处理策略以及观测指标，否则后续回溯时会缺少关键证据。',
      '补充说明'.repeat(30),
      '',
      '## 问题2：使用单一 shared bank',
      '结论：使用单一 shared bank。',
      '这里补充为什么不用多 bank 方案：单一 bank 可以保持检索入口一致，减少调用方拼接标签策略的复杂度。',
      '同时记录迁移步骤和回滚预案，避免后续治理阶段出现语义分裂。',
      '补充说明'.repeat(30),
    ].join('\n'),
  });

  assert.ok(items.length >= 2);
  assert.ok(items[0].tags.some((tag) => tag.startsWith('project:cat-cafe')));
  assert.ok(items[0].tags.some((tag) => tag.startsWith('kind:')));
  assert.ok(items[0].tags.some((tag) => tag.startsWith('status:')));
  assert.ok(items[0].tags.some((tag) => tag.startsWith('author:')));
  assert.ok(items[0].tags.some((tag) => tag.startsWith('origin:git')));
  assert.ok(items[0].tags.some((tag) => tag.startsWith('sourcePath:')));
  assert.ok(items[0].tags.some((tag) => tag.startsWith('sourceCommit:')));
  assert.ok(items[0].tags.some((tag) => tag.startsWith('anchor:adr:005#')));
  assert.equal(items[0].document_id, 'adr:005');
});

test('buildImportItemsFromMarkdown keeps only high-signal ADR sections and skips short chunks', () => {
  const items = buildImportItemsFromMarkdown({
    sourcePath: 'docs/decisions/011-sample.md',
    sourceCommit: 'abc1234',
    author: 'codex',
    content: [
      '# ADR-011 Sample',
      '',
      '## 背景',
      '这是一段足够长的背景描述，用于验证白名单过滤和最小长度过滤。',
      '它包含实现前提、目标和约束，确保内容长度超过 120 字符阈值，应该被导入。',
      '另外补充历史上下文、约束边界和失败案例，避免由于文本长度不足导致该段被阈值误过滤。',
      '背景延展'.repeat(30),
      '',
      '## 状态',
      'accepted',
      '',
      '## Decision',
      'This decision section is intentionally long enough to pass the minimum content length threshold.',
      'It documents the chosen approach and rationale in detail, so it must be imported.',
      'Decision extension '.repeat(20),
      '',
      '## References',
      '- docs/a.md',
      '',
      '## 后果',
      '短后果。',
    ].join('\n'),
  });

  assert.deepEqual(
    items.map((item) => item.metadata?.heading),
    ['背景', 'Decision'],
  );
});

test('buildImportItemsFromMarkdown imports only LL entries from lessons-learned.md', () => {
  const items = buildImportItemsFromMarkdown({
    sourcePath: 'docs/lessons-learned.md',
    sourceCommit: 'abc1234',
    author: 'codex',
    content: [
      '# Lessons Learned',
      '',
      '## 1) 模板',
      '这里是模板，不应导入。',
      '',
      '### LL-101: 第一条教训',
      '- 状态：draft',
      '- 来源锚点：`docs/a.md#L1` | `docs/b.md#L2`',
      '- 关联：LL-001 | docs/x.md',
      '',
      '### LL-102: 第二条教训',
      '- 状态：validated',
      '- 来源锚点：`docs/c.md#L9`',
      '- 关联：LL-050',
      '',
      '## 8) 维护约定',
      '这里也不应导入。',
    ].join('\n'),
  });

  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.tags.some((tag) => tag.startsWith('anchor:ll:'))));

  const first = items[0];
  assert.equal(first.metadata?.status, 'draft');
  assert.deepEqual(JSON.parse(first.metadata?.sourceAnchors ?? '[]'), ['docs/a.md#L1', 'docs/b.md#L2']);
  assert.deepEqual(JSON.parse(first.metadata?.related ?? '[]'), ['LL-001', 'docs/x.md']);
  assert.equal(
    (first.content.match(/LL-101: 第一条教训/g) ?? []).length,
    1,
    'lesson heading must not be duplicated in content',
  );

  const second = items[1];
  assert.equal(second.metadata?.status, 'validated');
  assert.deepEqual(JSON.parse(second.metadata?.sourceAnchors ?? '[]'), ['docs/c.md#L9']);
});

test('buildP0RetainOptions enables async retain and strips anchor tags from document_tags', () => {
  const options = buildP0RetainOptions(['project:cat-cafe', 'kind:decision', 'anchor:adr:005#foo', 'origin:git']);

  assert.equal(options.async, true);
  assert.deepEqual(options.document_tags, ['project:cat-cafe', 'kind:decision', 'origin:git']);
});

test('buildImportItemsFromMarkdown imports discussion with hindsight: include using quarantined lifecycle tags', () => {
  const items = buildImportItemsFromMarkdown({
    sourcePath: 'docs/discussions/2026-02-14-sample.md',
    sourceCommit: 'abc1234',
    author: 'codex',
    content: ['---', 'hindsight: include', '---', '', '# Discussion', '', '## 临时执行规则', '这里是讨论结论。'].join(
      '\n',
    ),
  });

  assert.equal(items.length, 1);
  const first = items[0];
  assert.ok(first.tags.some((tag) => tag === 'kind:discussion'));
  assert.ok(first.tags.some((tag) => tag === 'status:draft'));
  assert.ok(first.tags.some((tag) => tag === 'origin:discussion'));
  assert.ok(first.tags.some((tag) => tag === 'visibility:quarantined'));
  assert.equal(first.content.includes('hindsight: include'), false);
  assert.equal(first.content.startsWith('---'), false);
});

test('buildImportItemsFromMarkdown rejects discussion source without hindsight: include marker', () => {
  assert.throws(
    () =>
      buildImportItemsFromMarkdown({
        sourcePath: 'docs/discussions/2026-02-14-sample.md',
        sourceCommit: 'abc1234',
        author: 'codex',
        content: ['---', 'hindsight: skip', '---', '', '# Discussion', '', '## 临时执行规则', '这里是讨论结论。'].join(
          '\n',
        ),
      }),
    /discussion source must include frontmatter marker hindsight: include/,
  );
});
