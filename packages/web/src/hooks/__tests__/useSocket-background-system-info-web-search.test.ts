import { describe, expect, it, vi } from 'vitest';
import { consumeBackgroundSystemInfo } from '@/hooks/useSocket-background-system-info';

describe('consumeBackgroundSystemInfo web_search', () => {
  it('consumes web_search JSON (does not fall back to raw JSON system bubble)', () => {
    const store = {
      addMessageToThread: vi.fn(),
      appendToThreadMessage: vi.fn(),
      appendToolEventToThread: vi.fn(),
      setThreadCatInvocation: vi.fn(),
      setThreadMessageMetadata: vi.fn(),
      setThreadMessageUsage: vi.fn(),
      setThreadMessageThinking: vi.fn(),
      setThreadMessageStreamInvocation: vi.fn(),
      setThreadMessageStreaming: vi.fn(),
      setThreadLoading: vi.fn(),
      setThreadHasActiveInvocation: vi.fn(),
      updateThreadCatStatus: vi.fn(),
      batchStreamChunkUpdate: vi.fn(),
      clearThreadActiveInvocation: vi.fn(),
      getThreadState: vi.fn(() => ({ messages: [], catStatuses: {}, catInvocations: {} })),
    };
    const options = {
      store,
      bgStreamRefs: new Map(),
      nextBgSeq: (() => {
        let i = 0;
        return () => ++i;
      })(),
      addToast: vi.fn(),
      clearDoneTimeout: vi.fn(),
    };

    const msg = {
      type: 'system_info',
      catId: 'codex',
      threadId: 'thread-1',
      content: JSON.stringify({ type: 'web_search', catId: 'codex', count: 1 }),
      timestamp: Date.now(),
    };

    const result = consumeBackgroundSystemInfo(msg, undefined, options);

    expect(result.consumed).toBe(true);
  });

  it('consumes invocation_created and resets stale taskProgress for that cat', () => {
    const store = {
      addMessageToThread: vi.fn(),
      appendToThreadMessage: vi.fn(),
      appendToolEventToThread: vi.fn(),
      setThreadCatInvocation: vi.fn(),
      setThreadMessageMetadata: vi.fn(),
      setThreadMessageUsage: vi.fn(),
      setThreadMessageThinking: vi.fn(),
      setThreadMessageStreamInvocation: vi.fn(),
      setThreadMessageStreaming: vi.fn(),
      setThreadLoading: vi.fn(),
      setThreadHasActiveInvocation: vi.fn(),
      updateThreadCatStatus: vi.fn(),
      batchStreamChunkUpdate: vi.fn(),
      clearThreadActiveInvocation: vi.fn(),
      getThreadState: vi.fn(() => ({
        messages: [],
        catStatuses: {},
        catInvocations: {
          codex: {
            invocationId: 'inv-old',
            taskProgress: {
              tasks: [{ id: 'task-1', subject: 'stale', status: 'in_progress' }],
              lastUpdate: Date.now() - 1_000,
            },
          },
        },
      })),
    };
    const options = {
      store,
      bgStreamRefs: new Map(),
      nextBgSeq: (() => {
        let i = 0;
        return () => ++i;
      })(),
      addToast: vi.fn(),
      clearDoneTimeout: vi.fn(),
    };

    const msg = {
      type: 'system_info',
      catId: 'codex',
      threadId: 'thread-1',
      content: JSON.stringify({ type: 'invocation_created', invocationId: 'inv-new-2' }),
      timestamp: Date.now(),
    };

    const result = consumeBackgroundSystemInfo(msg, undefined, options);

    expect(result.consumed).toBe(true);
    expect(store.setThreadCatInvocation).toHaveBeenCalledWith(
      'thread-1',
      'codex',
      expect.objectContaining({
        invocationId: 'inv-new-2',
        taskProgress: expect.objectContaining({
          tasks: [],
          snapshotStatus: 'running',
          lastInvocationId: 'inv-new-2',
        }),
      }),
    );
  });

  it('binds invocation identity onto an existing background streaming bubble', () => {
    const store = {
      addMessageToThread: vi.fn(),
      appendToThreadMessage: vi.fn(),
      appendToolEventToThread: vi.fn(),
      setThreadCatInvocation: vi.fn(),
      setThreadMessageMetadata: vi.fn(),
      setThreadMessageUsage: vi.fn(),
      setThreadMessageThinking: vi.fn(),
      setThreadMessageStreamInvocation: vi.fn(),
      setThreadMessageStreaming: vi.fn(),
      setThreadLoading: vi.fn(),
      setThreadHasActiveInvocation: vi.fn(),
      updateThreadCatStatus: vi.fn(),
      batchStreamChunkUpdate: vi.fn(),
      clearThreadActiveInvocation: vi.fn(),
      getThreadState: vi.fn(() => ({
        messages: [
          {
            id: 'bg-msg-1',
            type: 'assistant',
            catId: 'codex',
            content: 'partial chunk',
            isStreaming: true,
            timestamp: Date.now(),
          },
        ],
        catStatuses: {},
        catInvocations: {},
      })),
    };
    const options = {
      store,
      bgStreamRefs: new Map(),
      nextBgSeq: (() => {
        let i = 0;
        return () => ++i;
      })(),
      addToast: vi.fn(),
      clearDoneTimeout: vi.fn(),
    };

    const msg = {
      type: 'system_info',
      catId: 'codex',
      threadId: 'thread-1',
      content: JSON.stringify({ type: 'invocation_created', invocationId: 'inv-new-3' }),
      timestamp: Date.now(),
    };

    const result = consumeBackgroundSystemInfo(msg, undefined, options);

    expect(result.consumed).toBe(true);
    expect(store.setThreadMessageStreamInvocation).toHaveBeenCalledWith('thread-1', 'bg-msg-1', 'inv-new-3');
  });
});
