/**
 * W3: per-Host-session native-open cache with structural compatibility gating.
 *
 * The cache owns the only authoritative answer to "may the next invocation
 * reuse this native fragment?". It compares structural compatibility keys, and
 * when the key changes it releases the old binding and opens a fresh fragment
 * with the new instructions/model/config — never a bridge object running stale
 * instructions. A live turn keeps its fragment; switching waits for it.
 *
 * A decision of `in_place_update` requires the caller-provided, persisted
 * adoption artifact to cover the target instruction digest; otherwise the
 * decision is `new_fragment` (C10). The cache never fabricates adoption.
 *
 * Internal / unstable (#1647).
 */
import type { IdentityAdoptionArtifact } from '@cat-cafe/shared';
import type { AgentServiceOptions as InvokeOptions } from '../../types.js';
import { compareCompatibility, digestText, stableConfigDigest } from './compatibility-key.js';
import type { CompatibilityStructure } from './compatibility-key.js';
import { decide } from './fragment-decision.js';
import type { FragmentDecision } from './fragment-decision.js';
import type * as Contract from './types.js';

export interface BridgeHostSession {
  sessionId: string;
  resumeNativeSessionId?: string;
}

/** Frozen open-time execution profile. Values are forwarded as-is; never invented. */
export interface BridgeOpenProfile {
  model?: string;
  config?: Record<string, unknown>;
}

/** A persisted fragment-switch fact the Host may append to the session record. */
export interface FragmentSwitchEvent {
  readonly sessionId: string;
  readonly reason: string;
  readonly changed: readonly string[];
}

export interface OpenCacheInput {
  readonly provider: Contract.AgentSessionProvider;
  readonly resolveOpenProfile?: (options: InvokeOptions) => BridgeOpenProfile | undefined;
  readonly resolveCompatibility?: (options: InvokeOptions) => CompatibilityStructure | undefined;
  readonly resolveIdentityArtifact?: (options: InvokeOptions) => IdentityAdoptionArtifact | undefined;
  readonly resumeOnUnavailable?: 'fail' | 'start_new';
  /** True while a turn on this Host session is still live. */
  readonly isActive: (sessionId: string) => boolean;
  readonly onFragmentSwitch?: (event: FragmentSwitchEvent) => void | Promise<void>;
  readonly log?: { info(...a: unknown[]): void; warn(...a: unknown[]): void };
}

interface OpenRequest {
  readonly hostSessionId: string;
  readonly options: InvokeOptions;
  readonly instructions: string;
  readonly cwd: string;
  readonly profile?: BridgeOpenProfile;
  readonly structure: CompatibilityStructure;
  readonly resume?: { nativeSessionId: string; onUnavailable: 'fail' | 'start_new' };
}

interface CachedOpen {
  readonly promise: Promise<Contract.OpenSessionResult>;
  readonly instructions: string;
  readonly structure: CompatibilityStructure;
  readonly profile?: BridgeOpenProfile;
}

export class SessionOpenCache {
  private readonly sessions = new Map<string, CachedOpen>();
  /** Serialises fragment decisions per Host session; concurrent callers never race a switch. */
  private readonly switches = new Map<string, Promise<void>>();
  /** Open attempt currently in flight per Host session, so concurrent callers share it (including its failure). */
  private readonly attempts = new Map<string, { readonly promise: Promise<Contract.OpenSessionResult>; readonly structure: CompatibilityStructure }>();
  /** Bumped by releaseAll so an open queued before the release never creates an orphan session. */
  private generation = 0;
  constructor(private readonly input: OpenCacheInput) {}

  /** Release every owned native session; failed releases only warn. */
  async releaseAll(reason: string): Promise<void> {
    this.generation += 1;
    const sessions = [...this.sessions];
    this.sessions.clear();
    this.switches.clear();
    this.attempts.clear();
    await Promise.all(
      sessions.map(async ([id, cached]) => {
        await this.releaseCached(id, cached, reason);
      }),
    );
  }

  /**
   * Open (or reuse) the native session for this Host session. Decisions are
   * serialised per Host session: two concurrent calls either share one open or
   * the second observes the first attempt's outcome, never a half-switched cache.
   */
  open(host: BridgeHostSession, options: InvokeOptions, signal: AbortSignal): Promise<Contract.OpenSessionResult> {
    const request = this.openRequest(host, options);
    // Fast path: an identical open is either already bound or still in flight;
    // share it instead of queueing behind (or duplicating) the same attempt.
    const cached = this.sessions.get(host.sessionId);
    if (cached && compareCompatibility(cached.structure, request.structure).compatible) return cached.promise;
    const inFlight = this.attempts.get(host.sessionId);
    if (inFlight && compareCompatibility(inFlight.structure, request.structure).compatible) return inFlight.promise;
    const previous = this.switches.get(host.sessionId) ?? Promise.resolve();
    const generation = this.generation;
    const attempt = previous.then(() => this.openSerialized(request, signal, generation));
    const tail = attempt.then(
      () => undefined,
      () => undefined,
    );
    this.switches.set(host.sessionId, tail);
    this.attempts.set(host.sessionId, { promise: attempt, structure: request.structure });
    void tail.then(() => {
      const tracked = this.attempts.get(host.sessionId);
      if (tracked?.promise === attempt) this.attempts.delete(host.sessionId);
      if (this.switches.get(host.sessionId) === tail) this.switches.delete(host.sessionId);
    });
    return attempt;
  }

