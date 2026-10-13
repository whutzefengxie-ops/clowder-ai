import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const tools = [
  {
    name: 'read_fixture',
    description: 'Read a synthetic sentinel after a bounded delay. Does not access any other files.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        scenario: { type: 'string', enum: ['A', 'B', 'cancel', 'notice', 'human'] },
        delayMs: { type: 'integer', minimum: 0, maximum: 8000 },
      },
      required: ['scenario', 'delayMs'],
      additionalProperties: false,
    },
  },
];
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const trace = async (phase, fields) => {
  if (process.env.FIXTURE_TRACE)
    await appendFile(process.env.FIXTURE_TRACE, JSON.stringify({ t: Date.now(), phase, ...fields }) + '\n');
};
let count = 0;
async function handle(message) {
  if (message.id === undefined) return;
  if (message.method === 'initialize')
    return send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'authorized-readonly-fixture', version: '1' },
      },
    });
  if (message.method === 'tools/list') return send({ jsonrpc: '2.0', id: message.id, result: { tools } });
  if (message.method === 'ping') return send({ jsonrpc: '2.0', id: message.id, result: {} });
  if (message.method !== 'tools/call')
    return send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: 'Only the authorized fixture tool is supported' },
    });
  const args = message.params?.arguments;
  if (
    message.params?.name !== 'read_fixture' ||
    !args ||
    !['A', 'B', 'cancel', 'notice', 'human'].includes(args.scenario) ||
    !Number.isInteger(args.delayMs) ||
    args.delayMs < 0 ||
    args.delayMs > 8000 ||
    Object.keys(args).some((key) => !['scenario', 'delayMs'].includes(key)) ||
    ++count > 12
  )
    return send({
      jsonrpc: '2.0',
      id: message.id,
      result: { isError: true, content: [{ type: 'text', text: 'Outside the bounded synthetic fixture policy' }] },
    });
  await trace('started', { id: message.id, scenario: args.scenario, delayMs: args.delayMs });
  await new Promise((resolve) => setTimeout(resolve, args.delayMs));
  const sentinel = await readFile(join(process.env.FIXTURE_DIR, 'sentinel.txt'), 'utf8');
  await trace('completed', { id: message.id, scenario: args.scenario });
  send({
    jsonrpc: '2.0',
    id: message.id,
    result: { content: [{ type: 'text', text: `${args.scenario}: ${sentinel.trim()}` }] },
  });
}
createInterface({ input: process.stdin }).on('line', (line) => {
  try {
    void handle(JSON.parse(line)).catch(() =>
      send({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Synthetic fixture failed' } }),
    );
  } catch {
    /* Ignore non-JSON transport noise. */
  }
});
