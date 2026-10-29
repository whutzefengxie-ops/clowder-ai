/**
 * C09 / O1 / F1: ACP permission requests fail closed.
 *
 * No permission handler and no explicit member auto-authorization
 * (`acp.permissionPolicy: 'auto_allow'`) must never select or manufacture an
 * allow option: the client answers with an explicit reject option, or cancels
 * when the agent offers none. The explicit opt-in preserves the legacy
 * auto-approve behavior. A no-id `session/request_permission` notification
 * still emits `permission_pending` (idle-stall suppression) but never grants
 * allow under the fail-closed policy.
 *
 * These tests import src via tsx on purpose: the regular `test/acp/*.test.js`
 * suite imports `dist`, which requires a build. The same behavior is covered
 * there after the Lead's build (acp-client.test.js / acp-httpstream-client.test.js).
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAcpPermissionPolicy } from '../../src/config/cat-config-loader.js';
import { AcpClient } from '../../src/domains/cats/services/agents/providers/acp/AcpClient.js';
import { AcpHttpStreamClient } from '../../src/domains/cats/services/agents/providers/acp/AcpHttpStreamClient.js';
import type { AcpSessionUpdate } from '../../src/domains/cats/services/agents/providers/acp/types.js';

const INIT_RESULT = {
  protocolVersion: 1,
  authMethods: [],
  agentInfo: { name: 'test', title: 'Test Agent', version: '1.0.0' },
  agentCapabilities: { loadSession: true },
};

type SpawnFn = typeof nodeSpawn;
type JsonRecord = Record<string, unknown>;

function createMockChild() {
  const clientStdin = new PassThrough();
  const agentStdout = new PassThrough();
  const agentStderr = new PassThrough();
  const ee = new EventEmitter();
  const child = {
    pid: 12345,
    stdin: clientStdin,
    stdout: agentStdout,
    stderr: agentStderr,
    killed: false,
    kill: () => {
      child.killed = true;
      agentStdout.end();
      agentStderr.end();
      ee.emit('exit', 0, null);
      return true;
    },
    on: ee.on.bind(ee),
    once: ee.once.bind(ee),
    removeListener: ee.removeListener.bind(ee),
  };
  return { child, clientStdin, agentStdout };
}

/** Adapt a plain mock to the injected spawn surface without a real process. */
function spawnFnFor(child: unknown): SpawnFn {
  return (() => child) as unknown as SpawnFn;
}

