import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownContent } from '@/components/MarkdownContent';

Object.assign(globalThis as Record<string, unknown>, { React });

function render(content: string): string {
  return renderToStaticMarkup(React.createElement(MarkdownContent, { content }));
}

describe('MarkdownContent mention highlighting', () => {
  it('highlights nickname and english-alias mentions with cat colors', () => {
    const html = render('@砚砚 请看下，@宪宪 也看下，@siamese 收尾');
    // Dynamic colors now use inline style with hex values (not Tailwind classes)
    expect(html).toContain('color:#5B8C5A'); // codex
    expect(html).toContain('color:#9B7EBD'); // opus
    expect(html).toContain('color:#5B9BD5'); // gemini
  });
});
