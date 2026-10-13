'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type CatData, useCatData } from '@/hooks/useCatData';
import { apiFetch } from '@/utils/api-client';
import { buildCatPayload } from '../hub-cat-editor.payload';
import type { RuntimeChoice } from '../settings/members/member-runtime-draft';
import { syncDraftToStorage } from '../thread-drafts';
import { type NativePartner, recommendNativePartners, SMALL_GOALS } from './native-onboarding';
import { buildNativeTeamGoal, orderGoalPartners } from './native-team-goal';
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

function newJourneyId(): string {
  // getRandomValues also works on HTTP LAN origins, where randomUUID is unavailable.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function useNativeOnboarding(
  open: boolean,
  onCreated: (id: string, name: string) => void | Promise<void>,
  mode: 'goal' | 'members' = 'goal',
) {
  const { cats, refresh } = useCatData();
  const catsRef = useRef(cats);
  catsRef.current = cats;
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorStage, setErrorStage] = useState<'discovery' | 'save' | null>(null);
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
    setErrorStage(null);
    void Promise.all([
      readJson<{ userId: string }>('/api/session', { signal: controller.signal }),
      readJson<{ runtimes: RuntimeChoice[] }>(`/api/cats/native-runtimes${reload ? '?refresh=1' : ''}`, {
        signal: controller.signal,
      }),
      readJson<{ templates: TemplateCard[] }>('/api/cat-templates', { signal: controller.signal }),
      mode === 'members'
        ? readJson<{ cats: CatData[] }>('/api/cats', { signal: controller.signal })
        : Promise.resolve({ cats: catsRef.current }),
    ])
      .then(([session, discovered, templates, roster]) => {
        if (controller.signal.aborted) return;
        key.current = `cat-cafe:${mode === 'members' ? 'native-team-setup' : 'native-onboarding'}:v2:${session.userId}`;
        let saved: SetupDraft | null = null;
        try {
          const parsed = JSON.parse(localStorage.getItem(key.current) ?? 'null') as SetupDraft | null;
          if (parsed?.version === 2 && typeof parsed.journeyId === 'string' && Array.isArray(parsed.partners))
            saved = parsed;
        } catch {
          /* A corrupt draft does not prevent setup. */
        }
        const journeyId = saved?.journeyId ?? newJourneyId();
        const currentCats = mode === 'members' ? roster.cats : catsRef.current;
        const partners = recommendNativePartners(discovered.runtimes, templates.templates, currentCats, journeyId).map(
          (partner) => {
            const previous = saved?.partners.find((p) => p.id === partner.id);
            if (!previous?.form) return partner;
            const { name, displayName, nickname, defaultModel, cliEffort } = previous.form;
            return {
              ...partner,
              selected: partner.selected && (!previous.runtime?.installed || previous.selected),
              form: partner.existingId
                ? partner.form
                : { ...partner.form, name, displayName, nickname, defaultModel, cliEffort },
            };
          },
        );
        persist({
          version: 2,
          journeyId,
          partners,
          goal: saved?.goal ?? SMALL_GOALS[0].content,
          lead: saved?.lead ?? partners.find((p) => p.selected)?.id ?? '',
          created: Object.fromEntries(
            Object.entries(saved?.created ?? {}).filter(
              ([, member]) => mode === 'goal' || roster.cats.some((cat) => cat.id === member.id),
            ),
          ),
          threadId: saved?.threadId,
        });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : '无法读取本机工具');
          setErrorStage('discovery');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, reload, persist, mode]);

  const patch = (changes: Partial<SetupDraft>) => {
    if (latest.current && !inFlight.current) persist({ ...latest.current, ...changes });
  };
  const patchPartner = (id: string, change: Partial<NativePartner>) => {
    if (!latest.current) return;
    patch({ partners: latest.current.partners.map((p) => (p.id === id ? { ...p, ...change } : p)) });
  };
  const start = async () => {
    const current = latest.current;
    if (
      !current ||
      loading ||
      errorStage === 'discovery' ||
      inFlight.current ||
      (mode === 'goal' && !current.goal.trim())
    )
      return;
    const selected = orderGoalPartners(
      current.partners.filter(
        (p) => p.selected && p.runtime.installed && (p.runtime.clientId !== 'acp' || p.runtime.acp),
      ),
      current.lead,
    );
    if (!selected.length) return;
    inFlight.current = true;
    setError('');
    setErrorStage(null);
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
      if (mode === 'members') {
        await refresh();
        await onCreated(lead.id, lead.name);
        return;
      }
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
      syncDraftToStorage(
        progress.threadId,
        buildNativeTeamGoal(
          selected.map((p) => progress.created[p.id]),
          current.goal,
        ),
      );
      refresh();
      onCreated(progress.threadId, lead.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试；已添加的伙伴会保留。');
      setErrorStage('save');
    } finally {
      inFlight.current = false;
      setBusy('');
    }
  };
  return { draft, loading, error, errorStage, busy, patch, patchPartner, start, reload: () => setReload((n) => n + 1) };
}
