/**
 * Image Path Extraction
 * Extracts absolute file paths from MessageContent blocks for CLI passthrough.
 */

import { resolve } from 'node:path';
import type { MessageContent } from '@cat-cafe/shared';

const DEFAULT_UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';

/**
 * Extract absolute image file paths from contentBlocks.
 * Converts relative URL paths (/uploads/foo.png) to absolute filesystem paths.
 * @param uploadDir Override for the upload directory (defaults to UPLOAD_DIR env or './uploads')
 */
export function extractImagePaths(contentBlocks: readonly MessageContent[] | undefined, uploadDir?: string): string[] {
  if (!contentBlocks) return [];

  const paths: string[] = [];
  for (const block of contentBlocks) {
    if (block.type !== 'image') continue;
    const url = block.url;
    if (url.startsWith('/uploads/')) {
      const filename = url.slice('/uploads/'.length);
      paths.push(resolve(uploadDir ?? DEFAULT_UPLOAD_DIR, filename));
    } else if (url.startsWith('/')) {
      paths.push(resolve(url));
    }
  }
  return paths;
}
