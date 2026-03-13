import assert from 'node:assert/strict';
import test from 'node:test';

const { appendLocalImagePathHints, buildLocalImagePathHints, collectImageAccessDirectories } = await import(
  '../dist/domains/cats/services/agents/providers/image-cli-bridge.js'
);

test('buildLocalImagePathHints returns empty string for no images', () => {
  assert.equal(buildLocalImagePathHints([]), '');
});

test('buildLocalImagePathHints formats local path lines', () => {
  const result = buildLocalImagePathHints(['/tmp/a.png', '/tmp/b.jpg']);
  assert.equal(result, '[Local image path: /tmp/a.png]\n[Local image path: /tmp/b.jpg]');
});

test('appendLocalImagePathHints appends hints after prompt', () => {
  const result = appendLocalImagePathHints('describe', ['/tmp/a.png']);
  assert.equal(result, 'describe\n\n[Local image path: /tmp/a.png]');
});

test('collectImageAccessDirectories deduplicates by parent directory', () => {
  const dirs = collectImageAccessDirectories(['/tmp/images/a.png', '/tmp/images/b.png', '/tmp/other/c.jpg']);
  assert.deepEqual(dirs, ['/tmp/images', '/tmp/other']);
});
