'use client';

import { useCallback, useState } from 'react';
import type { RichInteractiveBlock } from '@/stores/chat-types';
import { useChatStore } from '@/stores/chatStore';
import { apiFetch } from '@/utils/api-client';
import { getUserId } from '@/utils/userId';
import { buildSelectionMessage, InteractiveBlock } from './InteractiveBlock';

// ── Helpers ─────────────────────────────────────────────────

function patchBlockState(messageId: string, blockId: string, patch: { disabled?: boolean; selectedIds?: string[] }) {
  return apiFetch(`/api/messages/${messageId}/block-state`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: getUserId(), blockId, ...patch }),
  });
}

function dispatchInteractiveSend(text: string) {
  window.dispatchEvent(new CustomEvent('cat-cafe:interactive-send', { detail: { text } }));
}

// ── Pure function (exported for testing) ────────────────────

export function buildGroupMessage(blocks: RichInteractiveBlock[], selections: Map<string, string[]>): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const selected = selections.get(block.id);
    if (!selected || selected.length === 0) continue;
    const msg = buildSelectionMessage(
      block.interactiveType,
      block.options,
      selected,
      block.messageTemplate,
      block.title,
    );
    parts.push(msg);
  }
  return parts.join('\n');
}

// ── Component ───────────────────────────────────────────────

export function InteractiveBlockGroup({ blocks, messageId }: { blocks: RichInteractiveBlock[]; messageId?: string }) {
  const allDisabled = blocks.every((b) => b.disabled);
  const [submitted, setSubmitted] = useState(allDisabled);
  const [selections, setSelections] = useState<Map<string, string[]>>(() => {
    const init = new Map<string, string[]>();
    for (const b of blocks) {
      if (b.selectedIds && b.selectedIds.length > 0) init.set(b.id, b.selectedIds);
    }
    return init;
  });

  const handlePendingChange = useCallback((blockId: string, selectedIds: string[]) => {
    setSelections((prev) => {
      const next = new Map(prev);
      next.set(blockId, selectedIds);
      return next;
    });
  }, []);

  const allSelected = blocks.every((b) => {
    const sel = selections.get(b.id);
    return sel && sel.length > 0;
  });

  const handleGroupSubmit = useCallback(() => {
    if (!allSelected || submitted) return;
    setSubmitted(true);

    // Build and send combined message
    const text = buildGroupMessage(blocks, selections);
    dispatchInteractiveSend(text);

    // Persist each block
    if (messageId) {
      for (const block of blocks) {
        const optionIds = selections.get(block.id) ?? [];
        useChatStore.getState().updateRichBlock(messageId, block.id, { disabled: true, selectedIds: optionIds });
        patchBlockState(messageId, block.id, { disabled: true, selectedIds: optionIds }).catch(() => {});
      }
    }
  }, [allSelected, submitted, blocks, selections, messageId]);

  return (
    <div className="space-y-3 rounded-2xl border-2 border-dashed border-amber-200 dark:border-amber-800/50 p-3">
      {blocks.map((block) => (
        <InteractiveBlock
          key={block.id}
          block={block}
          messageId={messageId}
          pendingMode={!submitted}
          onPendingChange={(ids) => handlePendingChange(block.id, ids)}
          groupDisabled={submitted}
          groupSelectedIds={submitted ? selections.get(block.id) : undefined}
        />
      ))}
      {!submitted && (
        <button
          type="button"
          disabled={!allSelected}
          onClick={handleGroupSubmit}
          className={`w-full py-2.5 rounded-full text-sm font-semibold transition-all flex items-center justify-center gap-2
            ${
              allSelected
                ? 'bg-amber-600 text-white hover:bg-amber-700 cursor-pointer'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
            }`}
        >
          全部提交
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              allSelected
                ? 'bg-white/20 text-white'
                : 'bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400'
            }`}
          >
            {selections.size}/{blocks.length}
          </span>
        </button>
      )}
    </div>
  );
}
