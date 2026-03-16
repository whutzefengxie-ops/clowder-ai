/**
 * #20: Queued messages should NOT appear in the chat message stream.
 *
 * When a user message is queued (its ID matches a QueueEntry with status='queued'),
 * it should be filtered out of the chat render items and only shown in QueuePanel.
 *
 * Crucially, when status changes from 'queued' to 'processing', the message must
 * reappear in the chat stream — because QueuePanel only shows 'queued' entries.
 */

import { describe, expect, it } from 'vitest';
import type { QueueEntry } from '@/stores/chat-types';
import type { ChatMessage } from '@/stores/chatStore';

/** Mirrors the queuedMessageIds logic in ChatContainer (only status='queued') */
function buildQueuedMessageIds(queue: QueueEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of queue) {
    if (entry.status !== 'queued') continue;
    if (entry.messageId) ids.add(entry.messageId);
    for (const mid of entry.mergedMessageIds) ids.add(mid);
  }
  return ids;
}

/** Mirrors the queuedContentCounts logic in ChatContainer (deduped per entry) */
function buildQueuedContentCounts(queue: QueueEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of queue) {
    if (entry.status !== 'queued') continue;
    if (!entry.content) continue;
    const variants = new Set<string>();
    variants.add(entry.content);
    const lines = entry.content.split('\n');
    for (const line of lines) {
      if (line) variants.add(line);
    }
    if (lines.length > 1) {
      for (let start = 0; start < lines.length; start++) {
        for (let end = start + 2; end <= lines.length; end++) {
          variants.add(lines.slice(start, end).join('\n'));
        }
      }
    }
    for (const v of variants) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  return counts;
}

/** Mirrors the renderItems filtering logic in ChatContainer (count-based content match) */
function filterMessages(
  messages: ChatMessage[],
  queuedIds: Set<string>,
  queuedContentCounts: Map<string, number> = new Map(),
): ChatMessage[] {
  const quota = new Map(queuedContentCounts);
  return messages.filter((m) => {
    if (queuedIds.has(m.id)) return false;
    if (m.id.startsWith('user-') && m.type === 'user') {
      const q = quota.get(m.content) ?? 0;
      if (q > 0) {
        quota.set(m.content, q - 1);
        return false;
      }
    }
    return true;
  });
}

const NOW = Date.now();

function makeMsg(id: string, type: 'user' | 'assistant' = 'user'): ChatMessage {
  return { id, type, content: `msg ${id}`, timestamp: NOW } as ChatMessage;
}

function makeQueueEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: 'q1',
    threadId: 'thread-1',
    userId: 'u1',
    content: 'queued message',
    messageId: null,
    mergedMessageIds: [],
    source: 'user',
    targetCats: ['opus'],
    intent: 'execute',
    status: 'queued',
    createdAt: NOW,
    ...overrides,
  };
}