function agentRespond(agentStdout: PassThrough, id: unknown, result: unknown): void {
  setImmediate(() => agentStdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`));
}

function agentNotify(agentStdout: PassThrough, method: string, params: unknown): void {
  setImmediate(() => agentStdout.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read every JSON-RPC line the client writes to agent stdin. */
function collectAgentStdin(clientStdin: PassThrough, onMethod?: (message: JsonRecord) => void): JsonRecord[] {
  const messages: JsonRecord[] = [];
  clientStdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().trim().split('\n')) {
      if (!line) continue;
      const message = JSON.parse(line) as JsonRecord;
      messages.push(message);
      if (message.method !== undefined) onMethod?.(message);
    }
  });
  return messages;
}

function permissionOutcome(message: JsonRecord | undefined): { outcome: string; optionId?: string } | undefined {
  const result = message?.result as { outcome?: { outcome?: string; optionId?: string } } | undefined;
  const outcome = result?.outcome;
  if (!outcome || typeof outcome.outcome !== 'string') return undefined;
  return { outcome: outcome.outcome, ...(outcome.optionId ? { optionId: outcome.optionId } : {}) };
}

function permissionRequest(params: JsonRecord): string {
  return `${JSON.stringify({ jsonrpc: '2.0', method: 'session/request_permission', ...params })}\n`;
}

describe('resolveAcpPermissionPolicy (C09)', () => {
  it('opts in only for the exact explicit auto_allow value; everything else fails closed', () => {
    assert.equal(resolveAcpPermissionPolicy('auto_allow'), 'allow');
    const failClosed = [undefined, null, '', 'deny', 'allow', 'auto-allow', 'AUTO_ALLOW', true, 1, {}, []];
    for (const value of failClosed) {
      assert.equal(resolveAcpPermissionPolicy(value), 'reject', `policy ${JSON.stringify(value)} must never allow`);
    }
  });
});

describe('AcpClient permission default (C09)', () => {
  it('selects an explicit reject option when no handler and no explicit policy exist', async () => {
    const { child, clientStdin, agentStdout } = createMockChild();
    const responses = collectAgentStdin(clientStdin, (message) => {
      if (message.method === 'initialize') agentRespond(agentStdout, message.id, INIT_RESULT);
    });
    const client = new AcpClient({ command: 'fake', args: [], cwd: '/tmp', spawnFn: spawnFnFor(child) });
    try {
      await client.initialize();
      agentStdout.write(
        permissionRequest({
          id: 'perm-reject',
          params: {
            sessionId: 'session-1',
            options: [
              { optionId: 'allow-once', kind: 'allow_once', name: 'Allow' },
              { optionId: 'allow-always', kind: 'allow_always', name: 'Always allow' },
              { optionId: 'reject-once', kind: 'reject_once', name: 'Reject' },
            ],
          },
        }),
      );
      await delay(40);
      const response = responses.find((message) => message.id === 'perm-reject');
      assert.deepEqual(permissionOutcome(response), { outcome: 'selected', optionId: 'reject-once' });
    } finally {
      await client.close();
    }
  });

  it('cancels instead of inventing an allow option when the agent only offers allows', async () => {
    const { child, clientStdin, agentStdout } = createMockChild();
    const responses = collectAgentStdin(clientStdin, (message) => {
      if (message.method === 'initialize') agentRespond(agentStdout, message.id, INIT_RESULT);
    });
    const client = new AcpClient({ command: 'fake', args: [], cwd: '/tmp', spawnFn: spawnFnFor(child) });
    try {
      await client.initialize();
      agentStdout.write(
        permissionRequest({
          id: 'perm-cancel',
          params: {
            sessionId: 'session-1',
            options: [
              { optionId: 'allow-once', kind: 'allow_once', name: 'Allow' },
              { optionId: 'allow-always', kind: 'allow_always', name: 'Always allow' },
            ],
          },
        }),
      );
      await delay(40);
      const response = responses.find((message) => message.id === 'perm-cancel');
      assert.deepEqual(permissionOutcome(response), { outcome: 'cancelled' });
    } finally {
      await client.close();
    }
  });

  it('keeps the legacy allow_always behavior for an explicit auto-allow client decision', async () => {
    const { child, clientStdin, agentStdout } = createMockChild();
    const responses = collectAgentStdin(clientStdin, (message) => {
      if (message.method === 'initialize') agentRespond(agentStdout, message.id, INIT_RESULT);
    });
    const client = new AcpClient({
      command: 'fake',
      args: [],
      cwd: '/tmp',
      spawnFn: spawnFnFor(child),
      defaultPermissionDecision: 'allow',
    });
    try {
      await client.initialize();
      agentStdout.write(
        permissionRequest({
          id: 'perm-allow',
          params: {
            sessionId: 'session-1',
            options: [
              { optionId: 'allow-once', kind: 'allow_once', name: 'Allow' },
              { optionId: 'allow-always', kind: 'allow_always', name: 'Always allow' },
            ],
          },
        }),
      );
      await delay(40);
      const response = responses.find((message) => message.id === 'perm-allow');
      assert.deepEqual(permissionOutcome(response), { outcome: 'selected', optionId: 'allow-always' });
    } finally {
      await client.close();
    }
  });

  it('no-id notification emits permission_pending but never grants allow', async () => {
    const { child, clientStdin, agentStdout } = createMockChild();
    const responses = collectAgentStdin(clientStdin, (message) => {
      if (message.method === 'initialize') agentRespond(agentStdout, message.id, INIT_RESULT);
      if (message.method === 'session/new') agentRespond(agentStdout, message.id, { sessionId: 'no-id-session' });
      if (message.method === 'session/prompt') {
        const promptId = message.id;
        setTimeout(() => {
          agentStdout.write(
            permissionRequest({
              params: {
                sessionId: 'no-id-session',
                options: [
                  { optionId: 'allow-always', kind: 'allow_always', name: 'Always allow' },
                  { optionId: 'allow-once', kind: 'allow_once', name: 'Allow' },
                ],
              },
            }),
          );
        }, 20);
        setTimeout(() => {
          agentNotify(agentStdout, 'session/update', {
            sessionId: 'no-id-session',
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done' } },
          });
          agentRespond(agentStdout, promptId, { stopReason: 'end_turn' });
        }, 120);
      }
    });
    const client = new AcpClient({ command: 'fake', args: [], cwd: '/tmp', spawnFn: spawnFnFor(child) });
    try {
      await client.initialize();
      await client.newSession();
      const events: AcpSessionUpdate[] = [];
      for await (const event of client.promptStream('no-id-session', 'hello', {
        idleWarningMs: 60,
        idleStallMs: 400,
        timeoutMs: 3000,
      })) {
        events.push(event);
      }
      const synthetic = responses.find((message) => String(message.id).startsWith('synth-perm-'));
      assert.ok(synthetic, 'the no-id notification must receive a fail-closed response');
      const outcome = permissionOutcome(synthetic);
      assert.notEqual(outcome?.outcome, 'selected');
      assert.deepEqual(outcome, { outcome: 'cancelled' });
      assert.ok(
        events.some((event) => (event as unknown as JsonRecord).sessionUpdate === 'permission_pending'),
        'permission_pending must be injected so the idle watchdog suppresses the wait',
      );
    } finally {
      await client.close();
    }
  });
});

// ─── HTTP streaming transport ─────────────────────────────────

function startJsonRpcServer(
  handler: (message: JsonRecord, res: ServerResponse) => unknown,
): Promise<Server> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonRecord;
    const response = await handler(message, res);
    if (response === undefined) return;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(`${JSON.stringify(response)}\n`);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function serverPort(server: Server): number {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

async function runHttpPrompt(input: {
  defaultPermissionDecision?: 'allow' | 'reject';
  options: JsonRecord[];
  onPermissionResponse: (message: JsonRecord) => void;
}): Promise<void> {
  let server: Server | null = null;
  let client: AcpHttpStreamClient | null = null;
  try {
    let finishPrompt: (() => void) | null = null;
    server = await startJsonRpcServer((message, res) => {
      if (message.method === 'initialize') return { jsonrpc: '2.0', id: message.id, result: INIT_RESULT };
      if (message.method === 'session/new') {
        return { jsonrpc: '2.0', id: message.id, result: { sessionId: 'http-session' } };
      }
      if (message.method === 'session/prompt') {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: 'perm-http',
            method: 'session/request_permission',
            params: { sessionId: 'http-session', options: input.options },
          })}\n`,
        );
        // Finish only after the client posts its permission response, so a
        // missing/incorrect response surfaces as a prompt timeout.
        finishPrompt = () => {
          res.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              method: 'session/update',
              params: {
                sessionId: 'http-session',
                update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'done' } },
              },
            })}\n`,
          );
          res.end(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } })}\n`);
        };
        return undefined;
      }
      if (message.id === 'perm-http' && message.method === undefined) {
        input.onPermissionResponse(message);
        finishPrompt?.();
        res.writeHead(204);
        res.end();
        return undefined;
      }
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'not found' } };
    });
    const { child, agentStdout } = createMockChild();
    const port = serverPort(server);
    client = new AcpHttpStreamClient({
      command: 'fake-http-acp',
      args: [],
      cwd: '/tmp',
      spawnFn: (() => {
        setImmediate(() => agentStdout.write(`Listening on port ${port}\n`));
        return child;
      }) as unknown as typeof nodeSpawn,
      portDiscoveryTimeoutMs: 500,
      ...(input.defaultPermissionDecision ? { defaultPermissionDecision: input.defaultPermissionDecision } : {}),
    });
    await client.initialize();
    const session = await client.newSession();
    for await (const _event of client.promptStream(session.sessionId, 'hello', { timeoutMs: 2000 })) {
      // drain
    }
  } finally {
    await client?.close();
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
}

