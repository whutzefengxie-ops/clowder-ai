// Shared path helpers for memory identifiers.
//
// Collection anchors, `sourcePath` values and `exclude` globs are POSIX-style identifiers:
// `matchGlob` only understands `/`, and consumers such as readCanonicalProjectDocument() and
// classifyTasteSourcePath() explicitly reject any sourcePath containing `\`. `path.relative`
// returns `\` on Windows, so every boundary that turns a filesystem path into such an identifier
// must normalize first — otherwise `exclude` silently stops working (a user-excluded directory
// keeps being scanned, which can trip the fail-closed secret purge) and anchors drift per platform.
//
// The same separator assumption breaks containment checks: `child.startsWith(parent + '/')` is
// always false on Windows, so callers must use isPathInside() instead.

import { sep } from 'node:path';

/** Convert a platform-native relative path into the POSIX-style identifier contract. */
export function toPosixPath(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

/**
 * True when `candidate` is `root` itself or nested inside it. Both paths must come from the same
 * platform-native producer (`resolve`/`realpath`); comparing native-to-native with `sep` keeps the
 * check correct on win32, where a plain `${root}/` prefix never matches.
 */
export function isPathInside(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate.startsWith(prefix);
}
