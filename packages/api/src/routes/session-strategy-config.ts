import { saveSpan } from '../utils/member-save-diagnostics.js';
/**
 * F33 Phase 3: Session Strategy Configuration Routes
 *
 * GET    /api/config/session-strategy           — all variant cats' effective strategy + source
 * GET    /api/config/session-strategy/:catId    — one member's effective strategy + revision (S2 read-back)
 * PATCH  /api/config/session-strategy/:catId    — set runtime override (Redis-backed)
 * DELETE /api/config/session-strategy/:catId    — remove runtime override (fall back to lower sources)
 */

import type { SessionStrategyConfig } from '@cat-cafe/shared';
import { catRegistry } from '@cat-cafe/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { sessionStrategySchema } from '../config/cat-config-loader.js';
import { getSessionStrategyWithSource } from '../config/session-strategy.js';
import {
  deleteRuntimeOverride,
  getAllRuntimeOverrides,
  getRuntimeOverride,
  setRuntimeOverride,
} from '../config/session-strategy-overrides.js';
import { resolveSessionExecutionStatus } from '../domains/cats/services/agents/context-lifecycle-capability.js';
import type { AgentContextCapability } from '../domains/cats/services/types.js';
import { resolveHeaderUserId } from '../utils/request-identity.js';

interface SessionStrategyRouteOptions {
  resolveContextCapability?: (catId: string) => AgentContextCapability;
}

/**
 * Transitional CAS opt-in marker (W1 save contract). Only writers that send
 * `x-clowder-formal-edit: 1` are required to carry a revision; legacy callers
 * without the header keep the pre-CAS blind-write behavior in this change.
 */
const FORMAL_EDIT_HEADER = 'x-clowder-formal-edit';

