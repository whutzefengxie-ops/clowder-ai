'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGuideStore } from '@/stores/guideStore';
import { apiFetch } from '@/utils/api-client';

const GUIDE_ID = 'first-run-entry';
const PATH = '/api/config/onboarding/entry';
type TerminalStatus = 'dismissed' | 'completed';
async function saveReceipt(intent: TerminalStatus): Promise<TerminalStatus> {
  const response = await apiFetch(PATH, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: intent }),
  });
  if (!response.ok) throw Error('入口提醒记录未保存；可以继续对话，稍后重试。');
  const value = (await response.json()) as { status: string };
  if (value.status !== 'dismissed' && value.status !== 'completed') throw Error('入口提醒记录尚未确认；可以继续对话。');
  return value.status;
}

/** Personal persistence stays in preferences; presentation and interaction stay in F155. */
export function FirstRunEntryReminder({ enabled, threadId }: { enabled: boolean; threadId: string }) {
  const flowId = useGuideStore((s) => s.session?.flow.id ?? null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const started = useRef(false);
  const revision = useRef(0);
  const pending = useRef<TerminalStatus | null>(null);
  const writing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const report = useCallback((message: string) => {
    if (mounted.current) setError(message);
  }, []);
  const flush = useCallback(async () => {
    if (writing.current) return;
    writing.current = true;
    try {
      while (pending.current) {
        const intent = pending.current;
        const status = await saveReceipt(intent);
        if (pending.current === intent || status === 'completed') pending.current = null;
        report('');
      }
    } catch (cause) {
      report(cause instanceof Error ? cause.message : '入口提醒记录保存失败');
    } finally {
      writing.current = false;
    }
  }, [report]);
  useEffect(() => {
    if (!enabled) {
      started.current = false;
      return;
    }
    return useGuideStore.subscribe((state, previous) => {
      const own = state.session?.flow.id === GUIDE_ID && state.session.threadId === threadId;
      const previousOwn = previous.session?.flow.id === GUIDE_ID && previous.session.threadId === threadId;
      const completed = own && state.session?.phase === 'complete' && state.completionPersisted;
      const dismissed = previousOwn && !state.session && state.completedGuides.has(`${threadId}::${GUIDE_ID}`);
      if (!completed && !dismissed) return;
      revision.current += 1;
      if (pending.current !== 'completed') pending.current = completed ? 'completed' : 'dismissed';
      void flush();
    });
  }, [enabled, threadId, flush]);
  // A stale read must not re-offer a guide after a local completion or dismissal.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is the explicit failed-read retry.
  useEffect(() => {
    if (!enabled || flowId || started.current) return;
    const controller = new AbortController();
    const requestedRevision = revision.current;
    void apiFetch(PATH, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error('入口提醒暂时无法读取；可以直接开始对话。');
        const receipt = (await response.json()) as { status: string };
        if (controller.signal.aborted || requestedRevision !== revision.current) return;
        if (!pending.current) setError('');
        const state = useGuideStore.getState();
        if (
          receipt.status !== 'pending' ||
          state.session ||
          state.pendingStart ||
          state.completedGuides.has(`${threadId}::${GUIDE_ID}`)
        )
          return;
        started.current = true;
        state.reduceServerEvent({ action: 'start', guideId: GUIDE_ID, threadId });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && requestedRevision === revision.current)
          setError(cause instanceof Error ? cause.message : '入口提醒读取失败');
      });
    return () => controller.abort();
  }, [enabled, flowId, threadId, attempt]);
  if (!enabled || !error) return null;
  return (
    <output className="block text-sm text-cafe-secondary">
      {error}{' '}
      <button
        type="button"
        onClick={() => {
          if (pending.current) void flush();
          else {
            started.current = false;
            setAttempt((value) => value + 1);
          }
        }}
      >
        重试入口提醒
      </button>
    </output>
  );
}
