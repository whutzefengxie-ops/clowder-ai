import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertUniqueP0DocumentIds,
  buildP0DocumentId,
  deriveP0Kind,
  deriveP0Status,
  isP0AllowedSourcePath,
  validateP0Tags,
} from '../../dist/domains/cats/services/hindsight-import/p0-contract.js';

test('buildP0DocumentId derives stable ids for ADR paths', () => {
  assert.equal(buildP0DocumentId('docs/decisions/005-hindsight-integration-decisions.md'), 'adr:005');
});

test('buildP0DocumentId falls back to path-based id for non-ADR source', () => {
  assert.equal(buildP0DocumentId('docs/lessons-learned.md'), 'path:docs/lessons-learned.md');
});

test('validateP0Tags rejects missing required governance tags', () => {
  assert.throws(() => validateP0Tags(['project:cat-cafe']), /missing required tag prefix: kind:/);
});

test('validateP0Tags rejects tags missing visibility prefix', () => {
  assert.throws(
    () =>
      validateP0Tags([
        'project:cat-cafe',
        'kind:decision',
        'status:published',
        'author:codex',
        'origin:git',
        'sourcePath:docs/decisions/005-hindsight-integration-decisions.md',
        'sourceCommit:abc1234',
        'anchor:adr:005#final-decision',
      ]),
    /missing required tag prefix: visibility:/,
  );
});

test('assertUniqueP0DocumentIds rejects duplicate ADR ids', () => {
  assert.throws(
    () => assertUniqueP0DocumentIds(['docs/decisions/009-duplicate-a.md', 'docs/decisions/009-duplicate-b.md']),
    /duplicate document_id adr:009/,
  );
});

test('isP0AllowedSourcePath accepts discussion markdown paths', () => {
  assert.equal(isP0AllowedSourcePath('docs/discussions/2026-02-14-sample.md'), true);
});

test('deriveP0Kind and deriveP0Status map discussion source to quarantined lifecycle defaults', () => {
  assert.equal(deriveP0Kind('docs/discussions/2026-02-14-sample.md'), 'discussion');
  assert.equal(deriveP0Status('docs/discussions/2026-02-14-sample.md'), 'draft');
});
