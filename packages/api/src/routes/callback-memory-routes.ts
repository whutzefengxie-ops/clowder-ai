import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { collectConfigSnapshot } from '../config/ConfigRegistry.js';
import type { InvocationRegistry } from '../domains/cats/services/agents/invocation/InvocationRegistry.js';
import {
  shouldFailClosedForFreshness,
  triggerP0ReimportIfNeeded,
} from '../domains/cats/services/hindsight-import/p0-freshness-guard.js';
import type { P0Freshness } from '../domains/cats/services/hindsight-import/p0-watermark.js';
import { getP0Freshness } from '../domains/cats/services/hindsight-import/p0-watermark.js';
import { getEventAuditLog } from '../domains/cats/services/orchestration/EventAuditLog.js';
import type { IHindsightClient } from '../domains/cats/services/orchestration/HindsightClient.js';
import { HindsightError } from '../domains/cats/services/orchestration/HindsightClient.js';
import type { IEvidenceStore, IMarkerQueue, IReflectionService } from '../domains/memory/interfaces.js';
import { callbackAuthSchema } from './callback-auth-schema.js';
import { EXPIRED_CREDENTIALS_ERROR } from './callback-errors.js';
import { memoryToResult, normalizeTags, shouldDegradeToDocs } from './evidence-helpers.js';

interface CallbackMemoryRoutesDeps {
  registry: InvocationRegistry;
  hindsightClient?: IHindsightClient;
  sharedBank?: string;
  freshnessProvider?: () => Promise<P0Freshness>;
  reimportTriggerProvider?: (freshness: P0Freshness) => Promise<{
    status: 'triggered' | 'cooldown' | 'skipped' | 'disabled' | 'failed';
    reason?: string;
    nextAllowedAt?: string;
  }>;
  /** F102: DI — when provided, takes precedence over hindsightClient */
  evidenceStore?: IEvidenceStore;
  markerQueue?: IMarkerQueue;
  reflectionService?: IReflectionService;
}

const searchEvidenceQuerySchema = callbackAuthSchema.extend({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  budget: z.enum(['low', 'mid', 'high']).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  tagsMatch: z.enum(['any', 'all', 'any_strict', 'all_strict']).optional(),
});

const EVIDENCE_RECALL_TYPES: Array<'world' | 'experience'> = ['world', 'experience'];
const reflectSchema = callbackAuthSchema.extend({
  query: z.string().trim().min(1),
});
const retainMemorySchema = callbackAuthSchema.extend({
  content: z.string().trim().min(1).max(50000),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  metadata: z.record(z.string()).optional(),
});

function shouldDegrade(err: unknown): boolean {
  if (shouldDegradeToDocs(err)) return true;
  if (err instanceof HindsightError) {
    if (err.code === 'RATE_LIMITED') return true;
    if (err.statusCode != null && (err.statusCode >= 500 || err.statusCode === 429)) return true;
    return false;
  }
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('429')
  );
}

