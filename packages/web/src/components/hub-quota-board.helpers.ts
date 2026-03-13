import type { CatInvocationInfo, ThreadState } from '@/stores/chat-types';

export type QuotaUtilizationLevel = 'ok' | 'warn' | 'high' | 'critical';

export interface CatQuotaSnapshot {
  catId: string;
  threadId: string;
  updatedAt: number;
  invocation: CatInvocationInfo;
}

interface CollectQuotaInput {
  currentThreadId: string;
  activeCatInvocations: Record<string, CatInvocationInfo>;
  threadStates: Record<string, ThreadState>;
}

function hasQuotaTelemetry(invocation: CatInvocationInfo): boolean {
  const usage = invocation.usage;
  const hasUsage = Boolean(
    usage &&
      (usage.inputTokens != null ||
        usage.outputTokens != null ||
        usage.totalTokens != null ||
        usage.cacheReadTokens != null ||
        usage.contextUsedTokens != null ||
        usage.contextWindowSize != null),
  );

  const rateLimit = invocation.rateLimit;
  const hasRateLimit = Boolean(
    rateLimit &&
      (rateLimit.utilization != null || (typeof rateLimit.resetsAt === 'string' && rateLimit.resetsAt.length > 0)),
  );

  const contextHealth = invocation.contextHealth;
  const hasContextHealth = Boolean(
    contextHealth && (contextHealth.usedTokens > 0 || contextHealth.windowTokens > 0 || contextHealth.fillRatio > 0),
  );

  return hasUsage || hasRateLimit || hasContextHealth;
}

function resolveUpdatedAt(invocation: CatInvocationInfo, fallbackLastActivity = 0): number {
  const measuredAt = invocation.contextHealth?.measuredAt;
  const hasQuotaTelemetryTimestamp = typeof measuredAt === 'number' && measuredAt > 0;

  // Prefer direct telemetry timestamps when present; don't let thread activity
  // or non-quota events artificially "elevate" stale quota snapshots.
  if (hasQuotaTelemetryTimestamp) {
    return measuredAt!;
  }

  return Math.max(fallbackLastActivity, 0);
}

function hasTelemetryTimestamp(invocation: CatInvocationInfo): boolean {
  const measuredAt = invocation.contextHealth?.measuredAt;
  return typeof measuredAt === 'number' && measuredAt > 0;
}

export function collectLatestQuotaByCat(input: CollectQuotaInput): Record<string, CatQuotaSnapshot> {
  const { currentThreadId, activeCatInvocations, threadStates } = input;
  const result: Record<string, CatQuotaSnapshot> = {};
  const activeThreadLastActivity = threadStates[currentThreadId]?.lastActivity ?? 0;

  const upsert = (threadId: string, catId: string, invocation: CatInvocationInfo, fallbackLastActivity = 0) => {
    if (!hasQuotaTelemetry(invocation)) return;

    const updatedAt = resolveUpdatedAt(invocation, fallbackLastActivity);
    const current = result[catId];
    if (!current) {
      result[catId] = { catId, threadId, updatedAt, invocation };
      return;
    }
    const incomingHasTelemetry = hasTelemetryTimestamp(invocation);
    const currentHasTelemetry = hasTelemetryTimestamp(current.invocation);
    if (incomingHasTelemetry && !currentHasTelemetry) {
      result[catId] = { catId, threadId, updatedAt, invocation };
      return;
    }
    if (!incomingHasTelemetry && currentHasTelemetry) {
      return;
    }
    if (!incomingHasTelemetry && !currentHasTelemetry) {
      const incomingIsCurrent = threadId === currentThreadId;
      const currentIsCurrent = current.threadId === currentThreadId;
      if (incomingIsCurrent && !currentIsCurrent) {
        result[catId] = { catId, threadId, updatedAt, invocation };
        return;
      }
      if (!incomingIsCurrent && currentIsCurrent) {
        return;
      }
    }
    if (updatedAt > current.updatedAt) {
      result[catId] = { catId, threadId, updatedAt, invocation };
      return;
    }
    if (updatedAt === current.updatedAt && threadId === currentThreadId && current.threadId !== currentThreadId) {
      result[catId] = { catId, threadId, updatedAt, invocation };
    }
  };

  for (const [catId, invocation] of Object.entries(activeCatInvocations)) {
    upsert(currentThreadId, catId, invocation, activeThreadLastActivity);
  }

  for (const [threadId, state] of Object.entries(threadStates)) {
    if (threadId === currentThreadId) continue;
    for (const [catId, invocation] of Object.entries(state.catInvocations)) {
      upsert(threadId, catId, invocation, state.lastActivity);
    }
  }

  return result;
}

export function classifyQuotaUtilization(utilization: number | undefined): QuotaUtilizationLevel {
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return 'ok';
  if (utilization >= 0.95) return 'critical';
  if (utilization >= 0.9) return 'high';
  if (utilization >= 0.8) return 'warn';
  return 'ok';
}
