/**
 * Issue #1657: Draft false positive - normal edits trigger recovery confirmation
 *
 * Verifies that editing and immediately sending (<400ms, before autosave completes)
 * does NOT trigger the "recovered draft" confirmation dialog.
 *
 * RED test - should fail with current implementation.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInput, threadDrafts } from '@/components/ChatInput';
import { useChatStore } from '@/stores/chatStore';
import { apiFetch } from '@/utils/api-client';

// ── Mocks ──
vi.mock('@/components/icons/SendIcon', () => ({
  SendIcon: () => React.createElement('span', null, 'send'),
}));
vi.mock('@/components/icons/LoadingIcon', () => ({
  LoadingIcon: () => React.createElement('span', null, 'loading'),
}));
vi.mock('@/components/icons/AttachIcon', () => ({
  AttachIcon: () => React.createElement('span', null, 'attach'),
}));
vi.mock('@/utils/compressImage', () => ({ compressImage: (f: File) => Promise.resolve(f) }));
vi.mock('@/utils/api-client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/hooks/useCoCreatorConfig', () => ({
  useCoCreatorConfig: () => ({
    name: 'ME',
    aliases: [],
    mentionPatterns: ['@co-creator'],
    color: { primary: '#D4A76A', secondary: '#FFF8F0' },
  }),
}));
vi.mock('@/hooks/useCatData', () => ({
  useCatData: () => ({
    cats: [],
    isLoading: false,
    getCatById: () => undefined,
    getCatsByBreed: () => new Map(),
  }),
}));

beforeAll(() => {
  (globalThis as { React?: typeof React }).React = React;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  delete (globalThis as { React?: typeof React }).React;
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  threadDrafts.clear();
  useChatStore.getState().reset?.();
  vi.mocked(apiFetch).mockResolvedValue({ ok: true, json: async () => ({ success: true }) } as Response);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  document.body.removeChild(container);
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('Issue #1657: Edit + immediate send (<400ms)', () => {
  it('should NOT trigger recovery confirmation when editing text and immediately sending', async () => {
    const threadId = 'thread-edit-immediate';
    const onSend = vi.fn();
    let hasRecoveryWarning = false;

    // Mount ChatInput
    await act(async () => {
      root = createRoot(container);
      root.render(
        React.createElement(ChatInput, {
          threadId,
          onSend,
          hasContent: false,
        }),
      );
    });

    const textarea = container.querySelector('textarea');
    const sendButton = container.querySelector('button[type="submit"]');
    expect(textarea).toBeTruthy();
    expect(sendButton).toBeTruthy();

    // Step 1: Type initial text and wait for autosave (>400ms)
    await act(async () => {
      textarea!.value = 'please review current PR';
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Wait for autosave to complete (400ms debounce)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    // Verify initial text is saved
    expect(threadDrafts.get(threadId)).toBe('please review current PR');

    // Step 2: Edit text (replace "review" with "inspect")
    await act(async () => {
      textarea!.value = 'please inspect current PR';
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Step 3: Immediately send BEFORE autosave completes (<400ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100); // Only 100ms, not enough for autosave
      sendButton!.dispatchEvent(new Event('click', { bubbles: true }));
    });

    // Check for recovery warning in the DOM
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const bodyText = document.body.textContent || '';
    hasRecoveryWarning = bodyText.includes('已找回另一份未发送草稿') ||
                         bodyText.includes('recovered') ||
                         bodyText.includes('草稿');

    // RED: This should pass but currently fails
    expect(hasRecoveryWarning).toBe(false);

    // Should send with the edited text
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: 'please inspect current PR',
      }),
    );
  });

  it('should NOT trigger recovery confirmation when deleting text and immediately sending', async () => {
    const threadId = 'thread-delete-immediate';
    const onSend = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(ChatInput, { threadId, onSend, hasContent: false }));
    });

    const textarea = container.querySelector('textarea');
    const sendButton = container.querySelector('button[type="submit"]');

    // Type and save
    await act(async () => {
      textarea!.value = 'please review current PR and CI';
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(450);
    });

    // Delete part of text and immediately send
    await act(async () => {
      textarea!.value = 'please review current PR';
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(100);
      sendButton!.dispatchEvent(new Event('click', { bubbles: true }));
    });

    const bodyText = document.body.textContent || '';
    const hasRecoveryWarning = bodyText.includes('已找回') || bodyText.includes('recovered');

    // RED: Should pass but currently fails
    expect(hasRecoveryWarning).toBe(false);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('should NOT trigger recovery confirmation when inserting text and immediately sending', async () => {
    const threadId = 'thread-insert-immediate';
    const onSend = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(ChatInput, { threadId, onSend, hasContent: false }));
    });

    const textarea = container.querySelector('textarea');
    const sendButton = container.querySelector('button[type="submit"]');

    // Type and save
    await act(async () => {
      textarea!.value = 'please review current PR';
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(450);
    });

    // Insert text in middle and immediately send
    await act(async () => {
      textarea!.value = 'please review the current PR';
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(100);
      sendButton!.dispatchEvent(new Event('click', { bubbles: true }));
    });

    const bodyText = document.body.textContent || '';
    const hasRecoveryWarning = bodyText.includes('已找回') || bodyText.includes('recovered');

    // RED: Should pass but currently fails
    expect(hasRecoveryWarning).toBe(false);
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