function isFormalEditRequest(request: FastifyRequest): boolean {
  const header = request.headers[FORMAL_EDIT_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return value === '1';
}

type SessionStrategyPatchPrecondition =
  | { ok: true; payload: unknown }
  | {
      ok: false;
      status: number;
      body: { code?: string; revision?: string; effective?: SessionStrategyConfig; error: string };
    };

/**
 * S2 CAS gate: pulls `expectedRevision` out of the raw body before schema
 * validation, enforces it for formal writers (428 when absent), and compares it
 * against the current owner revision (409 when stale). Returns the override
 * payload with the precondition key removed when the write may proceed.
 */
function sessionStrategyPatchPrecondition(request: FastifyRequest, catId: string): SessionStrategyPatchPrecondition {
  let expectedRevision: string | undefined;
  let payload: unknown = request.body;
  if (request.body != null && typeof request.body === 'object' && !Array.isArray(request.body)) {
    const { expectedRevision: rawRevision, ...rest } = request.body as Record<string, unknown>;
    if (rawRevision !== undefined) {
      if (typeof rawRevision !== 'string' || rawRevision.length === 0) {
        return { ok: false, status: 400, body: { error: 'expectedRevision must be a non-empty string' } };
      }
      expectedRevision = rawRevision;
    }
    payload = rest;
  }
  if (isFormalEditRequest(request) && expectedRevision === undefined) {
    return {
      ok: false,
      status: 428,
      body: {
        code: 'session_strategy_revision_required',
        error: '正式保存需要会话策略版本（expectedRevision）。请刷新后再保存。',
      },
    };
  }
  if (expectedRevision !== undefined) {
    const current = getSessionStrategyWithSource(catId);
    if (expectedRevision !== current.revision) {
      return {
        ok: false,
        status: 409,
        body: {
          code: 'session_strategy_revision_conflict',
          revision: current.revision,
          effective: current.effective,
          error: '会话策略已在其他页面修改。请刷新后核对再保存。',
        },
      };
    }
  }
  return { ok: true, payload };
}

const UNAVAILABLE_CONTEXT_CAPABILITY: AgentContextCapability = {
  provider: 'unknown',
  carrier: 'unknown',
  reportsRuntimeWindow: false,
  authoritativeUsage: false,
  usageTelemetry: 'unavailable',
  nativeWindowControl: false,
  nativeCompressionControl: false,
  observesCompression: false,
  reason: 'No concrete context capability is registered for this member',
};

function executionStatusFor(capability: AgentContextCapability, strategy: SessionStrategyConfig['strategy']) {
  const hasWindowBinding = capability.reportsRuntimeWindow || capability.nativeWindowControl;
  return resolveSessionExecutionStatus(strategy, {
    managedInvocationBoundary: true,
    effectiveInputCeiling: hasWindowBinding,
    carrierBinding: hasWindowBinding,
    authoritativeUsage: capability.authoritativeUsage && capability.usageTelemetry === 'available',
    sessionRotation: true,
    continuityBootstrap: true,
    observesCompression: capability.observesCompression,
  });
}

/** Shared projection for the list read and the single-member S2 read-back. */
function resolveStrategyEntry(
  catId: string,
  override: Partial<SessionStrategyConfig> | undefined,
  resolveContextCapability?: (catId: string) => AgentContextCapability,
) {
  const entry = catRegistry.tryGet(catId);
  if (!entry) return undefined;
  const { effective, source, revision, changedAt } = getSessionStrategyWithSource(catId);
  const capability = resolveContextCapability?.(catId) ?? UNAVAILABLE_CONTEXT_CAPABILITY;
  return {
    catId,
    displayName: entry.config.displayName,
    clientId: entry.config.clientId,
    breedId: entry.config.breedId,
    effective,
    source,
    revision,
    changedAt,
    executionStatus: executionStatusFor(capability, effective.strategy),
    hasOverride: override != null,
    override: override ?? null,
  };
}

export const sessionStrategyConfigRoutes: FastifyPluginAsync<SessionStrategyRouteOptions> = async (app, opts) => {
  /**
   * GET /api/config/session-strategy
   * Returns every registered variant cat's effective strategy, source, and override status.
   */
  app.get('/api/config/session-strategy', async () => {
    const allOverrides = getAllRuntimeOverrides();
    const cats = [];

    for (const id of catRegistry.getAllIds()) {
      const catId = id as string;
      const entry = resolveStrategyEntry(catId, allOverrides.get(catId), opts.resolveContextCapability);
      if (entry) cats.push(entry);
    }

    return { cats };
  });

  /**
   * GET /api/config/session-strategy/:catId
   * Single-member S2 read-back: the effective strategy plus the revision a formal
   * PATCH must send as `expectedRevision`.
   */
  app.get<{ Params: { catId: string } }>('/api/config/session-strategy/:catId', async (request, reply) => {
    const { catId } = request.params;
    const entry = resolveStrategyEntry(catId, getRuntimeOverride(catId), opts.resolveContextCapability);
    if (!entry) {
      reply.status(404);
      return { error: `Unknown cat ID: "${catId}"` };
    }
    return entry;
  });

  /**
   * PATCH /api/config/session-strategy/:catId
   * Set or update a runtime strategy override for a specific variant cat.
   * The override is deep-merged with the base strategy at read time.
   */
  app.patch<{ Params: { catId: string } }>('/api/config/session-strategy/:catId', async (request, reply) => {
    const operator = resolveHeaderUserId(request);
    if (!operator) {
      reply.status(400);
      return { error: 'Identity required (X-Cat-Cafe-User header)' };
    }

    const { catId } = request.params;

    // Verify cat exists in registry
    const entry = catRegistry.tryGet(catId);
    if (!entry) {
      reply.status(404);
      return { error: `Unknown cat ID: "${catId}"` };
    }

    if (request.body != null && typeof request.body === 'object' && Object.hasOwn(request.body, 'sessionChain')) {
      reply.status(400);
      return { error: 'Legacy sessionChain writes are not accepted; save session strategy intent only' };
    }

    // S2: pull the CAS precondition out BEFORE schema validation so it never becomes
    // part of the strategy override, then compare against the current owner revision.
    const precondition = sessionStrategyPatchPrecondition(request, catId);
    if (!precondition.ok) {
      reply.status(precondition.status);
      return precondition.body;
    }

    // Validate the override payload with the shared Zod schema (revision already removed).
    const parseResult = sessionStrategySchema.safeParse(precondition.payload);
    if (!parseResult.success) {
      reply.status(400);
      return { error: 'Invalid strategy config', details: parseResult.error.issues };
    }

    const override = parseResult.data;
    if (!override || Object.keys(override).length === 0) {
      reply.status(400);
      return { error: 'Empty override — use DELETE to remove an override' };
    }

    const capability = opts.resolveContextCapability?.(catId) ?? UNAVAILABLE_CONTEXT_CAPABILITY;

    // Zod .optional() produces `T | undefined` for nested props; our type uses optional-only.
    // Shapes are equivalent at runtime after validation.
    await saveSpan('strategy.persist', () =>
      setRuntimeOverride(catId, override as unknown as Partial<SessionStrategyConfig>),
    );
    request.log.info({ operator, catId, override }, 'session strategy override set');

    // Return the new effective config after applying the override
    const { effective, source, revision, changedAt } = getSessionStrategyWithSource(catId);
    return {
      catId,
      effective,
      source,
      revision,
      changedAt,
      executionStatus: executionStatusFor(capability, effective.strategy),
      override,
    };
  });

  /**
   * DELETE /api/config/session-strategy/:catId
   * Remove a runtime override for a variant cat — it falls back to lower-priority sources.
   */
  app.delete<{ Params: { catId: string } }>('/api/config/session-strategy/:catId', async (request, reply) => {
    const operator = resolveHeaderUserId(request);
    if (!operator) {
      reply.status(400);
      return { error: 'Identity required (X-Cat-Cafe-User header)' };
    }

    const { catId } = request.params;

    // Verify cat exists in registry
    if (!catRegistry.tryGet(catId)) {
      reply.status(404);
      return { error: `Unknown cat ID: "${catId}"` };
    }

    const existed = await deleteRuntimeOverride(catId);
    request.log.info({ operator, catId, deleted: existed }, 'session strategy override delete');
    if (!existed) {
      reply.status(404);
      return { error: `No runtime override exists for "${catId}"` };
    }

    // Return the new effective config after removing the override
    const { effective, source, revision, changedAt } = getSessionStrategyWithSource(catId);
    const capability = opts.resolveContextCapability?.(catId) ?? UNAVAILABLE_CONTEXT_CAPABILITY;
    return {
      catId,
      effective,
      source,
      revision,
      changedAt,
      executionStatus: executionStatusFor(capability, effective.strategy),
      deleted: true,
    };
  });
};
