import type { CatId, IdentityAdoptionArtifact } from '@cat-cafe/shared';
import type * as Service from '../../types.js';
import type { AgentMessage, AgentServiceOptions as InvokeOptions, MessageMetadata } from '../../types.js';
import { createActiveRunDispatcher } from './active-run-dispatcher.js';
import type { CompatibilityStructure } from './compatibility-key.js';
import { projectSessionEvent } from './event-projection.js';
import { SessionOpenCache } from './session-open-cache.js';
import type { BridgeHostSession, BridgeOpenProfile, FragmentSwitchEvent } from './session-open-cache.js';
import type * as Contract from './types.js';

export type { BridgeHostSession, BridgeOpenProfile, FragmentSwitchEvent };

interface BridgeInput {
  catId: CatId;
  provider: Contract.AgentSessionProvider;
  resolveHostSession(options: InvokeOptions | undefined): BridgeHostSession;
  resolveMcpServers?(options: InvokeOptions | undefined): Contract.McpServerDescriptor[];
  /** Frozen model/config for openSession; absent = adapter/native defaults. */
  resolveOpenProfile?(options: InvokeOptions | undefined): BridgeOpenProfile | undefined;
  /** Structural facts the Host knows beyond the bridge-derived instruction/workspace/account. */
  resolveCompatibility?(options: InvokeOptions | undefined): CompatibilityStructure | undefined;
  /** Persisted evidence that the current instructions were adopted in place (C10 gate). */
  resolveIdentityArtifact?(options: InvokeOptions | undefined): IdentityAdoptionArtifact | undefined;
  /** Caller's explicit resume choice; defaults to requireExactResume ? fail : start_new. */
  resumeOnUnavailable?: 'fail' | 'start_new';
  onContinuityEvidence?(
    evidence: Service.ProviderContinuityEvidence,
    ctx: { sessionId: string },
  ): void | Promise<void>;
  onFragmentSwitch?(event: FragmentSwitchEvent): void | Promise<void>;
  onCompactionObserved?(
    observation: Service.ProviderCompactionObservation,
    ctx: { sessionId: string },
  ): void | Promise<void>;
  passHostOptions?: boolean;
  metadata?: { provider: string; model: string };
  log?: { info(...a: unknown[]): void; warn(...a: unknown[]): void };
}

interface LiveTurn {
  sessionId: string;
  turn: Contract.TurnRef;
  accepting: boolean;
  receipts: Map<string, () => Promise<void>>;
  release?: () => void;
  dispatchRegistration?: Service.AgentClientActiveRunDispatchRegistration;
  registered?: boolean;
  /** Real provider-native session id; absent until the provider binds one. */
  nativeSessionId?: string;
  /** Set once cancellation was requested; awaited before any busy binding is released. */
  cancel?: Promise<Contract.CancelResult | undefined>;
}

class SessionFailure extends Error {
  constructor(
    readonly code: string,
    reason?: string,
  ) {
    super(reason ?? code);
  }
}

