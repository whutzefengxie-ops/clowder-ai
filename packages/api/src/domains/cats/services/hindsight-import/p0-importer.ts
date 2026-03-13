import type { RetainItem, RetainOptions } from '../orchestration/HindsightClient.js';
import {
  buildP0Anchor,
  buildP0DocumentId,
  deriveP0Kind,
  deriveP0Status,
  isP0AllowedSourcePath,
  isP0DiscussionSourcePath,
  normalizeSourcePath,
  P0_LESSONS_PATH,
  P0_PROJECT_TAG,
  validateP0Tags,
} from './p0-contract.js';
import {
  hasHindsightIncludeDirective,
  parseLessonsEntries,
  splitByLevel2Headings,
  stripMarkdownFrontmatter,
} from './p0-markdown-parser.js';

export interface BuildImportItemsInput {
  sourcePath: string;
  sourceCommit: string;
  content: string;
  author: string;
}

const P0_DECISION_HEADING_ALLOWLIST = [
  '背景',
  'context',
  '问题',
  '决策',
  'decision',
  /^d\d+/i,
  '权衡',
  'tradeoff',
  'trade-off',
  '取舍',
  '否决理由',
  'rejected alternatives',
  'rejected alternative',
  '后果',
  'consequences',
];

const P0_MIN_CHUNK_CONTENT_LENGTH = 120;

function buildGovernanceTags(params: {
  kind: string;
  status: string;
  origin: string;
  visibility: string;
  author: string;
  sourcePath: string;
  sourceCommit: string;
  anchor: string;
}): string[] {
  const tags = [
    P0_PROJECT_TAG,
    `kind:${params.kind}`,
    `status:${params.status}`,
    `visibility:${params.visibility}`,
    `author:${params.author}`,
    `origin:${params.origin}`,
    `sourcePath:${params.sourcePath}`,
    `sourceCommit:${params.sourceCommit}`,
    `anchor:${params.anchor}`,
  ];
  validateP0Tags(tags);
  return tags;
}

function buildMetadata(params: {
  kind: string;
  status: string;
  origin: string;
  visibility: string;
  author: string;
  sourcePath: string;
  sourceCommit: string;
  anchor: string;
  heading: string;
  sourceAnchors?: string[];
  related?: string[];
}): Record<string, string> {
  return {
    kind: params.kind,
    status: params.status,
    origin: params.origin,
    visibility: params.visibility,
    author: params.author,
    sourcePath: params.sourcePath,
    sourceCommit: params.sourceCommit,
    anchor: params.anchor,
    heading: params.heading,
    sourceAnchors: JSON.stringify(params.sourceAnchors ?? []),
    related: JSON.stringify(params.related ?? []),
  };
}

function buildLessonsItems(params: {
  documentId: string;
  sourcePath: string;
  sourceCommit: string;
  content: string;
  author: string;
  origin: string;
  visibility: string;
}): RetainItem[] {
  const entries = parseLessonsEntries(params.content);
  return entries.map((entry) => {
    const kind = deriveP0Kind(params.sourcePath);
    const status = entry.status;
    const heading = `${entry.id}: ${entry.title}`;
    const anchor = buildP0Anchor(params.sourcePath, heading, entry.id);
    return {
      document_id: params.documentId,
      content: `### ${entry.body}`,
      tags: buildGovernanceTags({
        kind,
        status,
        origin: params.origin,
        visibility: params.visibility,
        author: params.author,
        sourcePath: params.sourcePath,
        sourceCommit: params.sourceCommit,
        anchor,
      }),
      metadata: buildMetadata({
        kind,
        status,
        origin: params.origin,
        visibility: params.visibility,
        author: params.author,
        sourcePath: params.sourcePath,
        sourceCommit: params.sourceCommit,
        anchor,
        heading,
        sourceAnchors: entry.sourceAnchors,
        related: entry.related,
      }),
    };
  });
}

export function buildP0DocumentTags(tags: string[] | undefined): string[] {
  const base = (tags ?? []).filter((tag) => !tag.startsWith('anchor:'));
  return Array.from(new Set(base));
}

export function buildP0RetainOptions(tags: string[] | undefined): RetainOptions {
  return {
    async: true,
    document_tags: buildP0DocumentTags(tags),
  };
}

export function buildImportItemsFromMarkdown(input: BuildImportItemsInput): RetainItem[] {
  const sourcePath = normalizeSourcePath(input.sourcePath);
  if (!isP0AllowedSourcePath(sourcePath)) {
    throw new Error(`source path is not in P0 allowlist: ${sourcePath}`);
  }

  const sourceCommit = input.sourceCommit.trim();
  if (!sourceCommit) throw new Error('sourceCommit is required');

  const documentId = buildP0DocumentId(sourcePath);
  const author = input.author.trim() || 'codex';
  const isDiscussion = isP0DiscussionSourcePath(sourcePath);
  if (isDiscussion && !hasHindsightIncludeDirective(input.content)) {
    throw new Error('discussion source must include frontmatter marker hindsight: include');
  }
  const normalizedContent = isDiscussion ? stripMarkdownFrontmatter(input.content) : input.content;
  const origin = isDiscussion ? 'discussion' : 'git';
  const visibility = isDiscussion ? 'quarantined' : 'default';

  if (sourcePath === P0_LESSONS_PATH) {
    return buildLessonsItems({
      documentId,
      sourcePath,
      sourceCommit,
      content: normalizedContent,
      author,
      origin,
      visibility,
    });
  }

  const kind = deriveP0Kind(sourcePath);
  const status = deriveP0Status(sourcePath);
  const sections =
    kind === 'decision'
      ? splitByLevel2Headings(normalizedContent, {
          headingAllowlist: P0_DECISION_HEADING_ALLOWLIST,
          minChunkContentLength: P0_MIN_CHUNK_CONTENT_LENGTH,
        })
      : splitByLevel2Headings(normalizedContent);

  return sections.map((section) => {
    const anchor = buildP0Anchor(sourcePath, section.heading);
    return {
      document_id: documentId,
      content: section.content,
      tags: buildGovernanceTags({ kind, status, origin, visibility, author, sourcePath, sourceCommit, anchor }),
      metadata: buildMetadata({
        kind,
        status,
        origin,
        visibility,
        author,
        sourcePath,
        sourceCommit,
        anchor,
        heading: section.heading,
      }),
    };
  });
}

export { collectP0ImportSources, readGitHeadCommit } from './p0-source-discovery.js';
