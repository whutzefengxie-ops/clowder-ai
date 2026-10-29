import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentServiceOptions } from '../../src/domains/cats/services/types.js';
import { AgentSessionBridgeService } from '../../src/domains/cats/services/agents/session-contract/AgentSessionBridgeService.js';
import { digestText } from '../../src/domains/cats/services/agents/session-contract/compatibility-key.js';
import type * as Contract from '../../src/domains/cats/services/agents/session-contract/types.js';

class Inbox implements AsyncIterable<Contract.AgentSessionEvent> {
  private values: Contract.AgentSessionEvent[] = [];
  private waiters: ((result: IteratorResult<Contract.AgentSessionEvent>) => void)[] = [];
  private closed = false;
  push(value: Contract.AgentSessionEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }
  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined as never });
  }
  [Symbol.asyncIterator](): Inbox {
    return this;
  }
  async next(): Promise<IteratorResult<Contract.AgentSessionEvent>> {
    if (this.values.length > 0) return { value: this.values.shift() as Contract.AgentSessionEvent, done: false };
    if (this.closed) return { done: true, value: undefined as never };
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  async return(): Promise<IteratorResult<Contract.AgentSessionEvent>> {
    this.close();
    return { done: true, value: undefined as never };
  }
}

function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean, description: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${description}`);
}

function stream(events: Contract.AgentSessionEvent[]): AsyncIterable<Contract.AgentSessionEvent> {
  return (async function* () {
    yield* events;
  })();
}

function sessionEvent(type: string, fields: Record<string, unknown>): Contract.AgentSessionEvent {
  return { scope: 'session', sessionId: 'host', seq: 1, type, ...fields } as Contract.AgentSessionEvent;
}

function turnEvent(type: string, fields: Record<string, unknown> = {}): Contract.AgentSessionEvent {
  return {
    scope: 'turn',
    sessionId: 'host',
    seq: 1,
    turn: { invocationId: 'inv-1', nativeTurnId: 'turn-1' },
    type,
    ...fields,
  } as Contract.AgentSessionEvent;
}

class FakeProvider implements Contract.AgentSessionProvider {
  calls = {
    open: [] as Contract.OpenSessionInput[],
    start: [] as { sessionId: string; input: Contract.TurnInput }[],
    cancel: [] as { sessionId: string; expected: Contract.TurnRef; reason: string }[],
    release: [] as { sessionId: string; reason: string }[],
    inspect: [] as { sessionId: string; deliveryId: string }[],
  };
  support: Contract.AgentSessionCapabilities = {
    input: 'unsupported',
    inputReadReceipt: 'unsupported',
    inspectInput: 'unsupported',
    cancelTurn: 'supported',
    compact: 'unsupported',
    observesCompaction: false,
    continuityEvidence: 'none',
  };
  binding: Contract.NativeBinding = { state: 'bound', nativeSessionId: 'native-1' };
  events: AsyncIterable<Contract.AgentSessionEvent> = stream([]);
  omitNativeTurn = false;
  openGate?: Promise<void>;
  openResult?: Contract.OpenSessionResult | ((callIndex: number) => Contract.OpenSessionResult);
  startResult?: Contract.StartTurnResult;
  cancelResult: Contract.CancelResult = { ok: true };
  cancelGate?: Promise<void>;
  cancelError?: Error;
  capabilityFor?: (sessionId: string) => Contract.AgentSessionCapabilities;
  capabilities(sessionId: string): Contract.AgentSessionCapabilities {
    return this.capabilityFor?.(sessionId) ?? this.support;
  }
  async openSession(input: Contract.OpenSessionInput): Promise<Contract.OpenSessionResult> {
    this.calls.open.push(input);
    await this.openGate;
    if (typeof this.openResult === 'function') return this.openResult(this.calls.open.length);
    return this.openResult ?? { ok: true, binding: this.binding };
  }
  async startTurn(sessionId: string, input: Contract.TurnInput): Promise<Contract.StartTurnResult> {
    this.calls.start.push({ sessionId, input });
    if (this.startResult) return this.startResult;
    const turn: Contract.TurnRef = {
      invocationId: input.invocation.invocationId,
      ...(this.omitNativeTurn ? {} : { nativeTurnId: 'turn-1' }),
    };
    return { ok: true, turn, events: this.events };
  }
  async input(): Promise<Contract.InputResult> {
    return { status: 'accepted' };
  }
  async inspectInput(sessionId: string, _expected: Contract.TurnRef, deliveryId: string) {
    this.calls.inspect.push({ sessionId, deliveryId });
    return 'accepted' as const;
  }
  async cancelTurn(sessionId: string, expected: Contract.TurnRef, reason: string): Promise<Contract.CancelResult> {
    this.calls.cancel.push({ sessionId, expected, reason });
    if (this.cancelError) throw this.cancelError;
    await this.cancelGate;
    return this.cancelResult;
  }
  async release(sessionId: string, reason: string): Promise<{ ok: true }> {
    this.calls.release.push({ sessionId, reason });
    return { ok: true };
  }
}

function bridgeFor(provider: FakeProvider, overrides: Record<string, unknown> = {}): AgentSessionBridgeService {
  return new AgentSessionBridgeService({
    catId: 'codex',
    provider,
    resolveHostSession: (options) => ({
      sessionId: options?.hostSessionId ?? 'host',
      resumeNativeSessionId: options?.sessionId,
    }),
    ...overrides,
  });
}

const options = (extra: Partial<AgentServiceOptions> = {}): AgentServiceOptions => ({
  invocationId: 'inv-1',
  hostSessionId: 'host',
  ...extra,
});

const run = async (service: AgentSessionBridgeService, prompt: string, opts = options()) =>
  Array.fromAsync(service.invoke(prompt, opts));

test('W3: changed instructions release the old binding and re-open a new fragment with the new instructions', async () => {
  const provider = new FakeProvider();
  provider.events = stream([turnEvent('done', { outcome: 'completed' })]);
  const switches: unknown[] = [];
  const service = bridgeFor(provider, { onFragmentSwitch: (event: unknown) => switches.push(event) });

  await run(service, 'a', options({ systemPrompt: 'A', sessionId: 'native-old' }));
  assert.equal(provider.calls.open.length, 1);
  assert.deepEqual(provider.calls.open[0].resume, { nativeSessionId: 'native-old', onUnavailable: 'start_new' });

  await run(service, 'b', options({ systemPrompt: 'B', sessionId: 'native-old' }));
  assert.equal(provider.calls.open.length, 2, 'stale instructions must never be reused');
  assert.equal(provider.calls.open[1].instructions, 'B');
  assert.equal(provider.calls.open[1].resume, undefined, 'a new fragment must not resume the replaced one');
  assert.deepEqual(provider.calls.release, [{ sessionId: 'host', reason: 'session_incompatible' }]);
  assert.equal(provider.calls.start.length, 2);
  assert.deepEqual(switches, [
    { sessionId: 'host', reason: 'identity_update_unverified', changed: ['instructionDigest'] },
  ]);
});

test('W3: identical instructions reuse the open native session', async () => {
  const provider = new FakeProvider();
  provider.events = stream([turnEvent('done', { outcome: 'completed' })]);
  const service = bridgeFor(provider);
  await run(service, 'first', options({ systemPrompt: 'same' }));
  await run(service, 'second', options({ invocationId: 'inv-2', systemPrompt: 'same' }));
  assert.equal(provider.calls.open.length, 1);
  assert.equal(provider.calls.start.length, 2);
  assert.deepEqual(provider.calls.release, []);
});

test('W3: concurrent callers share one failed open and a later call retries it', async () => {
  const gate = deferred();
  const provider = new FakeProvider();
  provider.openGate = gate.promise;
  provider.openResult = (callIndex) =>
    callIndex === 1
      ? { ok: false, code: 'failed', reason: 'cold start failed' }
      : { ok: true, binding: { state: 'bound', nativeSessionId: 'native-1' } };
  provider.events = stream([turnEvent('done', { outcome: 'completed' })]);
  const service = bridgeFor(provider);

  const first = Array.fromAsync(service.invoke('first', options({ invocationId: 'inv-1' })));
  const second = Array.fromAsync(service.invoke('second', options({ invocationId: 'inv-2' })));
  await waitFor(() => provider.calls.open.length === 1, 'shared open');
  gate.resolve();
  const [firstMessages, secondMessages] = await Promise.all([first, second]);
  assert.equal(provider.calls.open.length, 1, 'both callers must await the same failed open');
  for (const messages of [firstMessages, secondMessages]) {
    assert.deepEqual(
      messages.map((message) => [message.type, message.errorCode]),
      [
        ['error', 'failed'],
        ['done', 'failed'],
      ],
    );
  }

  const third = await run(service, 'third', options({ invocationId: 'inv-3' }));
  assert.equal(provider.calls.open.length, 2, 'a later call retries the failed open');
  assert.deepEqual(third.map((message) => message.type), ['done']);
});

test('C10: verified in-place identity update + matching adoption artifact keeps the native fragment', async () => {
  const provider = new FakeProvider();
  provider.events = stream([turnEvent('done', { outcome: 'completed' })]);
  provider.support = { ...provider.support, identityUpdate: 'in_place_verified' };
  let adoption: string | undefined;
  const service = bridgeFor(provider, {
    resolveIdentityArtifact: () =>
      adoption
        ? { v: 1 as const, instructionDigest: adoption, evidenceRef: 'evidence', adoptedAt: 1 }
        : undefined,
  });
  await run(service, 'a', options({ systemPrompt: 'A' }));
  const newTarget = digestText('instructions:v1\nB');
  adoption = newTarget;
  const messages = await run(service, 'b', options({ invocationId: 'inv-2', systemPrompt: 'B' }));
  assert.equal(provider.calls.open.length, 1, 'a verified adoption does not rebuild the fragment');
  assert.deepEqual(provider.calls.release, []);
  assert.equal(provider.calls.start.length, 2);
  assert.deepEqual(messages.map((message) => message.type), ['done']);
});

test('C10: stale adoption evidence never claims an in-place update', async () => {
  const provider = new FakeProvider();
  provider.events = stream([turnEvent('done', { outcome: 'completed' })]);
  provider.support = { ...provider.support, identityUpdate: 'in_place_verified' };
  const service = bridgeFor(provider, {
    resolveIdentityArtifact: () => ({
      v: 1 as const,
      instructionDigest: digestText('instructions:v1\nstale'),
      evidenceRef: 'evidence',
      adoptedAt: 1,
    }),
  });
  await run(service, 'a', options({ systemPrompt: 'A' }));
  await run(service, 'b', options({ invocationId: 'inv-2', systemPrompt: 'B' }));
  assert.equal(provider.calls.open.length, 2);
  assert.equal(provider.calls.release.length, 1);
});

test('W3: frozen model/config reach openSession and their change rebuilds the fragment', async () => {
  const provider = new FakeProvider();
  provider.events = stream([turnEvent('done', { outcome: 'completed' })]);
  let profile: { model?: string; config?: Record<string, unknown> } | undefined = {
    model: 'model-a',
    config: { sandbox: 'read-only', callbackToken: 'secret-1' },
  };
  const service = bridgeFor(provider, { resolveOpenProfile: () => profile });
  await run(service, 'a', options());
  assert.equal(provider.calls.open[0].model, 'model-a');
  assert.deepEqual(provider.calls.open[0].config, { sandbox: 'read-only', callbackToken: 'secret-1' });

  profile = { model: 'model-b', config: { sandbox: 'read-only', callbackToken: 'secret-2' } };
  await run(service, 'b', options({ invocationId: 'inv-2' }));
  assert.equal(provider.calls.open.length, 2, 'model change must not reuse the old native fragment');
  assert.equal(provider.calls.open[1].model, 'model-b');
  assert.equal(provider.calls.open[1].resume, undefined);
});

test('W3: openSession omits model/config when the caller supplied none', async () => {
  const provider = new FakeProvider();
  provider.events = stream([turnEvent('done', { outcome: 'completed' })]);
  const service = bridgeFor(provider);
  await run(service, 'a', options());
  assert.equal(provider.calls.open[0].model, undefined);
  assert.equal(provider.calls.open[0].config, undefined);
});

test('W3: caller resume.onUnavailable is honoured; requireExactResume means fail', async () => {
  const resumeOf = async (overrides: Record<string, unknown>, opts = options({ sessionId: 'native-old' })) => {
    const provider = new FakeProvider();
    provider.events = stream([turnEvent('done', { outcome: 'completed' })]);
    const service = bridgeFor(provider, overrides);
    await run(service, 'a', opts);
    return provider.calls.open[0].resume;
  };
  assert.deepEqual(await resumeOf({}), { nativeSessionId: 'native-old', onUnavailable: 'start_new' });
  assert.deepEqual(await resumeOf({ resumeOnUnavailable: 'fail' }), {
    nativeSessionId: 'native-old',
    onUnavailable: 'fail',
  });
  assert.deepEqual(await resumeOf({}, options({ sessionId: 'native-old', requireExactResume: true })), {
    nativeSessionId: 'native-old',
    onUnavailable: 'fail',
  });
});

test('C12/C13: no dispatcher is registered without real native ids; a mid-turn bind registers the real ids later', async () => {
  const inbox = new Inbox();
  const provider = new FakeProvider();
  provider.support = { ...provider.support, input: 'supported' };
  provider.binding = { state: 'pending_first_input' };
  provider.events = inbox;
  const registrations: { handle: { threadId: string; turnId: string }; invocationId: string }[] = [];
  const releases: unknown[] = [];
  const service = bridgeFor(provider);

  const iterator = service
    .invoke(
      'a',
      options({
        activeRunDispatch: {
          invocationId: 'inv-1',
          register: (dispatcher) => {
            registrations.push(dispatcher);
            return () => releases.push(dispatcher);
          },
        },
      }),
    )
    [Symbol.asyncIterator]();
  const first = iterator.next();
  await waitFor(() => provider.calls.start.length === 1, 'startTurn');
  assert.equal(registrations.length, 0, 'no Host ids may be substituted for native ids');

  inbox.push(sessionEvent('native_bound', { nativeSessionId: 'native-late' }));
  inbox.push(turnEvent('status', { phase: 'running' }));
  const opened = await first;
  assert.equal(opened.value.type, 'session_init');
  await waitFor(() => registrations.length === 1, 'late registration after native_bound');
  assert.deepEqual(
    { threadId: registrations[0].handle.threadId, turnId: registrations[0].handle.turnId },
    { threadId: 'native-late', turnId: 'turn-1' },
  );

  inbox.push(turnEvent('done', { outcome: 'completed' }));
  inbox.close();
  await Array.fromAsync(iterator);
  assert.equal(releases.length, 1);
});

for (const [label, binding, omitNativeTurn] of [
  ['pending binding without a native turn id', { state: 'pending_first_input' }, true],
  ['bound binding without a native turn id', { state: 'bound', nativeSessionId: 'native-1' }, true],
] as const)
  test(`C12: no fabricated handle when ${label}`, async () => {
    const provider = new FakeProvider();
    provider.binding = binding;
    provider.omitNativeTurn = omitNativeTurn;
    provider.support = { ...provider.support, input: 'supported' };
    provider.events = stream([turnEvent('done', { outcome: 'completed' })]);
    const registrations: unknown[] = [];
    const service = bridgeFor(provider);
    await run(
      service,
      'a',
      options({
        activeRunDispatch: {
          invocationId: 'inv-1',
          register: (dispatcher) => {
            registrations.push(dispatcher);
          },
        },
      }),
    );
    assert.equal(registrations.length, 0);
  });

test('W3: continuity evidence is surfaced through an explicit callback', async () => {
  const evidence = { kind: 'started', runtimeSessionId: 'native-1' };
  const provider = new FakeProvider();
  provider.events = stream([
    sessionEvent('continuity', { evidence }),
    turnEvent('done', { outcome: 'completed' }),
  ]);
  const observed: unknown[] = [];
  const service = bridgeFor(provider, {
    onContinuityEvidence: (value: unknown, ctx: unknown) => observed.push({ value, ctx }),
  });
  await run(service, 'a', options());
  assert.deepEqual(observed, [{ value: evidence, ctx: { sessionId: 'host' } }]);
});

test('C12: busy binding and dispatcher are not released until the provider confirms cancellation', async () => {
  const inbox = new Inbox();
  const gate = deferred();
  const provider = new FakeProvider();
  provider.support = { ...provider.support, input: 'supported', inputReadReceipt: 'supported' };
  provider.events = inbox;
  provider.cancelGate = gate.promise;
  const releases: unknown[] = [];
  const service = bridgeFor(provider);
  const controller = new AbortController();
  const iterator = service
    .invoke(
      'a',
      options({
        signal: controller.signal,
        activeRunDispatch: {
          invocationId: 'inv-1',
          register: (dispatcher) => {
            return () => releases.push(dispatcher);
          },
        },
      }),
    )
    [Symbol.asyncIterator]();
  const pending = iterator.next();
  await waitFor(() => provider.calls.start.length === 1, 'startTurn');
  inbox.push(turnEvent('status', { phase: 'running' }));
  await pending;
  controller.abort();
  await waitFor(() => provider.calls.cancel.length === 1, 'cancelTurn');
  assert.equal(releases.length, 0, 'cancellation must not be claimed before the provider confirms');
  gate.resolve();
  inbox.close();
  const rest = await Array.fromAsync(iterator);
  assert.equal(rest.at(-1)?.errorCode, 'cancelled');
  assert.equal(releases.length, 1, 'the confirmed cancellation releases the dispatcher exactly once');
  const next = await run(service, 'b', options({ invocationId: 'inv-2' }));
  assert.deepEqual(next.map((message) => message.type), ['done']);
});

test('C12: a provider cancel phase short of stopped execution keeps the busy fence and reports unknown', async () => {
  const inbox = new Inbox();
  const provider = new FakeProvider();
  provider.support = { ...provider.support, input: 'supported' };
  provider.events = inbox;
  provider.cancelResult = { ok: true, phase: 'client_accepted' };
  const releases: unknown[] = [];
  const service = bridgeFor(provider);
  const controller = new AbortController();
  const iterator = service
    .invoke(
      'a',
      options({
        signal: controller.signal,
        activeRunDispatch: {
          invocationId: 'inv-1',
          register: () => () => releases.push('released'),
        },
      }),
    )
    [Symbol.asyncIterator]();
  const first = iterator.next();
  await waitFor(() => provider.calls.start.length === 1, 'startTurn');
  inbox.push(turnEvent('status', { phase: 'running' }));
  await first;
  controller.abort();
  inbox.close();
  const rest = await Array.fromAsync(iterator);
  assert.equal(rest.at(-1)?.errorCode, 'cancel_unconfirmed');
  assert.equal(releases.length, 0);

  const busy = await run(service, 'b', options({ invocationId: 'inv-2' }));
  assert.deepEqual(
    busy.map((message) => message.errorCode),
    ['session_busy', 'session_busy'],
  );

  await service.releaseAll('test');
  assert.equal(provider.calls.release.length, 1);
  provider.events = stream([turnEvent('done', { outcome: 'completed' })]);
  const recovered = await run(service, 'c', options({ invocationId: 'inv-3' }));
  assert.deepEqual(recovered.map((message) => message.type), ['done']);
  assert.equal(provider.calls.open.length, 2);
});

test('C12: a failed cancellation keeps the fence and reports unknown', async () => {
  const inbox = new Inbox();
  const provider = new FakeProvider();
  provider.events = inbox;
  provider.cancelError = new Error('cancel transport broke');
  const service = bridgeFor(provider);
  const controller = new AbortController();
  const iterator = service.invoke('a', options({ signal: controller.signal }))[Symbol.asyncIterator]();
  const first = iterator.next();
  await waitFor(() => provider.calls.start.length === 1, 'startTurn');
  inbox.push(turnEvent('status', { phase: 'running' }));
  await first;
  controller.abort();
  inbox.close();
  const rest = await Array.fromAsync(iterator);
  assert.equal(rest.at(-1)?.errorCode, 'cancel_unconfirmed');
  await service.releaseAll('test');
});

test('W3: a releaseAll before a queued open never creates an orphan native session', async () => {
  const provider = new FakeProvider();
  provider.events = stream([turnEvent('done', { outcome: 'completed' })]);
  const service = bridgeFor(provider);
  const collected = Array.fromAsync(service.invoke('a', options()));
  await service.releaseAll('shutdown');
  const messages = await collected;
  assert.equal(provider.calls.open.length, 0);
  assert.deepEqual(
    messages.map((message) => [message.type, message.errorCode]),
    [
      ['error', 'failed'],
      ['done', 'failed'],
    ],
  );
});

test('W3: a pre-send failure keeps its code and never starts fabricated native work', async () => {
  const provider = new FakeProvider();
  provider.startResult = { ok: false, code: 'pre_send_failed', reason: 'frozen snapshot missing' };
  const service = bridgeFor(provider);
  const messages = await run(service, 'a', options());
  assert.deepEqual(
    messages.map((message) => [message.type, message.errorCode]),
    [
      ['error', 'pre_send_failed'],
      ['done', 'pre_send_failed'],
    ],
  );
  assert.equal(provider.calls.start.length, 1);
});
