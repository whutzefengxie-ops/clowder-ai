import type { CatData } from '@/hooks/useCatData';

export interface CatOption {
  id: string;
  label: string;
  desc: string;
  insert: string;
  color: string; // hex color (for inline style)
  avatar: string;
}

/** Build @mention autocomplete options from dynamic cat data.
 *  Filters out cats with no mentionPatterns (not routable via @mention). */
/** Format display label with optional variant disambiguation */
function formatCatLabel(cat: CatData): string {
  return cat.variantLabel ? `@${cat.displayName} (${cat.variantLabel})` : `@${cat.displayName}`;
}

export function buildCatOptions(cats: CatData[]): CatOption[] {
  return cats
    .filter((cat) => cat.mentionPatterns.length > 0)
    .map((cat) => ({
      id: cat.id,
      label: formatCatLabel(cat),
      desc: cat.roleDescription,
      insert: `@${cat.mentionPatterns[0].replace(/^@/, '')} `,
      color: cat.color.primary,
      avatar: cat.avatar,
    }));
}

/** Build whisper target options from dynamic cat data.
 *  Includes ALL cats — whisper routing accepts any catId regardless of mentionPatterns. */
export function buildWhisperOptions(cats: CatData[]): CatOption[] {
  return cats.map((cat) => ({
    id: cat.id,
    label: formatCatLabel(cat),
    desc: cat.roleDescription,
    insert: cat.mentionPatterns.length > 0 ? `@${cat.mentionPatterns[0].replace(/^@/, '')} ` : '',
    color: cat.color.primary,
    avatar: cat.avatar,
  }));
}

export const MODE_OPTIONS = [
  {
    id: 'brainstorm',
    icon: '\u{1F9E0}',
    label: '\u5934\u8111\u98CE\u66B4',
    desc: '/mode brainstorm <\u8BAE\u9898> @\u732B',
    insert: '/mode brainstorm ',
  },
  {
    id: 'debate',
    icon: '\u2694\uFE0F',
    label: '\u8FA9\u8BBA',
    desc: '/mode debate <\u8BAE\u9898> @A @B',
    insert: '/mode debate ',
  },
  {
    id: 'dev-loop',
    icon: '\uD83D\uDD04',
    label: '\u5F00\u53D1\u81EA\u95ED\u73AF',
    desc: '/mode dev-loop @\u5F00\u53D1\u732B @review\u732B <\u9700\u6C42>',
    insert: '/mode dev-loop ',
  },
  {
    id: 'end',
    icon: '\u23F9',
    label: '\u7ED3\u675F\u6A21\u5F0F',
    desc: '/mode end [\u7ED3\u8BBA]',
    insert: '/mode end ',
  },
  { id: 'status', icon: '\u{1F4CB}', label: '\u67E5\u770B\u72B6\u6001', desc: '/mode status', insert: '/mode status' },
] as const;

export type ModeOption = (typeof MODE_OPTIONS)[number];

/** Pure detection — returns menu trigger type from current input, or null. */
export function detectMenuTrigger(
  val: string,
  selectionStart: number,
): { type: 'mode' } | { type: 'mention'; start: number; filter: string } | null {
  const trimmed = val.trimStart();
  if (/^\/m(o(d(e( .*)?)?)?)?$/i.test(trimmed) && trimmed.length <= 6) {
    return { type: 'mode' };
  }
  const textBefore = val.slice(0, selectionStart);
  const atIdx = textBefore.lastIndexOf('@');
  if (atIdx >= 0) {
    const fragment = textBefore.slice(atIdx + 1);
    const charBefore = atIdx > 0 ? val[atIdx - 1] : ' ';
    if (/\s/.test(charBefore!) && fragment.length <= 12 && !/\s/.test(fragment)) {
      return { type: 'mention', start: atIdx, filter: fragment };
    }
  }
  return null;
}
