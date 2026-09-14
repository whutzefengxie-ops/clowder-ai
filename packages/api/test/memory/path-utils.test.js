// Shared path helpers — regression coverage requested by the upstream review on #1451:
// containment must follow native (win32 case/drive) semantics, and separator conversion must not
// rewrite a literal backslash that is legal in POSIX filenames.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, it } from 'node:test';

describe('path-utils', () => {
  const load = async () => import('../../dist/domains/memory/path-utils.js');

  it('toPosixPath converts separators only where the platform uses them', async () => {
    const { toPosixPath } = await load();

    if (sep === '\\') {
      assert.equal(toPosixPath('foo\\bar.md'), 'foo/bar.md');
      assert.equal(toPosixPath('docs\\a\\b.md'), 'docs/a/b.md');
      assert.equal(toPosixPath('foo/bar.md'), 'foo/bar.md', 'already-POSIX input is unchanged');
    } else {
      assert.equal(toPosixPath('foo/bar.md'), 'foo/bar.md');
      // A literal backslash is a legal POSIX filename character: rewriting it collapsed `foo/bar.md`
      // and the distinct file `foo\bar.md` onto one canonical identity.
      assert.equal(toPosixPath('foo\\bar.md'), 'foo\\bar.md');
      assert.notEqual(toPosixPath('foo/bar.md'), toPosixPath('foo\\bar.md'), 'must not collide');
      // ...and a literal `..\name.md` filename must not turn into a traversal-looking path.
      assert.equal(toPosixPath('..\\name.md'), '..\\name.md');
    }
  });

  it('isPathInside follows native containment semantics', async () => {
    const { isPathInside } = await load();
    const dir = mkdtempSync(join(tmpdir(), 'path-utils-'));
    try {
      const root = resolve(dir, 'b');
      assert.equal(isPathInside(root, root), true, 'root contains itself');
      assert.equal(isPathInside(root, resolve(root, 'c')), true, 'direct child');
      assert.equal(isPathInside(root, resolve(root, 'c', 'd')), true, 'nested child');
      assert.equal(isPathInside(root, resolve(root, '..foo')), true, 'child literally named ..foo');
      assert.equal(isPathInside(root, resolve(dir, 'bc')), false, 'same-prefix sibling');
      assert.equal(isPathInside(root, resolve(dir, '..')), false, 'parent');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('isPathInside delegates win32 case/drive semantics to the platform', async () => {
    const { isPathInside } = await load();

    if (process.platform === 'win32') {
      // win32 paths are case-insensitive: the old string-prefix check missed this and skipped the
      // child exclude, re-indexing child documents into the parent collection.
      assert.equal(isPathInside('C:\\Project', 'c:\\project\\docs\\secret.md'), true);
      assert.equal(isPathInside('C:\\a', 'D:\\b'), false, 'different drive is not containment');
    } else {
      // POSIX is case-sensitive, so the same call must NOT be reported as containment.
      assert.equal(isPathInside('/tmp/Project', '/tmp/project/docs/secret.md'), false);
    }
  });
});
