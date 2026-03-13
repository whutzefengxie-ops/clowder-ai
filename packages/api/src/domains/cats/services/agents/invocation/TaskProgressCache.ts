/**
 * F045: In-memory task progress cache for persistence across page refresh.
 * Module-level state — lost on server restart (acceptable for V1).
 */

export interface CachedTaskItem {
  id: string;
  subject: string;
  status: string;
  activeForm?: string;
}

export interface CachedTaskProgress {
  tasks: CachedTaskItem[];
  lastUpdate: number;
}

const cache = new Map<string, Record<string, CachedTaskProgress>>();

export function setTaskProgress(threadId: string, catId: string, tasks: CachedTaskItem[]): void {
  let byThread = cache.get(threadId);
  if (!byThread) {
    byThread = {};
    cache.set(threadId, byThread);
  }
  byThread[catId] = { tasks, lastUpdate: Date.now() };
}

export function getTaskProgress(threadId: string): Record<string, CachedTaskProgress> | null {
  return cache.get(threadId) ?? null;
}

export function clearTaskProgress(threadId: string, catId: string): void {
  const byThread = cache.get(threadId);
  if (!byThread) return;
  delete byThread[catId];
  if (Object.keys(byThread).length === 0) cache.delete(threadId);
}
