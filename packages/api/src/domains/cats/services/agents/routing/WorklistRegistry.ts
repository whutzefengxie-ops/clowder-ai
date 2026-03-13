/**
 * WorklistRegistry — per-thread worklist for A2A unification (F27)
 *
 * When routeSerial is running, it registers its worklist here.
 * Callback A2A triggers (MCP post_message with @mention) push
 * targets into the worklist instead of spawning independent invocations.
 *
 * This eliminates the dual-path problem:
 * - Path A (worklist): @mention in cat response text → worklist extends
 * - Path B (callback): @mention in MCP post_message → now ALSO extends worklist
 *
 * All A2A chains share the parent's AbortController, isFinal semantics,
 * and MAX_A2A_DEPTH limit.
 */

import type { CatId } from '@cat-cafe/shared';

export interface WorklistEntry {
  /** The mutable worklist array — push to extend */
  list: CatId[];
  /** Number of original user-selected targets at registration time */
  originalCount: number;
  /** A2A depth counter — incremented on each push */
  a2aCount: number;
  /** Max allowed A2A depth */
  maxDepth: number;
  /** Index of the cat currently being executed (updated by routeSerial).
   *  Used for dedup: cats already executed can be re-enqueued. */
  executedIndex: number;
  /**
   * A2A sender mapping — for each enqueued target, record who @mentioned it.
   * Used to inject "Direct message from ...; reply to ..." into the target's prompt.
   */
  a2aFrom: Map<CatId, CatId>;
}

/** Per-thread worklist registry. Single-process, no cross-process needed. */
const registry = new Map<string, WorklistEntry>();

/**
 * Register a worklist for a thread. Called by routeSerial at start.
 * Returns the entry for routeSerial to read a2aCount updates.
 */
export function registerWorklist(threadId: string, worklist: CatId[], maxDepth: number): WorklistEntry {
  const entry: WorklistEntry = {
    list: worklist,
    originalCount: worklist.length,
    a2aCount: 0,
    maxDepth,
    executedIndex: 0,
    a2aFrom: new Map(),
  };
  registry.set(threadId, entry);
  return entry;
}

/**
 * Unregister worklist for a thread. Called by routeSerial on exit.
 * Owner check: only removes if the stored entry matches the caller's entry.
 * This prevents a preempting new invocation's worklist from being deleted
 * by the old invocation's finally block. (缅因猫 R1 P1-1)
 */
export function unregisterWorklist(threadId: string, owner?: WorklistEntry): void {
  if (owner) {
    const current = registry.get(threadId);
    if (current !== owner) return; // Stale caller — new invocation owns the slot
  }
  registry.delete(threadId);
}

/**
 * Push cats to a thread's worklist (callback A2A path).
 * Dedup only against pending (not-yet-executed) portion — cats that already
 * ran can be re-enqueued for another round (e.g. A→B→A review ping-pong).
 *
 * Caller guard (cloud Codex P1): if `callerCatId` is provided, only the cat
 * currently being executed by routeSerial may push to the worklist. This
 * prevents stale callbacks from a preempted invocation from injecting targets
 * into a newer invocation's worklist.
 *
 * Returns the cats actually added (empty if worklist not found, depth exceeded,
 * or caller not authorized).
 */
export function pushToWorklist(threadId: string, cats: CatId[], callerCatId?: CatId): CatId[] {
  const entry = registry.get(threadId);
  if (!entry) return [];

  // Caller authorization: only the currently-executing cat may push
  if (callerCatId !== undefined) {
    const currentCat = entry.list[entry.executedIndex];
    if (currentCat !== callerCatId) return [];
  }

  // Only dedup against pending tail (from executedIndex onward)
  const pending = entry.list.slice(entry.executedIndex);

  const added: CatId[] = [];
  for (const cat of cats) {
    if (entry.a2aCount >= entry.maxDepth) break;
    if (!pending.includes(cat)) {
      entry.list.push(cat);
      entry.a2aCount++;
      added.push(cat);
      pending.push(cat); // Keep local dedup view in sync
      if (callerCatId !== undefined) {
        entry.a2aFrom.set(cat, callerCatId);
      }
    } else if (callerCatId !== undefined) {
      // Target already pending:
      // - original targets must keep replying to user (no A2A sender override)
      // - A2A-enqueued targets may update to latest sender before execution
      const existingIndex = entry.list.findIndex((id, idx) => idx >= entry.executedIndex && id === cat);
      const isOriginalPendingTarget = existingIndex !== -1 && existingIndex < entry.originalCount;
      if (!isOriginalPendingTarget) {
        entry.a2aFrom.set(cat, callerCatId);
      }
    }
  }
  return added;
}

/** Check if a thread has an active worklist (parent invocation running). */
export function hasWorklist(threadId: string): boolean {
  return registry.has(threadId);
}

/** Get the current worklist entry for a thread (for testing/debugging). */
export function getWorklist(threadId: string): WorklistEntry | undefined {
  return registry.get(threadId);
}
