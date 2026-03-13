/**
 * Evidence Search Route
 * GET /api/evidence/search — search project knowledge via Hindsight Recall
 * Degrades to local docs/ grep when Hindsight is unavailable.
 *
 * Phase 5.0: Evidence-first search.
 */

import { join } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { collectConfigSnapshot } from '../config/ConfigRegistry.js';
import {
  shouldFailClosedForFreshness,
  triggerP0ReimportIfNeeded,
} from '../domains/cats/services/hindsight-import/p0-freshness-guard.js';
import { getP0Freshness } from '../domains/cats/services/hindsight-import/p0-watermark.js';
import { getEventAuditLog } from '../domains/cats/services/orchestration/EventAuditLog.js';
import type { IHindsightClient } from '../domains/cats/services/orchestration/HindsightClient.js';
import type { IEvidenceStore } from '../domains/memory/interfaces.js';
import type { EvidenceResult } from './evidence-helpers.js';
import { memoryToResult, normalizeTags, searchDocs, shouldDegradeToDocs, validateAnchors } from './evidence-helpers.js';

/** Accepted query parameters */
const searchSchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  budget: z.enum(['low', 'mid', 'high']).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  tagsMatch: z.enum(['any', 'all', 'any_strict', 'all_strict']).optional(),
});

const EVIDENCE_RECALL_TYPES: Array<'world' | 'experience'> = ['world', 'experience'];

export type { EvidenceConfidence, EvidenceSourceType } from './evidence-helpers.js';

export interface EvidenceFreshness {
  status: 'fresh' | 'stale' | 'unknown';
  checkedAt: string;
  headCommit?: string;
  watermarkCommit?: string;
  reason?: 'commit_match' | 'commit_mismatch' | 'watermark_missing' | 'head_unavailable';
}

export interface EvidenceReimportTrigger {
  status: 'triggered' | 'cooldown' | 'skipped' | 'disabled' | 'failed';
  reason?: string;
  nextAllowedAt?: string;
}

export interface EvidenceSearchResponse {
  results: EvidenceResult[];
  degraded: boolean;
  degradeReason?: string;
  freshness: EvidenceFreshness;
  reimportTrigger?: EvidenceReimportTrigger;
}

export interface EvidenceRoutesOptions {
  hindsightClient: IHindsightClient;
  sharedBank: string;
  docsRoot?: string;
  freshnessProvider?: () => Promise<EvidenceFreshness>;
  reimportTriggerProvider?: (freshness: EvidenceFreshness) => Promise<EvidenceReimportTrigger>;
  /** F102: when provided, bypasses Hindsight entirely */
  evidenceStore?: IEvidenceStore;
}

export const evidenceRoutes: FastifyPluginAsync<EvidenceRoutesOptions> = async (app, opts) => {
  const repoRoot = process.cwd();
  const freshnessProvider = opts.freshnessProvider ?? (() => getP0Freshness(process.cwd()));
  const reimportTriggerProvider =
    opts.reimportTriggerProvider ??
    ((freshness: EvidenceFreshness) =>
      triggerP0ReimportIfNeeded({
        freshness,
        repoRoot,
        auditLog: getEventAuditLog(),
      }));

  app.get('/api/evidence/search', async (request, reply) => {
    const parseResult = searchSchema.safeParse(request.query);
    if (!parseResult.success) {
      reply.status(400);
      return { error: 'Invalid query parameters', details: parseResult.error.issues };
    }

    const { q, limit, budget, tags, tagsMatch } = parseResult.data;

    // F102: IEvidenceStore DI path — bypass Hindsight entirely
    if (opts.evidenceStore) {
      const effectiveLimit = limit ?? 5;
      try {
        const items = await opts.evidenceStore.search(q, { limit: effectiveLimit });
        const results: EvidenceResult[] = items.map((item) => ({
          title: item.title,
          anchor: item.anchor,
          snippet: item.summary ?? '',
          confidence: 'mid' as const,
          sourceType: (item.kind === 'decision'
            ? 'decision'
            : item.kind === 'plan'
              ? 'phase'
              : 'discussion') as EvidenceResult['sourceType'],
        }));
        return { results, degraded: false } satisfies Partial<EvidenceSearchResponse>;
      } catch {
        return {
          results: [],
          degraded: true,
          degradeReason: 'evidence_store_error',
        } satisfies Partial<EvidenceSearchResponse>;
      }
    }

    const hindsightConfig = collectConfigSnapshot().hindsight;
    const recallDefaults = hindsightConfig.recallDefaults;
    const effectiveLimit = limit ?? recallDefaults.limit;
    const effectiveBudget = budget ?? recallDefaults.budget;
    const effectiveTagsMatch = tagsMatch ?? recallDefaults.tagsMatch;
    const failClosedSettings = {
      enabled: hindsightConfig.freshnessGuard.failClosedEnabled,
      statuses: hindsightConfig.freshnessGuard.failClosedStatuses,
    };
    const resolvedTags = normalizeTags(tags);
    const docsRoot = opts.docsRoot ?? join(process.cwd(), 'docs');
    const freshness = await freshnessProvider().catch(() => ({
      status: 'unknown' as const,
      checkedAt: new Date().toISOString(),
      reason: 'head_unavailable' as const,
    }));
    if (!hindsightConfig.enabled) {
      const rawResults = await searchDocs(docsRoot, q, effectiveLimit);
      const results = await validateAnchors(rawResults, docsRoot);
      return {
        results,
        degraded: true,
        degradeReason: 'hindsight_disabled_fallback_docs_search',
        freshness,
      } satisfies EvidenceSearchResponse;
    }

    if (shouldFailClosedForFreshness(freshness, failClosedSettings)) {
      const reimportTrigger = await reimportTriggerProvider(freshness).catch((err) => ({
        status: 'failed' as const,
        reason: err instanceof Error ? err.message : 'trigger_failed',
      }));
      const rawResults = await searchDocs(docsRoot, q, effectiveLimit);
      const results = await validateAnchors(rawResults, docsRoot);
      return {
        results,
        degraded: true,
        degradeReason: freshness.status === 'stale' ? 'freshness_stale_fail_closed' : 'freshness_fail_closed',
        freshness,
        reimportTrigger,
      } satisfies EvidenceSearchResponse;
    }

    try {
      const memories = await opts.hindsightClient.recall(opts.sharedBank, q, {
        limit: effectiveLimit,
        budget: effectiveBudget,
        types: EVIDENCE_RECALL_TYPES,
        tags: resolvedTags,
        tagsMatch: effectiveTagsMatch,
      });
      const results = await validateAnchors(memories.map(memoryToResult), docsRoot);
      return { results, degraded: false, freshness } satisfies EvidenceSearchResponse;
    } catch (err) {
      if (!shouldDegradeToDocs(err)) {
        reply.status(502);
        return {
          error: 'Evidence search unavailable',
          degraded: false,
          freshness,
        };
      }

      const rawResults = await searchDocs(docsRoot, q, effectiveLimit);
      const results = await validateAnchors(rawResults, docsRoot);
      return {
        results,
        degraded: true,
        degradeReason: 'hindsight_unavailable_fallback_docs_search',
        freshness,
      } satisfies EvidenceSearchResponse;
    }
  });
};
