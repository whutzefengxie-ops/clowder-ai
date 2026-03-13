export const P0_ADR_PATH_RE = /^docs\/decisions\/(\d{3})-[^/]+\.md$/;
export const P0_DISCUSSION_PATH_RE = /^docs\/discussions\/.+\.md$/;
export const P0_LESSONS_PATH = 'docs/lessons-learned.md';
export const P0_CLAUDE_PATH = 'CLAUDE.md';
export const P0_AGENTS_PATH = 'AGENTS.md';

export const P0_PROJECT_TAG = 'project:cat-cafe';

export const P0_REQUIRED_TAG_PREFIXES = [
  'project:',
  'kind:',
  'status:',
  'visibility:',
  'author:',
  'origin:',
  'sourcePath:',
  'sourceCommit:',
  'anchor:',
] as const;

export function normalizeSourcePath(input: string): string {
  return input
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/');
}

export function isP0AllowedSourcePath(sourcePath: string): boolean {
  const normalized = normalizeSourcePath(sourcePath);
  if (normalized === P0_CLAUDE_PATH || normalized === P0_AGENTS_PATH || normalized === P0_LESSONS_PATH) return true;
  return P0_ADR_PATH_RE.test(normalized) || P0_DISCUSSION_PATH_RE.test(normalized);
}

export function isP0DiscussionSourcePath(sourcePath: string): boolean {
  const normalized = normalizeSourcePath(sourcePath);
  return P0_DISCUSSION_PATH_RE.test(normalized);
}

export function buildP0DocumentId(sourcePath: string): string {
  const normalized = normalizeSourcePath(sourcePath);
  const adrMatch = normalized.match(P0_ADR_PATH_RE);
  if (adrMatch) return `adr:${adrMatch[1]}`;
  return `path:${normalized}`;
}

export function assertUniqueP0DocumentIds(sourcePaths: string[]): void {
  const seen = new Map<string, string>();
  for (const sourcePath of sourcePaths) {
    const normalized = normalizeSourcePath(sourcePath);
    const documentId = buildP0DocumentId(normalized);
    const existing = seen.get(documentId);
    if (existing && existing !== normalized) {
      throw new Error(`duplicate document_id ${documentId}: ${existing} vs ${normalized}`);
    }
    seen.set(documentId, normalized);
  }
}

export function deriveP0Kind(sourcePath: string): string {
  const normalized = normalizeSourcePath(sourcePath);
  if (normalized.startsWith('docs/decisions/')) return 'decision';
  if (normalized.startsWith('docs/discussions/')) return 'discussion';
  if (normalized === P0_LESSONS_PATH) return 'lesson';
  if (normalized === P0_CLAUDE_PATH || normalized === P0_AGENTS_PATH) return 'guide';
  return 'doc';
}

export function deriveP0Status(sourcePath: string): string {
  const normalized = normalizeSourcePath(sourcePath);
  if (normalized.startsWith('docs/decisions/')) return 'published';
  if (normalized.startsWith('docs/discussions/')) return 'draft';
  if (normalized === P0_CLAUDE_PATH || normalized === P0_AGENTS_PATH) return 'published';
  return 'draft';
}

export function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[`~!@#$%^&*()+={}[\]|\\:;"'<>,.?/]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeLessonId(lessonId: string): string {
  const match = lessonId.toUpperCase().match(/^LL-(\d{3})$/);
  if (!match) return lessonId.toLowerCase();
  return match[1] ?? lessonId.toLowerCase();
}

export function buildP0Anchor(sourcePath: string, heading: string, lessonId?: string): string {
  const normalized = normalizeSourcePath(sourcePath);
  const headingSlug = slugifyHeading(heading);

  const adrMatch = normalized.match(P0_ADR_PATH_RE);
  if (adrMatch) return `adr:${adrMatch[1]}#${headingSlug}`;

  if (normalized === P0_LESSONS_PATH && lessonId) return `ll:${normalizeLessonId(lessonId)}`;

  return `section:${headingSlug}`;
}

export function validateP0Tags(tags: string[]): void {
  const normalized = tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  for (const prefix of P0_REQUIRED_TAG_PREFIXES) {
    if (!normalized.some((tag) => tag.startsWith(prefix))) {
      throw new Error(`missing required tag prefix: ${prefix}`);
    }
  }
}
