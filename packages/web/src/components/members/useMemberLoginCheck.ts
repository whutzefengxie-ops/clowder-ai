'use client';
import { useEffect, useState } from 'react';
import type { CatData } from '@/hooks/useCatData';
import { apiFetch } from '@/utils/api-client';
import type { RuntimeChoice } from '../settings/members/member-runtime-draft';

export function useMemberLoginCheck(enabled: boolean) {
  const [runtimes, setRuntimes] = useState<RuntimeChoice[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const check = async (refresh = false) => {
      try {
        const response = await apiFetch(`/api/cats/native-runtimes${refresh ? '?refresh=1' : ''}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw Error('login_check');
        const value = (await response.json()) as { runtimes?: RuntimeChoice[] };
        if (!controller.signal.aborted) setRuntimes(value.runtimes ?? []);
      } catch {
        if (!controller.signal.aborted) setRuntimes([]);
      }
    };
    void check();
    const focus = () => void check(true);
    window.addEventListener('focus', focus);
    return () => {
      controller.abort();
      window.removeEventListener('focus', focus);
    };
  }, [enabled]);
  return (cat: CatData) => {
    // The default CLI's login says nothing about a member's explicit account or custom command.
    if (cat.configurationSource !== 'native_tool' || cat.accountRef?.trim() || cat.acp || cat.cliConfigArgs?.length)
      return undefined;
    const id = cat.clientId === 'openai' ? 'codex' : cat.clientId === 'anthropic' ? 'claude' : '';
    return runtimes.find((item) => item.id === id)?.readiness;
  };
}
