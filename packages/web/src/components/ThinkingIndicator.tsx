'use client';

import { useCatData } from '@/hooks/useCatData';
import { useChatStore } from '@/stores/chatStore';

/**
 * Single-cat thinking indicator.
 * Shows a simple banner when only one cat is being invoked (execute mode).
 */

export function ThinkingIndicator() {
  const { targetCats, catStatuses } = useChatStore();
  // F032 P2: Use dynamic cat data instead of hardcoded CAT_NAMES
  const { getCatById } = useCatData();

  if (targetCats.length !== 1) return null;
  const catId = targetCats[0];
  const status = catStatuses[catId] ?? 'pending';
  if (status === 'done') return null;

  const catData = getCatById(catId);
  const name = catData?.displayName ?? catId;

  return (
    <div className="px-5 py-2 border-b border-gray-200 bg-gray-50">
      <div className="flex items-center gap-2">
        <span className="text-sm animate-pulse">🐾</span>
        <span className="text-sm text-gray-500">
          {name}
          {status === 'streaming' ? '回复中...' : '思考中...'}
        </span>
      </div>
    </div>
  );
}
