export interface MarkdownSection {
  heading: string;
  content: string;
}

export type HeadingAllowlistMatcher = string | RegExp;

export interface SplitByLevel2HeadingsOptions {
  headingAllowlist?: HeadingAllowlistMatcher[];
  minChunkContentLength?: number;
}

export interface LessonsEntry {
  id: string;
  title: string;
  body: string;
  status: string;
  sourceAnchors: string[];
  related: string[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const HINDSIGHT_INCLUDE_RE = /^hindsight:\s*['"]?include['"]?\s*$/im;

function extractFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: null, body: content };
  }

  return {
    frontmatter: match[1] ?? null,
    body: content.slice(match[0].length),
  };
}

export function hasHindsightIncludeDirective(content: string): boolean {
  const { frontmatter } = extractFrontmatter(content);
  if (!frontmatter) return false;
  return HINDSIGHT_INCLUDE_RE.test(frontmatter);
}

export function stripMarkdownFrontmatter(content: string): string {
  const { body } = extractFrontmatter(content);
  return body;
}

function parseStatusFromBlock(block: string): string {
  const match = block.match(/^- 状态：\s*(draft|validated|archived)\b/m);
  return match?.[1] ?? 'draft';
}

function parseBacktickedValues(line: string): string[] {
  return Array.from(line.matchAll(/`([^`]+)`/g))
    .map((m) => m[1]?.trim() ?? '')
    .filter((v) => v.length > 0);
}

function parsePipeValues(line: string): string[] {
  return line
    .split('|')
    .map((part) => part.trim())
    .map((part) => part.replace(/^`|`$/g, '').trim())
    .filter((part) => part.length > 0);
}

function collectFieldValues(lines: string[], startIndex: number): string[] {
  const values: string[] = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (i > startIndex && /^- /.test(line)) break;
    if (i > startIndex && !/^\s*-\s+/.test(line) && line.trim() !== '') break;

    const backticked = parseBacktickedValues(line);
    values.push(...backticked);

    if (backticked.length === 0 && line.includes('|')) {
      const rightSide = line.includes('：') ? line.split('：').slice(1).join('：') : line;
      values.push(...parsePipeValues(rightSide));
    }
  }
  return Array.from(new Set(values));
}

function normalizeHeadingForMatch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[，。；：！？（）【】《》、]/g, ' ')
    .replace(/[`~!@#$%^&*()+={}[\]|\\:;"'<>,.?/]/g, ' ')
    .replace(/\s+/g, ' ');
}

function matchesHeadingAllowlist(heading: string, matcher: HeadingAllowlistMatcher): boolean {
  if (typeof matcher === 'string') {
    const normalizedHeading = normalizeHeadingForMatch(heading);
    const normalizedMatcher = normalizeHeadingForMatch(matcher);
    if (!normalizedMatcher) return false;
    return normalizedHeading === normalizedMatcher || normalizedHeading.startsWith(normalizedMatcher);
  }

  return matcher.test(heading) || matcher.test(normalizeHeadingForMatch(heading));
}

function shouldIncludeSection(heading: string, sectionBody: string, options?: SplitByLevel2HeadingsOptions): boolean {
  if (!sectionBody) return false;

  const allowlist = options?.headingAllowlist;
  if (allowlist && allowlist.length > 0) {
    const matched = allowlist.some((matcher) => matchesHeadingAllowlist(heading, matcher));
    if (!matched) return false;
  }

  if (typeof options?.minChunkContentLength === 'number' && sectionBody.length < options.minChunkContentLength) {
    return false;
  }

  return true;
}

export function splitByLevel2Headings(content: string, options?: SplitByLevel2HeadingsOptions): MarkdownSection[] {
  const lines = content.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (!currentHeading) return;
    const sectionBody = currentLines.join('\n').trim();
    if (!shouldIncludeSection(currentHeading, sectionBody, options)) return;
    sections.push({ heading: currentHeading, content: sectionBody });
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      flush();
      currentHeading = h2[1]?.trim() ?? '';
      currentLines = [line];
      continue;
    }
    if (currentHeading) currentLines.push(line);
  }

  flush();
  if (sections.length > 0) return sections;

  const fallbackHeading =
    lines
      .find((line) => /^#\s+/.test(line))
      ?.replace(/^#\s+/, '')
      .trim() ?? 'document';
  const fallbackContent = content.trim();
  if (!shouldIncludeSection(fallbackHeading, fallbackContent, options)) return [];
  return [{ heading: fallbackHeading, content: fallbackContent }];
}

export function parseLessonsEntries(content: string): LessonsEntry[] {
  const entries: LessonsEntry[] = [];
  const blocks = content.split(/^###\s+/m).slice(1);

  for (const rawBlock of blocks) {
    const firstLineEnd = rawBlock.indexOf('\n');
    const titleLine = (firstLineEnd >= 0 ? rawBlock.slice(0, firstLineEnd) : rawBlock).trim();
    const idMatch = titleLine.match(/^(LL-\d{3}):\s*(.+)$/);
    if (!idMatch) continue;

    const id = idMatch[1] ?? '';
    const title = idMatch[2]?.trim() ?? id;
    const body = rawBlock.trim();
    const lines = body.split(/\r?\n/);

    const sourceAnchors: string[] = [];
    const related: string[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (/^- 来源锚点：/.test(line)) sourceAnchors.push(...collectFieldValues(lines, i));
      if (/^- 关联：/.test(line)) related.push(...collectFieldValues(lines, i));
    }

    entries.push({
      id,
      title,
      body,
      status: parseStatusFromBlock(body),
      sourceAnchors: Array.from(new Set(sourceAnchors)),
      related: Array.from(new Set(related)),
    });
  }

  return entries;
}