export async function registerCallbackMemoryRoutes(
  app: FastifyInstance,
  deps: CallbackMemoryRoutesDeps,
): Promise<void> {
  const { registry, hindsightClient } = deps;
  const sharedBank = deps.sharedBank ?? 'cat-cafe-shared';
  const repoRoot = process.cwd();
  const freshnessProvider = deps.freshnessProvider ?? (() => getP0Freshness(repoRoot));
  const reimportTriggerProvider =
    deps.reimportTriggerProvider ??
    ((freshness: P0Freshness) =>
      triggerP0ReimportIfNeeded({
        freshness,
        repoRoot,
        auditLog: getEventAuditLog(),
      }));

  app.get('/api/callbacks/search-evidence', async (request, reply) => {
    const parsed = searchEvidenceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid query parameters', details: parsed.error.issues };
    }
    const { invocationId, callbackToken, q, limit } = parsed.data;
    const record = registry.verify(invocationId, callbackToken);
    if (!record) {
      reply.status(401);
      return EXPIRED_CREDENTIALS_ERROR;
    }

    // F102: IEvidenceStore DI path — bypass Hindsight entirely
    if (deps.evidenceStore) {
      try {
        const items = await deps.evidenceStore.search(q, { limit: limit ?? 5 });
        const results = items.map((item) => ({
          title: item.title,
          anchor: item.anchor,
          snippet: item.summary ?? '',
          confidence: 'mid' as const,
          sourceType: (item.kind === 'decision' ? 'decision' : item.kind === 'plan' ? 'phase' : 'discussion') as
            | 'decision'
            | 'phase'
            | 'discussion',
        }));
        return { results, degraded: false };
      } catch {
        return { results: [], degraded: true, degradeReason: 'evidence_store_error' };
      }
    }

    // Legacy Hindsight path
    if (!hindsightClient) {
      reply.status(501);
      return { error: 'Hindsight client not configured' };
    }
    const { budget, tags, tagsMatch } = parsed.data;
    const hindsightConfig = collectConfigSnapshot().hindsight;
    const recallDefaults = hindsightConfig.recallDefaults;
    const failClosedSettings = {
      enabled: hindsightConfig.freshnessGuard.failClosedEnabled,
      statuses: hindsightConfig.freshnessGuard.failClosedStatuses,
    };
    const effectiveLimit = limit ?? recallDefaults.limit;
    const effectiveBudget = budget ?? recallDefaults.budget;
    const effectiveTagsMatch = tagsMatch ?? recallDefaults.tagsMatch;
    const freshness = await freshnessProvider().catch(() => ({
      status: 'unknown' as const,
      checkedAt: new Date().toISOString(),
      reason: 'head_unavailable' as const,
    }));
    if (!hindsightConfig.enabled) {
      return { results: [], degraded: true, degradeReason: 'hindsight_disabled', freshness };
    }
    if (shouldFailClosedForFreshness(freshness, failClosedSettings)) {
      const reimportTrigger = await reimportTriggerProvider(freshness).catch((err) => ({
        status: 'failed' as const,
        reason: err instanceof Error ? err.message : 'trigger_failed',
      }));
      return {
        results: [],
        degraded: true,
        degradeReason: freshness.status === 'stale' ? 'freshness_stale_fail_closed' : 'freshness_fail_closed',
        freshness,
        reimportTrigger,
      };
    }
    try {
      const memories = await hindsightClient.recall(sharedBank, q, {
        limit: effectiveLimit,
        budget: effectiveBudget,
        types: EVIDENCE_RECALL_TYPES,
        tags: normalizeTags(tags, 'origin:git'),
        tagsMatch: effectiveTagsMatch,
      });
      return { results: memories.map(memoryToResult), degraded: false, freshness };
    } catch (err) {
      if (shouldDegrade(err)) return { results: [], degraded: true, degradeReason: 'hindsight_unavailable', freshness };
      reply.status(502);
      return { error: 'Evidence search unavailable', degraded: false, freshness };
    }
  });

  app.post('/api/callbacks/reflect', async (request, reply) => {
    const parsed = reflectSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request body', details: parsed.error.issues };
    }
    const { invocationId, callbackToken, query } = parsed.data;
    const record = registry.verify(invocationId, callbackToken);
    if (!record) {
      reply.status(401);
      return EXPIRED_CREDENTIALS_ERROR;
    }

    // F102: IReflectionService DI path
    if (deps.reflectionService) {
      try {
        const reflection = await deps.reflectionService.reflect(query);
        return { reflection, degraded: false, dispositionMode: 'off' as const };
      } catch {
        return {
          reflection: '',
          degraded: true,
          degradeReason: 'reflection_service_error',
          dispositionMode: 'off' as const,
        };
      }
    }

    // Legacy Hindsight path
    if (!hindsightClient) {
      reply.status(501);
      return { error: 'Hindsight client not configured' };
    }
    const hindsightConfig = collectConfigSnapshot().hindsight;
    const dispositionMode = hindsightConfig.reflect.dispositionMode;
    if (!hindsightConfig.enabled) {
      return { reflection: '', degraded: true, degradeReason: 'hindsight_disabled', dispositionMode };
    }
    try {
      const reflection = await hindsightClient.reflect(sharedBank, query);
      return { reflection, degraded: false, dispositionMode };
    } catch (err) {
      if (shouldDegrade(err)) {
        return { reflection: '', degraded: true, degradeReason: 'hindsight_unavailable', dispositionMode };
      }
      reply.status(502);
      return { error: 'Reflect unavailable', degraded: false };
    }
  });

  app.post('/api/callbacks/retain-memory', async (request, reply) => {
    const parsed = retainMemorySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return { error: 'Invalid request body', details: parsed.error.issues };
    }
    const { invocationId, callbackToken, content, tags, metadata } = parsed.data;
    const record = registry.verify(invocationId, callbackToken);
    if (!record) {
      reply.status(401);
      return EXPIRED_CREDENTIALS_ERROR;
    }

    // F102: IMarkerQueue DI path
    if (deps.markerQueue) {
      try {
        await deps.markerQueue.submit({
          content,
          source: `callback:${record.catId}:${invocationId}`,
          status: 'captured',
        });
        return { status: 'ok' };
      } catch {
        return { status: 'degraded', degradeReason: 'marker_queue_error' };
      }
    }

    // Legacy Hindsight path
    if (!hindsightClient) {
      reply.status(501);
      return { error: 'Hindsight client not configured' };
    }
    if (!collectConfigSnapshot().hindsight.enabled) {
      return { status: 'skipped', degradeReason: 'hindsight_disabled' };
    }
    const mergedMetadata: Record<string, string> = {
      source: 'callback',
      invocationId,
      userId: record.userId,
      catId: record.catId,
      threadId: record.threadId,
      ...(metadata ?? {}),
    };
    try {
      await hindsightClient.retain(sharedBank, [
        {
          content,
          tags: normalizeTags(tags, 'origin:callback'),
          metadata: mergedMetadata,
          timestamp: Date.now(),
        },
      ]);
      return { status: 'ok' };
    } catch (err) {
      if (shouldDegrade(err)) return { status: 'degraded', degradeReason: 'hindsight_unavailable' };
      reply.status(502);
      return { error: 'Retain unavailable' };
    }
  });
}
