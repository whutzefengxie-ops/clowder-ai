import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { beginMemberSave, traceSaveTransport } from '../member-save-trace';

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function records() {
  return JSON.parse(sessionStorage.getItem('member-save-diagnostics:v1') ?? '[]') as {
    traceId: string;
    events: { phase: string; state: string; durationMs?: number; attempt?: number; clientRequestId?: string }[];
  }[];
}

it('persists a pending stage and a slow marker before completion, without waiting for telemetry delivery', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  );
  const trace = beginMemberSave('http://isolated');
  let release!: () => void;
  const pending = trace.phase(
    'refresh',
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await vi.advanceTimersByTimeAsync(2500);
  expect(records()[0]?.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ phase: 'refresh', state: 'start' }),
      expect.objectContaining({ phase: 'save', state: 'slow' }),
    ]),
  );
  release();
  await pending;
  trace.finish();
  trace.committed();
  expect(records()[0]?.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ phase: 'save', state: 'finish', durationMs: 2500 }),
      expect.objectContaining({ phase: 'ui.commit' }),
    ]),
  );
  await vi.advanceTimersByTimeAsync(250);
});

it('keeps bounded local evidence when telemetry is offline, and never records error or config contents', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('offline')));
  for (let n = 0; n < 12; n++) {
    const trace = beginMemberSave('http://isolated');
    await expect(
      trace.phase('member.write', async () => {
        throw Error('api_key=private');
      }),
    ).rejects.toThrow('private');
    trace.finish();
  }
  expect(records()).toHaveLength(10);
  expect(records().at(-1)?.events.at(-1)?.state).toBe('failed');
  expect(JSON.stringify(records())).not.toContain('private');
});

it('records session waits and both physical attempts while propagating one save ID across a 401 retry', async () => {
  // The real apiFetch imports this same diagnostic registry.
  let attempts = 0;
  const fetchMock = vi.fn(
    async (url: string) =>
      new Response('{}', { status: url.endsWith('/api/cats/test') && ++attempts === 1 ? 401 : 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const { apiFetch } = await import('../api-client');
  const trace = beginMemberSave('http://isolated');
  const response = await apiFetch('/api/cats/test', { method: 'PATCH', headers: trace.headers(), body: '{}' });
  trace.finish();
  expect(response.status).toBe(200);
  const events = records()[0]?.events ?? [];
  expect(
    events.filter((e) => e.phase === 'http.attempt' && e.state !== 'start').map((e) => [e.attempt, e.state]),
  ).toEqual([
    [1, 'failed'],
    [2, 'finish'],
  ]);
  expect(events.some((e) => e.phase === 'session.refresh')).toBe(true);
  const writes = fetchMock.mock.calls.filter(([url]) => url.endsWith('/api/cats/test'));
  expect(writes).toHaveLength(2);
  expect(new Set(events.filter((e) => e.phase === 'http.attempt').map((e) => e.clientRequestId)).size).toBe(1);
});

it('classifies timeouts without logging their messages and tolerates disabled storage', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  const trace = beginMemberSave('http://isolated');
  const timeout = new Error('private request details');
  timeout.name = 'TimeoutError';
  await expect(
    traceSaveTransport(
      { headers: trace.headers() },
      'http.attempt',
      async () => {
        throw timeout;
      },
      1,
    ),
  ).rejects.toBe(timeout);
  expect(JSON.stringify(records())).toContain('"errorKind":"timeout"');
  expect(JSON.stringify(records())).not.toContain('private');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw Error('quota');
  });
  expect(() => trace.finish()).not.toThrow();
});