describe('AcpHttpStreamClient permission default (C09)', () => {
  it('rejects instead of allowing when no handler and no explicit policy exist', async () => {
    let captured: JsonRecord | undefined;
    await runHttpPrompt({
      options: [
        { optionId: 'allow-once', kind: 'allow_once', name: 'Allow' },
        { optionId: 'reject-once', kind: 'reject_once', name: 'Reject' },
      ],
      onPermissionResponse: (message) => {
        captured = message;
      },
    });
    assert.ok(captured, 'client must post a permission response');
    assert.deepEqual(permissionOutcome(captured), { outcome: 'selected', optionId: 'reject-once' });
  });

  it('cancels instead of allowing when only allow options are offered', async () => {
    let captured: JsonRecord | undefined;
    await runHttpPrompt({
      options: [{ optionId: 'allow-once', kind: 'allow_once', name: 'Allow' }],
      onPermissionResponse: (message) => {
        captured = message;
      },
    });
    assert.ok(captured, 'client must post a permission response');
    assert.deepEqual(permissionOutcome(captured), { outcome: 'cancelled' });
  });

  it('keeps allow_always for an explicit auto-allow decision', async () => {
    let captured: JsonRecord | undefined;
    await runHttpPrompt({
      defaultPermissionDecision: 'allow',
      options: [
        { optionId: 'allow-once', kind: 'allow_once', name: 'Allow' },
        { optionId: 'allow-always', kind: 'allow_always', name: 'Always allow' },
      ],
      onPermissionResponse: (message) => {
        captured = message;
      },
    });
    assert.ok(captured, 'client must post a permission response');
    assert.deepEqual(permissionOutcome(captured), { outcome: 'selected', optionId: 'allow-always' });
  });
});
