import { dirname } from 'node:path';

/**
 * Build prompt hints for local image paths.
 * These are path references for tool access, not binary attachments.
 */
export function buildLocalImagePathHints(imagePaths: readonly string[]): string {
  if (imagePaths.length === 0) return '';
  return imagePaths.map((p) => `[Local image path: ${p}]`).join('\n');
}

/**
 * Append local image path hints to an existing prompt.
 */
export function appendLocalImagePathHints(prompt: string, imagePaths: readonly string[]): string {
  const hints = buildLocalImagePathHints(imagePaths);
  if (!hints) return prompt;
  return `${prompt}\n\n${hints}`;
}

/**
 * Extract unique directory list from image paths for CLI workspace include flags.
 */
export function collectImageAccessDirectories(imagePaths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const imagePath of imagePaths) {
    const dir = dirname(imagePath);
    if (seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out;
}