describe('#20: queued message filtering', () => {
  it('hides a message whose ID matches a queued entry', () => {
    const messages = [makeMsg('m1'), makeMsg('m2'), makeMsg('m3', 'assistant')];
    const queue = [makeQueueEntry({ messageId: 'm2' })];
    const queuedIds = buildQueuedMessageIds(queue);
    const visible = filterMessages(messages, queuedIds);

    expect(visible.map((m) => m.id)).toEqual(['m1', 'm3']);
  });

  it('hides messages matching mergedMessageIds', () => {
    const messages = [makeMsg('m1'), makeMsg('m2'), makeMsg('m3')];
    const queue = [makeQueueEntry({ messageId: 'm1', mergedMessageIds: ['m2'] })];
    const queuedIds = buildQueuedMessageIds(queue);
    const visible = filterMessages(messages, queuedIds);

    expect(visible.map((m) => m.id)).toEqual(['m3']);
  });

  it('shows all messages when queue is empty', () => {
    const messages = [makeMsg('m1'), makeMsg('m2')];
    const queuedIds = buildQueuedMessageIds([]);
    const visible = filterMessages(messages, queuedIds);

    expect(visible.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('shows all messages when queue entries have no messageId yet', () => {
    const messages = [makeMsg('m1'), makeMsg('m2')];
    const queue = [makeQueueEntry({ messageId: null })];
    const queuedIds = buildQueuedMessageIds(queue);
    const visible = filterMessages(messages, queuedIds);

    expect(visible.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('handles multiple queue entries correctly', () => {
    const messages = [makeMsg('m1'), makeMsg('m2'), makeMsg('m3'), makeMsg('m4')];
    const queue = [makeQueueEntry({ id: 'q1', messageId: 'm2' }), makeQueueEntry({ id: 'q2', messageId: 'm4' })];
    const queuedIds = buildQueuedMessageIds(queue);
    const visible = filterMessages(messages, queuedIds);

    expect(visible.map((m) => m.id)).toEqual(['m1', 'm3']);
  });

  // ── P1 fix: processing entries must NOT be filtered ──

  it('does NOT hide messages when entry status is processing', () => {
    const messages = [makeMsg('m1'), makeMsg('m2')];
    const queue = [makeQueueEntry({ messageId: 'm2', status: 'processing' })];
    const queuedIds = buildQueuedMessageIds(queue);
    const visible = filterMessages(messages, queuedIds);

    // processing entry → message visible in chat (QueuePanel already hides it)
    expect(visible.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('queued→processing transition: message becomes visible in chat', () => {
    const messages = [makeMsg('m1'), makeMsg('m2'), makeMsg('m3')];

    // Phase 1: entry is queued → m2 hidden
    const queuedPhase = [makeQueueEntry({ messageId: 'm2', status: 'queued' })];
    const hiddenIds = buildQueuedMessageIds(queuedPhase);
    expect(filterMessages(messages, hiddenIds).map((m) => m.id)).toEqual(['m1', 'm3']);

    // Phase 2: entry moves to processing → m2 visible again
    const processingPhase = [makeQueueEntry({ messageId: 'm2', status: 'processing' })];
    const visibleIds = buildQueuedMessageIds(processingPhase);
    expect(filterMessages(messages, visibleIds).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('merged entry: all messageIds become visible on processing', () => {
    const messages = [makeMsg('m1'), makeMsg('m2'), makeMsg('m3'), makeMsg('m4')];
    const entry = makeQueueEntry({
      messageId: 'm2',
      mergedMessageIds: ['m3'],
      status: 'queued',
    });

    // Queued: m2 + m3 hidden
    const queuedIds = buildQueuedMessageIds([entry]);
    expect(filterMessages(messages, queuedIds).map((m) => m.id)).toEqual(['m1', 'm4']);

    // Processing: m2 + m3 both visible
    const processingEntry = { ...entry, status: 'processing' as const };
    const processingIds = buildQueuedMessageIds([processingEntry]);
    expect(filterMessages(messages, processingIds).map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('normal/force delivery messages are never filtered (no queue entry)', () => {
    const messages = [makeMsg('m1'), makeMsg('m2')];
    // Empty queue — simulates normal/force delivery
    const queuedIds = buildQueuedMessageIds([]);
    const visible = filterMessages(messages, queuedIds);

    expect(visible.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  // ── P1 fix: merged queue content must match individual optimistic bubbles ──

  it('hides optimistic bubbles whose content matches segments of a merged queue entry', () => {
    // Two optimistic user messages with individual content
    const messages = [
      { id: 'user-aaa', type: 'user', content: 'hello', timestamp: NOW } as ChatMessage,
      { id: 'user-bbb', type: 'user', content: 'world', timestamp: NOW } as ChatMessage,
      makeMsg('m3', 'assistant'),
    ];
    // Backend merged them into one queue entry: "hello\nworld"
    const queue = [makeQueueEntry({ content: 'hello\nworld', messageId: null })];
    const queuedIds = buildQueuedMessageIds(queue);
    const queuedContents = buildQueuedContentCounts(queue);
    const visible = filterMessages(messages, queuedIds, queuedContents);

    // Both optimistic bubbles should be hidden; assistant message stays
    expect(visible.map((m) => m.id)).toEqual(['m3']);
  });

  it('does not hide non-optimistic messages via content match', () => {
    // Server-ID message should NOT be caught by content fallback
    const messages = [{ id: 'server-id-1', type: 'user', content: 'hello', timestamp: NOW } as ChatMessage];
    const queue = [makeQueueEntry({ content: 'hello', messageId: null })];
    const queuedIds = buildQueuedMessageIds(queue);
    const queuedContents = buildQueuedContentCounts(queue);
    const visible = filterMessages(messages, queuedIds, queuedContents);

    // Server-ID messages don't start with "user-", so content match doesn't apply
    expect(visible.map((m) => m.id)).toEqual(['server-id-1']);
  });

  it('hides optimistic bubble with multiline content (Shift+Enter) via full string match', () => {
    // Single user message containing newlines (Shift+Enter)
    const multiline = 'line one\nline two\nline three';
    const messages = [{ id: 'user-ccc', type: 'user', content: multiline, timestamp: NOW } as ChatMessage];
    // Queue entry has the same content (not merged — single message)
    const queue = [makeQueueEntry({ content: multiline, messageId: null })];
    const queuedIds = buildQueuedMessageIds(queue);
    const queuedContents = buildQueuedContentCounts(queue);
    const visible = filterMessages(messages, queuedIds, queuedContents);

    // Full multiline content should match — bubble should be hidden
    expect(visible.map((m) => m.id)).toEqual([]);
  });

  it('hides multiline optimistic bubble when its content is a prefix of a merged queue entry', () => {
    // User sends "a\nb" (Shift+Enter), then sends "c" → backend merges to "a\nb\nc"
    const messages = [
      { id: 'user-ddd', type: 'user', content: 'a\nb', timestamp: NOW } as ChatMessage,
      { id: 'user-eee', type: 'user', content: 'c', timestamp: NOW } as ChatMessage,
    ];
    const queue = [makeQueueEntry({ content: 'a\nb\nc', messageId: null })];
    const queuedIds = buildQueuedMessageIds(queue);
    const queuedContents = buildQueuedContentCounts(queue);
    const visible = filterMessages(messages, queuedIds, queuedContents);

    // "a\nb" matches as a \n-boundary prefix; "c" matches as a segment
    expect(visible.map((m) => m.id)).toEqual([]);
  });

  it('hides multiline optimistic bubble merged as a suffix of a queue entry', () => {
    // User sends "x", then sends "a\nb" (Shift+Enter) → backend merges to "x\na\nb"
    const messages = [
      { id: 'user-fff', type: 'user', content: 'x', timestamp: NOW } as ChatMessage,
      { id: 'user-ggg', type: 'user', content: 'a\nb', timestamp: NOW } as ChatMessage,
    ];
    const queue = [makeQueueEntry({ content: 'x\na\nb', messageId: null })];
    const queuedIds = buildQueuedMessageIds(queue);
    const queuedContents = buildQueuedContentCounts(queue);
    const visible = filterMessages(messages, queuedIds, queuedContents);

    // "x" matches as a segment; "a\nb" matches as a \n-boundary suffix
    expect(visible.map((m) => m.id)).toEqual([]);
  });

  it('does not hide force-sent optimistic message with same content as a queued entry', () => {
    // Queue has one entry with content "hello".
    // User also force-sends "hello" — that second bubble should NOT be hidden.
    const messages = [
      { id: 'user-qqq', type: 'user', content: 'hello', timestamp: NOW } as ChatMessage,
      { id: 'user-rrr', type: 'user', content: 'hello', timestamp: NOW } as ChatMessage,
    ];
    const queue = [makeQueueEntry({ content: 'hello', messageId: null })];
    const queuedIds = buildQueuedMessageIds(queue);
    const queuedContents = buildQueuedContentCounts(queue);
    const visible = filterMessages(messages, queuedIds, queuedContents);

    // Only ONE bubble hidden (matching queue entry), the second stays visible
    expect(visible.map((m) => m.id)).toEqual(['user-rrr']);
  });
});
