/**
 * Reflect Route
 * POST /api/reflect — LLM-based reflection on stored memories via Hindsight.
 *
 * Phase 5.0: Manual-first reflect (ADR-005 §6).
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { collectConfigSnapshot } from '../config/ConfigRegistry.js';
import type { IHindsightClient } from '../domains/cats/services/orchestration/HindsightClient.js';
import { HindsightError } from '../domains/cats/services/orchestration/HindsightClient.js';
import type { IReflectionService } from '../domains/memory/interfaces.js';

const reflectSchema = z.object({
  query: z.string().trim().min(1),
});

export interface ReflectRoutesOptions {
  hindsightClient: IHindsightClient;
  sharedBank: string;
  /** F102: when provided, bypasses Hindsight entirely */
  reflectionService?: IReflectionService;
}

export interface ReflectResponse {
  reflection: string;
  degraded: boolean;
  degradeReason?: string;
  dispositionMode: 'off' | 'template_only';
}

export const reflectRoutes: FastifyPluginAsync<ReflectRoutesOptions> = async (app, opts) => {
  app.post('/api/reflect', async (request, reply) => {
    const parseResult = reflectSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400);
      return { error: 'Invalid request body', details: parseResult.error.issues };
    }

    const { query } = parseResult.data;

    // F102: IReflectionService DI path — bypass Hindsight entirely
    if (opts.reflectionService) {
      try {
        const reflection = await opts.reflectionService.reflect(query);
        return { reflection, degraded: false, dispositionMode: 'off' as const } satisfies ReflectResponse;
      } catch {
        return {
          reflection: '',
          degraded: true,
          degradeReason: 'reflection_service_error',
          dispositionMode: 'off' as const,
        } satisfies ReflectResponse;
      }
    }

    const hindsightConfig = collectConfigSnapshot().hindsight;
    const dispositionMode = hindsightConfig.reflect.dispositionMode;
    if (!hindsightConfig.enabled) {
      return {
        reflection: '',
        degraded: true,
        degradeReason: 'hindsight_disabled',
        dispositionMode,
      } satisfies ReflectResponse;
    }

    try {
      const reflection = await opts.hindsightClient.reflect(opts.sharedBank, query);
      return { reflection, degraded: false, dispositionMode } satisfies ReflectResponse;
    } catch (err) {
      // Degrade gracefully for connectivity issues
      if (err instanceof HindsightError) {
        if (err.code === 'CONNECTION_FAILED' || err.code === 'TIMEOUT') {
          reply.status(200);
          return {
            reflection: '',
            degraded: true,
            degradeReason: 'hindsight_unavailable',
            dispositionMode,
          } satisfies ReflectResponse;
        }
        if (err.statusCode != null && err.statusCode >= 500) {
          reply.status(200);
          return {
            reflection: '',
            degraded: true,
            degradeReason: 'hindsight_server_error',
            dispositionMode,
          } satisfies ReflectResponse;
        }
      }

      if (err instanceof Error) {
        const msg = err.message.toLowerCase();
        if (msg.includes('econnrefused') || msg.includes('timeout') || msg.includes('fetch failed')) {
          reply.status(200);
          return {
            reflection: '',
            degraded: true,
            degradeReason: 'hindsight_unavailable',
            dispositionMode,
          } satisfies ReflectResponse;
        }
      }

      reply.status(502);
      return { error: 'Reflect unavailable', degraded: false };
    }
  });
};
