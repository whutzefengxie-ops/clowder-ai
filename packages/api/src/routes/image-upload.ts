/**
 * Image Upload Utilities
 * Handles multipart file saving and validation for image uploads.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ImageContent } from '@cat-cafe/shared';

const ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;

export interface SavedImage {
  absPath: string;
  urlPath: string;
  content: ImageContent;
}

export interface UploadImageFile {
  filename?: string;
  mimetype: string;
  toBuffer: () => Promise<Buffer>;
}

/**
 * Validate and save uploaded image files.
 * Returns saved image metadata for contentBlocks and CLI passthrough.
 */
export async function saveUploadedImages(files: UploadImageFile[], uploadDir: string): Promise<SavedImage[]> {
  if (files.length > MAX_FILES) {
    throw new ImageUploadError(`Too many files (max ${MAX_FILES})`);
  }

  await mkdir(uploadDir, { recursive: true });

  const saved: SavedImage[] = [];
  for (const file of files) {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new ImageUploadError(`Unsupported file type: ${file.mimetype}`);
    }

    const buffer = await file.toBuffer();
    if (buffer.byteLength > MAX_FILE_SIZE) {
      throw new ImageUploadError(`File too large: ${buffer.byteLength} bytes (max ${MAX_FILE_SIZE})`);
    }

    // SECURITY: derive extension from validated MIME only, never trust filename
    const ext = mimeToExt(file.mimetype);
    const filename = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
    const absPath = resolve(join(uploadDir, filename));

    await writeFile(absPath, buffer);

    saved.push({
      absPath,
      urlPath: `/uploads/${filename}`,
      content: { type: 'image', url: `/uploads/${filename}` },
    });
  }

  return saved;
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    default:
      return '.bin';
  }
}

export class ImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageUploadError';
  }
}