/** Internal / unstable. No provider-specific policy or Host invocation machinery crosses this boundary. */
export class AgentSessionBridgeService implements Service.AgentService {
  /** Host sessions with a live turn; a turn keeps its busy fence until it is proofably over. */
  private readonly active = new Set<string>();
  private readonly opens: SessionOpenCache;
  constructor(private readonly input: BridgeInput) {
    this.opens = new SessionOpenCache({
      provider: input.provider,
      ...(input.resolveOpenProfile ? { resolveOpenProfile: input.resolveOpenProfile } : {}),
      ...(input.resolveCompatibility ? { resolveCompatibility: input.resolveCompatibility } : {}),
      ...(input.resolveIdentityArtifact ? { resolveIdentityArtifact: input.resolveIdentityArtifact } : {}),
      ...(input.resumeOnUnavailable ? { resumeOnUnavailable: input.resumeOnUnavailable } : {}),
      ...(input.onFragmentSwitch ? { onFragmentSwitch: input.onFragmentSwitch } : {}),
      ...(input.log ? { log: input.log } : {}),
      isActive: (sessionId) => this.active.has(sessionId),
    });
  }
  invoke(prompt: string, options?: InvokeOptions): AsyncIterable<AgentMessage> {
    return this.run({ kind: 'frozen', text: prompt }, options);
  }
  invokeWithContinuityPreflight(
    preflight: Service.ProviderContinuityPreflight,
    options?: InvokeOptions,
  ): AsyncIterable<AgentMessage> {
    return this.run({ kind: 'deferred', settle: (facts) => preflight.settle(facts) }, options);
  }
  async releaseAll(reason: string): Promise<void> {
    this.active.clear();
    await this.opens.releaseAll(reason);
  }
  private register(live: LiveTurn): void {
    if (live.registered || !live.dispatchRegistration || !live.nativeSessionId || !live.turn.nativeTurnId) return;
    const capabilities = this.input.provider.capabilities(live.sessionId);
    if (capabilities.input !== 'supported') return;
    const { dispatcher } = createActiveRunDispatcher({
      provider: this.input.provider,
      sessionId: live.sessionId,
      nativeSessionId: live.nativeSessionId,
      nativeTurnId: live.turn.nativeTurnId,
      invocationId: live.dispatchRegistration.invocationId,
      turn: live.turn,
      capabilities,
      isAccepting: () => live.accepting,
      receipts: live.receipts,
      warn: (message) => this.input.log?.warn(message),
    });
    live.release = live.dispatchRegistration.register(dispatcher);
    live.registered = true;
  }
  private close(live: LiveTurn): void {
    live.accepting = false;
    const release = live.release;
    live.release = undefined;
    live.receipts.clear();
    release?.();
  }
  /**
   * The busy fence and the live-input registration are only released after the
   * provider confirms cancellation. A phase that stops short of stopped
   * execution (or a failed/unknown cancel) keeps the fence instead of claiming
   * a state the Host cannot prove (C12).
   */
  private async settleCancel(live: LiveTurn): Promise<boolean> {
    const pending = live.cancel;
    if (!pending) {
      this.active.delete(live.sessionId);
      this.close(live);
      return true;
    }
    const result = await pending;
    if (result?.phase) this.input.log?.info('Session cancel phase', result.phase);
    const confirmed = result?.ok === true || result?.code === 'turn_ended';
    const stopped =
      result?.phase === undefined || result.phase === 'execution_stopped' || result.phase === 'host_terminal';
    if (!confirmed || !stopped) return false;
    this.active.delete(live.sessionId);
    this.close(live);
    return true;
  }
  private async observe(event: Contract.AgentSessionEvent, live: LiveTurn): Promise<void> {
    if (event.type === 'input_read') {
      const receipt = live.receipts.get(event.deliveryId);
      live.receipts.delete(event.deliveryId);
      void Promise.resolve()
        .then(receipt)
        .catch(() => this.input.log?.warn('Input receipt failed'));
    }
    if (event.type === 'continuity') {
      this.input.log?.info('Session continuity', event.evidence);
      void Promise.resolve(this.input.onContinuityEvidence?.(event.evidence, { sessionId: live.sessionId })).catch(
        () => this.input.log?.warn('Continuity evidence callback failed'),
      );
    }
    if (event.type === 'compaction_observed') {
      try {
        await this.input.onCompactionObserved?.(event.observation, { sessionId: live.sessionId });
      } catch {
        this.input.log?.warn('Compaction observation callback failed');
      }
    }
  }
  private async *consume(
    events: AsyncIterable<Contract.AgentSessionEvent>,
    live: LiveTurn,
    metadata: MessageMetadata,
    signal: AbortSignal,
    session: Extract<Contract.OpenSessionResult, { ok: true }>,
  ): AsyncIterable<AgentMessage> {
    let wake = () => {};
    const aborted = new Promise<undefined>((resolve) => {
      wake = () => resolve(undefined);
    });
    const cancel = () => {
      live.accepting = false;
      wake();
      if (live.cancel) return;
      live.cancel = this.input.provider.cancelTurn(live.sessionId, live.turn, 'abort').then(
        (result) => result,
        () => {
          this.input.log?.warn('Session turn cancellation failed');
          return undefined;
        },
      );
    };
    const iterator = events[Symbol.asyncIterator]();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      while (!signal.aborted) {
        const next = await Promise.race([iterator.next(), aborted]);
        if (!next || next.done || signal.aborted) return;
        await this.observe(next.value, live);
        if (signal.aborted) return;
        if (next.value.type === 'native_bound') {
          session.binding = { state: 'bound', nativeSessionId: next.value.nativeSessionId };
          live.nativeSessionId = next.value.nativeSessionId;
          this.register(live);
        }
        for (const message of projectSessionEvent(next.value, { catId: this.input.catId, metadata })) yield message;
        if (next.value.type === 'done') return;
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      void iterator.return?.().catch(() => {});
    }
  }
  private message(type: AgentMessage['type'], metadata: MessageMetadata, extra: Partial<AgentMessage>): AgentMessage {
    return { type, catId: this.input.catId, metadata: { ...metadata }, timestamp: Date.now(), ...extra };
  }
  private async prepare(
    options: InvokeOptions | undefined,
    signal: AbortSignal,
    prompt: Contract.PromptSource,
    metadata: MessageMetadata,
  ) {
    if (!options) throw new SessionFailure('host_session_unavailable');
    if (!options.invocationId) throw new SessionFailure('invocation_id_missing');
    // A pre-aborted invocation must not open a native session it will never use.
    if (signal.aborted) throw new SessionFailure('cancelled');
    const host = this.input.resolveHostSession(options);
    const session = await this.opens.open(host, options, signal);
    if (!session.ok) throw new SessionFailure(session.code, session.reason);
    const invocation = {
      invocationId: options.invocationId,
      callbackEnv: options.callbackEnv ?? {},
      mcpServers: this.input.resolveMcpServers?.(options) ?? [],
      ...(options.toolExecutionPolicy ? { toolExecutionPolicy: options.toolExecutionPolicy } : {}),
      ...(options.requiredTools ? { requiredTools: options.requiredTools } : {}),
    };
    if (this.active.has(host.sessionId)) throw new SessionFailure('session_busy');
    if (session.binding.state === 'bound') metadata.sessionId = session.binding.nativeSessionId;
    if (
      prompt.kind === 'deferred' &&
      this.input.provider.capabilities(host.sessionId).continuityEvidence !== 'pre_send'
    )
      throw new SessionFailure('continuity_preflight_unsupported');
    if (signal.aborted) throw new SessionFailure('cancelled');
    this.active.add(host.sessionId);
    const live: LiveTurn = {
      sessionId: host.sessionId,
      turn: { invocationId: invocation.invocationId },
      accepting: true,
      receipts: new Map(),
      ...(session.binding.state === 'bound' ? { nativeSessionId: session.binding.nativeSessionId } : {}),
      ...(options.activeRunDispatch ? { dispatchRegistration: options.activeRunDispatch } : {}),
    };
    return { host, session, invocation, live };
  }
  private failure(error: unknown): SessionFailure {
    if (error instanceof SessionFailure) return error;
    return new SessionFailure('session_contract_failed', error instanceof Error ? error.message : String(error));
  }
  private terminalMessage(
    terminal: AgentMessage | undefined,
    metadata: MessageMetadata,
    signal: AbortSignal,
    cancelUnconfirmed: boolean,
  ): AgentMessage {
    // A synthetic terminal uses the final session context; a provider terminal keeps its own usage fact.
    const done = terminal ?? this.message('done', metadata, { errorCode: 'provider_stream_ended_without_done' });
    if (signal.aborted) done.errorCode = cancelUnconfirmed ? 'cancel_unconfirmed' : 'cancelled';
    return done;
  }
  private async *run(prompt: Contract.PromptSource, options?: InvokeOptions): AsyncIterable<AgentMessage> {
    const metadata: MessageMetadata = {
      ...(this.input.metadata ?? { provider: 'session-contract', model: 'unknown' }),
    };
    const signal = options?.signal ?? new AbortController().signal;
    let live: LiveTurn | undefined;
    let terminal: AgentMessage | undefined;
    let cancelUnconfirmed = false;
    try {
      const prepared = await this.prepare(options, signal, prompt, metadata);
      live = prepared.live;
      const { host, session, invocation } = prepared;
      const started = await this.input.provider.startTurn(
        host.sessionId,
        { invocation, prompt, ...(this.input.passHostOptions ? { hostOptions: options } : {}) },
        signal,
      );
      if (!started.ok) throw new SessionFailure(started.code, started.reason);
      live.turn = started.turn;
      if (!signal.aborted) this.register(live);
      for await (const message of this.consume(started.events, live, metadata, signal, session)) {
        if (message.type === 'done') {
          terminal = message;
          break;
        }
        yield message;
      }
    } catch (error) {
      const failure = this.failure(error);
      terminal = this.message('done', metadata, { errorCode: failure.code });
      if (!signal.aborted) yield this.message('error', metadata, { errorCode: failure.code, error: failure.message });
    } finally {
      if (live) cancelUnconfirmed = !(await this.settleCancel(live));
    }
    yield this.terminalMessage(terminal, metadata, signal, cancelUnconfirmed);
  }
}