  private releaseCached(id: string, cached: CachedOpen, reason: string): Promise<void> {
    return Promise.resolve()
      .then(async () => {
        if (!(await cached.promise).ok) return;
        const result = await this.input.provider.release(id, reason);
        if (!result.ok) this.input.log?.warn('Session release failed', result.reason);
      })
      .catch(() => this.input.log?.warn('Session release failed'));
  }

  private structure(options: InvokeOptions, profile: BridgeOpenProfile | undefined): CompatibilityStructure {
    const derived: CompatibilityStructure = {
      instructionDigest: digestText(`instructions:v1\n${options.systemPrompt ?? ''}`),
      workspaceRoot: options.workingDirectory ?? process.cwd(),
      ...(options.executionAccount ? { accountRef: options.executionAccount.accountRef } : {}),
      ...(profile?.model ? { model: profile.model } : {}),
      ...(profile?.config ? { launchConfigDigest: stableConfigDigest(profile.config) } : {}),
    };
    // Host-supplied structural facts may extend the bridge-derived ones, but the
    // bridge-owned instruction digest is authoritative for stale-instruction safety.
    return {
      ...derived,
      ...(this.input.resolveCompatibility?.(options) ?? {}),
      instructionDigest: derived.instructionDigest,
    };
  }

  private openRequest(host: BridgeHostSession, options: InvokeOptions): OpenRequest {
    const profile = this.input.resolveOpenProfile?.(options);
    const onUnavailable = this.input.resumeOnUnavailable ?? (options.requireExactResume ? 'fail' : 'start_new');
    return {
      hostSessionId: host.sessionId,
      options,
      instructions: options.systemPrompt ?? '',
      cwd: options.workingDirectory ?? process.cwd(),
      ...(profile ? { profile } : {}),
      structure: this.structure(options, profile),
      ...(host.resumeNativeSessionId
        ? { resume: { nativeSessionId: host.resumeNativeSessionId, onUnavailable } }
        : {}),
    };
  }

  private decisionFor(
    cached: CachedOpen,
    request: OpenRequest,
  ): { decision: FragmentDecision; changed: readonly string[] } {
    const comparison = compareCompatibility(cached.structure, request.structure);
    const capabilities = this.input.provider.capabilities(request.hostSessionId);
    const artifact = this.input.resolveIdentityArtifact?.(request.options);
    return {
      decision: decide({
        changed: comparison.compatible ? [] : comparison.changed,
        capabilities: { identityUpdate: capabilities.identityUpdate ?? 'new_fragment_only' },
        requested: {
          ...(request.structure.instructionDigest ? { instructionDigest: request.structure.instructionDigest } : {}),
          ...(artifact ? { identityArtifact: artifact } : {}),
        },
      }),
      changed: comparison.changed,
    };
  }

  private async openSerialized(
    request: OpenRequest,
    signal: AbortSignal,
    generation: number,
  ): Promise<Contract.OpenSessionResult> {
    // The caller may have been released/aborted while queued: never open a
    // native session the Host no longer owns.
    if (signal.aborted || generation !== this.generation) return { ok: false, code: 'failed', reason: 'released' };
    const cached = this.sessions.get(request.hostSessionId);
    let switching = false;
    if (cached) {
      // A live turn keeps its native fragment: never release it out from under a running turn.
      if (this.input.isActive(request.hostSessionId)) return cached.promise;
      const { decision, changed } = this.decisionFor(cached, request);
      if (decision.action === 'reuse') return cached.promise;
      if (decision.action === 'in_place_update') {
        this.sessions.set(request.hostSessionId, {
          ...cached,
          instructions: request.instructions,
          structure: request.structure,
          ...(request.profile ? { profile: request.profile } : {}),
        });
        return cached.promise;
      }
      switching = true;
      this.sessions.delete(request.hostSessionId);
      await this.releaseCached(request.hostSessionId, cached, 'session_incompatible');
      await this.reportFragmentSwitch(request, decision, changed);
    }
    // A new fragment must not resume the native session it replaces.
    const resume = switching ? undefined : request.resume;
    const opened = Promise.resolve().then(() =>
      this.input.provider.openSession(
        {
          sessionId: request.hostSessionId,
          instructions: request.instructions,
          cwd: request.cwd,
          ...(request.profile?.model ? { model: request.profile.model } : {}),
          ...(request.profile?.config ? { config: request.profile.config } : {}),
          ...(resume ? { resume } : {}),
        },
        signal,
      ),
    );
    const entry: CachedOpen = {
      promise: opened,
      instructions: request.instructions,
      structure: request.structure,
      ...(request.profile ? { profile: request.profile } : {}),
    };
    this.sessions.set(request.hostSessionId, entry);
    const forget = () => {
      if (this.sessions.get(request.hostSessionId) === entry) this.sessions.delete(request.hostSessionId);
    };
    void opened.then((result) => {
      if (!result.ok) forget();
    }, forget);
    return opened;
  }

  private async reportFragmentSwitch(
    request: OpenRequest,
    decision: FragmentDecision,
    changed: readonly string[],
  ): Promise<void> {
    const event: FragmentSwitchEvent = { sessionId: request.hostSessionId, reason: decision.reason, changed };
    this.input.log?.info('Session fragment switch', event);
    try {
      await this.input.onFragmentSwitch?.(event);
    } catch {
      this.input.log?.warn('Session fragment switch callback failed');
    }
  }
}
