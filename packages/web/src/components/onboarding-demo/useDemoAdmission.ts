'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, apiFetch } from '@/utils/api-client';

interface Receipt {
  userId: string;
  version: string;
  status: 'not_started' | 'dismissed' | 'completed';
}
/** Playback remains local; admission/completion belongs to authenticated server preferences. */
export function useDemoAdmission(enabled: boolean, onOpen: () => void, autoEligible = true) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState('');
  const pending = useRef<'dismissed' | 'completed' | null>(null);
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void apiFetch('/api/config/onboarding', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error('引导记录暂时无法读取，仍可主动查看演示。');
        const value = (await response.json()) as Receipt;
        if (controller.signal.aborted) return;
        setReceipt(value);
        if (autoEligible && value.status === 'not_started' && !autoOpened.current) {
          autoOpened.current = true;
          onOpen();
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '引导记录读取失败');
      });
    return () => controller.abort();
  }, [enabled, onOpen, autoEligible]);
  const save = useCallback(async (status: 'dismissed' | 'completed') => {
    pending.current = status;
    try {
      const response = await apiFetch('/api/config/onboarding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw Error('引导记录未保存，刷新后可能重新展示。');
      setReceipt((await response.json()) as Receipt);
      setError('');
      pending.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '引导记录保存失败');
    }
  }, []);
  return {
    storageScope: `${API_URL}:${receipt?.userId ?? 'manual'}:${receipt?.version ?? 'collaboration-v1'}`,
    error,
    dismiss: () => void save('dismissed'),
    complete: () => void save('completed'),
    retry: () => pending.current && void save(pending.current),
  };
}
