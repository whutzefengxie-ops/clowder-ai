'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCatData } from '@/hooks/useCatData';
import { apiFetch } from '@/utils/api-client';

export interface AuthPendingRequest {
  requestId: string;
  catId: string;
  threadId: string;
  action: string;
  reason: string;
  context?: string;
  createdAt: number;
}

export type RespondScope = 'once' | 'thread' | 'global';

/* ── Desktop notification + tab title flash ─────────────── */
function notifyAuthRequest(data: AuthPendingRequest, catLabel: string) {
  const cat = catLabel;

  // Desktop notification (even when tab is in background)
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const n = new Notification('🔐 猫猫需要权限', {
      body: `${cat} 请求: ${data.action}\n${data.reason}`,
      tag: `auth-${data.requestId}`,
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }

  // Tab title flash when page is hidden
  if (typeof document !== 'undefined' && document.hidden) {
    const original = document.title;
    let flash = true;
    const iv = setInterval(() => {
      document.title = flash ? `🔐 ${cat} 等你批准!` : original;
      flash = !flash;
    }, 1000);
    const stop = () => {
      clearInterval(iv);
      document.title = original;
    };
    document.addEventListener(
      'visibilitychange',
      () => {
        if (!document.hidden) stop();
      },
      { once: true },
    );
  }
}

export function useAuthorization(threadId: string) {
  const [pending, setPending] = useState<AuthPendingRequest[]>([]);
  const { getCatById } = useCatData();
  const permissionRequested = useRef(false);

  // Request notification permission on first mount
  useEffect(() => {
    if (permissionRequested.current) return;
    permissionRequested.current = true;
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  const fetchPending = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/authorization/pending?threadId=${threadId}`);
      if (res.ok) {
        const data = await res.json();
        setPending(data.pending ?? []);
      }
    } catch {
      // Best-effort — don't crash on network error
    }
  }, [threadId]);

  // Fetch on mount and thread change
  useEffect(() => {
    void fetchPending();
  }, [fetchPending]);

  const respond = useCallback(async (requestId: string, granted: boolean, scope: RespondScope, reason?: string) => {
    try {
      const res = await apiFetch('/api/authorization/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, granted, scope, ...(reason ? { reason } : {}) }),
      });
      if (res.ok) {
        // Optimistically remove from local list
        setPending((prev) => prev.filter((r) => r.requestId !== requestId));
      }
    } catch {
      // Best-effort
    }
  }, []);

  // Track notified request IDs to avoid duplicate notifications
  const notifiedRef = useRef<Set<string>>(new Set());

  // Socket event: new authorization request
  const handleAuthRequest = useCallback(
    (data: AuthPendingRequest) => {
      setPending((prev) => {
        if (prev.some((r) => r.requestId === data.requestId)) return prev;
        return [...prev, data];
      });
      // Notify outside updater; dedup via ref to handle concurrent-mode replays
      if (!notifiedRef.current.has(data.requestId)) {
        notifiedRef.current.add(data.requestId);
        const label = getCatById(data.catId)?.displayName ?? data.catId;
        notifyAuthRequest(data, label);
      }
    },
    [getCatById],
  );

  // Socket event: authorization resolved (by another client or tab)
  const handleAuthResponse = useCallback((data: { requestId: string }) => {
    setPending((prev) => prev.filter((r) => r.requestId !== data.requestId));
  }, []);

  return { pending, respond, handleAuthRequest, handleAuthResponse, fetchPending };
}
