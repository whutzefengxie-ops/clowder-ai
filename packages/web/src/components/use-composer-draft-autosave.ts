'use client';

import type { ContextAttachment } from '@cat-cafe/shared';
import { type MutableRefObject, useCallback, useEffect } from 'react';
import type { DurableDraftSnapshot } from './durable-composer-draft-helpers';
import { enqueueComposerDraftSave } from './durable-composer-draft-save-queue';

interface DraftAutosaveOptions {
  threadId?: string;
  hydratedRef: MutableRefObject<boolean>;
  hydrationGenerationRef: MutableRefObject<number>;
  revisionRef: MutableRefObject<number>;
  admissionsPendingRef: MutableRefObject<number>;
  admissionEpoch: number;
  input: string;
  images: File[];
  contextAttachments: ContextAttachment[];
  captureCurrentDraft: () => DurableDraftSnapshot;
  persistDraftSnapshot: (
    snapshot: DurableDraftSnapshot,
    allowPendingAdmission?: boolean,
    boundGeneration?: number,
    boundThreadId?: string | null,
    boundRevision?: number,
  ) => Promise<boolean>;
  persistCurrentDraft: () => Promise<boolean>;
}

/** Editing keeps its debounce; page exit and accepted sends flush through the same revisioned owner queue. */
export function useComposerDraftAutosave(options: DraftAutosaveOptions) {
  const {
    threadId,
    hydratedRef,
    hydrationGenerationRef,
    revisionRef,
    admissionsPendingRef,
    admissionEpoch,
    input,
    images,
    contextAttachments,
    captureCurrentDraft,
    persistDraftSnapshot,
  } = options;
  useEffect(() => {
    if (!threadId) return;
    const flush = () => {
      if (!hydratedRef.current || admissionsPendingRef.current > 0) return;
      // P1 R6: Capture complete owner context immediately, before enqueue
      const generation = hydrationGenerationRef.current;
      const capturedThreadId = threadId;
      const capturedRevision = revisionRef.current;
      const snapshot = captureCurrentDraft();
      void enqueueComposerDraftSave(threadId, () =>
        persistDraftSnapshot(snapshot, false, generation, capturedThreadId, capturedRevision),
      );
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [
    admissionsPendingRef,
    captureCurrentDraft,
    hydratedRef,
    hydrationGenerationRef,
    persistDraftSnapshot,
    revisionRef,
    threadId,
  ]);

  useEffect(() => {
    if (!threadId || !hydratedRef.current || admissionsPendingRef.current > 0) return;
    void admissionEpoch;
    void images;
    void contextAttachments;
    void input;
    const timer = window.setTimeout(() => {
      // P1 R6: Capture complete owner context in timeout, before enqueue
      const generation = hydrationGenerationRef.current;
      const capturedThreadId = threadId;
      const capturedRevision = revisionRef.current;
      const snapshot = captureCurrentDraft();
      void enqueueComposerDraftSave(threadId, () =>
        persistDraftSnapshot(snapshot, false, generation, capturedThreadId, capturedRevision),
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    admissionEpoch,
    admissionsPendingRef,
    captureCurrentDraft,
    contextAttachments,
    hydratedRef,
    hydrationGenerationRef,
    images,
    input,
    persistDraftSnapshot,
    revisionRef,
    threadId,
  ]);

  const persistSettledDraft = useCallback(
    (generation: number) => {
      if (!threadId || admissionsPendingRef.current > 0 || hydrationGenerationRef.current !== generation) return;
      // P1 R6: Capture owner context before enqueue
      const capturedThreadId = threadId;
      const capturedRevision = revisionRef.current;
      const snapshot = captureCurrentDraft();
      void enqueueComposerDraftSave(threadId, () =>
        persistDraftSnapshot(snapshot, false, generation, capturedThreadId, capturedRevision),
      );
    },
    [admissionsPendingRef, captureCurrentDraft, hydrationGenerationRef, persistDraftSnapshot, revisionRef, threadId],
  );
  return { persistSettledDraft };
}
