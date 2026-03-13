'use client';

import { MarkdownContent } from '@/components/MarkdownContent';
import type { RichCardBlock } from '@/stores/chat-types';

const TONE_STYLES: Record<string, string> = {
  info: 'border-l-blue-400 bg-blue-50 dark:bg-blue-950/30',
  success: 'border-l-green-400 bg-green-50 dark:bg-green-950/30',
  warning: 'border-l-yellow-400 bg-yellow-50 dark:bg-yellow-950/30',
  danger: 'border-l-red-400 bg-red-50 dark:bg-red-950/30',
};

export function CardBlock({ block }: { block: RichCardBlock }) {
  const toneStyle = TONE_STYLES[block.tone ?? 'info'] ?? TONE_STYLES.info;

  return (
    <div className={`border-l-4 rounded-r-lg p-3 ${toneStyle}`}>
      <div className="font-medium text-sm">{block.title}</div>
      {block.bodyMarkdown && (
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300 [&_.markdown-content]:text-xs [&_p]:mb-1 [&_p:last-child]:mb-0">
          <MarkdownContent content={block.bodyMarkdown} className="!text-xs" disableCommandPrefix />
        </div>
      )}
      {block.fields && block.fields.length > 0 && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
          {block.fields.map((f, i) => (
            <div key={i} className="text-xs">
              <span className="text-gray-500">{f.label}:</span> <span className="font-mono break-all">{f.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
