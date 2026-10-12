'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCatData } from '@/hooks/useCatData';
import { apiFetch } from '@/utils/api-client';
import { buildCatPayload } from '../hub-cat-editor.payload';
import type { RuntimeChoice } from '../settings/members/member-runtime-draft';
import { syncDraftToStorage } from '../thread-drafts';
import { type NativePartner, recommendNativePartners, SMALL_GOALS } from './native-onboarding';
import type { TemplateCard } from './TemplateStep';

interface CreatedPartner {
  id: string;
  name: string;
  mention: string;
}
interface SetupDraft {
  version: 2;
  journeyId: string;
  partners: NativePartner[];
  goal: string;
  lead: string;
  created: Record<string, CreatedPartner>;
  threadId?: string;
}
async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function useNativeOnboarding(open: boolean, onCreated: (id: string, name: string) => void) {
  const { cats, refresh } = useCatData();
  const catsRef = useRef(cats);
  catsRef.current = cats;
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [reload, setReload] = useState(0);
  const key = useRef('');
  const inFlight = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;
  const persist = useCallback((next: SetupDraft) => {
    latest.current = next;
    setDraft(next);
    try {
      localStorage.setItem(key.current, JSON.stringify(next));
    } catch {
      /* In-memory retries still work. */
    }
  }, []);

  useEffect(() => {
    void reload;
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void Promise.all([
      readJson<{ userId: string }>('/api/session', { signal: controller.signal }),
      readJson<{ runtimes: RuntimeChoice[] }>('/api/cats/native-runtimes', { signal: controller.signal }),
      readJson<{ templates: TemplateCard[] }>('/api/cat-templates', { signal: controller.signal }),
    ])
      .then(([session, discovered, templates]) => {
        if (controller.signal.aborted) return;
        key.current = `cat-cafe:native-onboarding:v2:${session.userId}`;
        let saved: SetupDraft | null = null;
        try {
          const parsed = JSON.parse(localStorage.getItem(key.current) ?? 'null') as SetupDraft | null;
          if (parsed?.version === 2 && typeof parsed.journeyId === 'string' && Array.isArray(parsed.partners))
            saved = parsed;
        } catch {
          /* A corrupt draft does not prevent setup. */
        }
        const journeyId = saved?.journeyId ?? crypto.randomUUID();
        const partners = recommendNativePartners(
          discovered.runtimes,
          templates.templates,
          catsRef.current,
          journeyId,
        ).map((partner) => {
          const previous = saved?.partners.find((p) => p.id === partner.id);
          if (!previous?.form || partner.existingId) return partner;
          const { name, displayName, nickname, defaultModel, cliEffort } = previous.form;
          return {
            ...partner,
            selected: partner.selected && previous.selected,
            form: { ...partner.form, name, displayName, nickname, defaultModel, cliEffort },
          };
        });
        persist({
          version: 2,
          journeyId,
          partners,
          goal: saved?.goal ?? SMALL_GOALS[0].content,
          lead: saved?.lead ?? partners.find((p) => p.selected)?.id ?? '',
          created: saved?.created ?? {},
          threadId: saved?.threadId,
        });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取本机工具');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, reload, persist]);

  const patch = (changes: Partial<SetupDraft>) => {
    if (latest.current) persist({ ...latest.current, ...changes });
  };
  const patchPartner = (id: string, change: Partial<NativePartner>) => {
    if (!latest.current) return;
    patch({ partners: latest.current.partners.map((p) => (p.id === id ? { ...p, ...change } : p)) });
  };
  const start = async () => {
    const current = latest.current;
    if (!current || inFlight.current || !current.goal.trim()) return;
    const selected = current.partners.filter((p) => p.selected);
    if (!selected.length) return;
    inFlight.current = true;
    setError('');
    let progress = current;
    const headers = { 'Content-Type': 'application/json', 'X-Cat-Cafe-Onboarding-Journey': current.journeyId };
    try {
      for (const partner of selected) {
        const id = partner.id;
        if (progress.created[id]) continue;
        setBusy(`正在添加 ${partner.form.displayName}…`);
        const result = partner.existingId
          ? {
              cat: {
                id: partner.existingId,
                displayName: partner.form.displayName,
                mentionPatterns: partner.form.mentionPatterns.split(/[\s,]+/).filter(Boolean),
              },
            }
          : await readJson<{ cat: { id: string; displayName: string; mentionPatterns: string[] } }>('/api/cats', {
              method: 'POST',
              headers: { ...headers, 'Idempotency-Key': `onboarding:${current.journeyId}:cat:${id}` },
              body: JSON.stringify(buildCatPayload(partner.form)),
            });
        progress = {
          ...progress,
          created: {
            ...progress.created,
            [id]: {
              id: result.cat.id,
              name: result.cat.displayName,
              mention: result.cat.mentionPatterns[0] || `@${result.cat.id}`,
            },
          },
        };
        persist(progress);
      }
      const lead = progress.created[selected.find((p) => p.id === current.lead)?.id ?? selected[0].id];
      setBusy('正在准备对话…');
      if (!progress.threadId) {
        const thread = await readJson<{ id: string }>('/api/threads', {
          method: 'POST',
          headers: { ...headers, 'Idempotency-Key': `onboarding:${current.journeyId}:thread` },
          body: JSON.stringify({ title: '第一个小目标' }),
        });
        progress = { ...progress, threadId: thread.id };
        persist(progress);
      }
      if (!progress.threadId) throw new Error('对话尚未保存，请重试');
      syncDraftToStorage(progress.threadId, `${lead.mention} ${current.goal.trim()}`);
      refresh();
      onCreated(progress.threadId, lead.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试；已添加的伙伴会保留。');
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  };
  return { draft, loading, error, busy, patch, patchPartner, start, reload: () => setReload((n) => n + 1) };
}
