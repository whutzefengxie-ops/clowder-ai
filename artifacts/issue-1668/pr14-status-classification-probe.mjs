import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

assert.equal(process.env.CAT_CAFE_TEST_SANDBOX, '1', 'Run through the repository test HOME wrapper');
const root = resolve(import.meta.dirname, '../..');
const author = resolve(root, '../feat-issue-1668-acp-credentials');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: author, encoding: 'utf8' }).trim();
const expectedHead = process.argv[2] ?? '7895abfad12c2a9e8ad334b7bf6ad703895e78ec';
const expectFixed = process.argv[3] === 'fixed';
assert.equal(head, expectedHead);
const acp = resolve(author, 'packages/api/dist/domains/cats/services/agents/providers/acp');
const { AcpAgentService } = await import(pathToFileURL(resolve(acp, 'AcpAgentService.js')).href);
const { AcpProtocolError } = await import(pathToFileURL(resolve(acp, 'AcpClient.js')).href);
const cases = [
  ['reported-dsh-missing-key', 'Internal error: turn failed: llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY in the launching environment'],
  ['mcp-auth-is-not-model-auth', 'MCP server fixture returned Unauthorized'],
];
if (process.argv[5] === 'extended') cases.push(
  ['pagination-token-is-not-model-auth', 'Pagination token invalid; request a new page cursor'],
  ['capacity-with-token-detail', 'Resource exhausted: capacity exceeded; retry token invalid', -32000],
  ['synthetic-secret-redaction', 'llm-deepseek: no API key for provider route "deepseek-official"; api_key=synthetic_review_secret_sentinel'],
);
const observations = [];
for (const [name, detail, code = -32603] of cases) {
  const client = {
    promptCapabilities: {},
    onCapacity() {}, offCapacity() {}, clearRecentCapacitySignal() {},
    async newSession() { throw new AcpProtocolError(code, detail); },
    async *promptStream() {},
  };
  const service = new AcpAgentService({
    catId: 'review-fixture',
    pool: { async acquire() { return { client, release() {} }; } },
    poolKey: {}, projectRoot: process.cwd(), mcpSupport: false, providerName: 'acp',
  });
  const messages = [];
  for await (const message of service.invoke('synthetic classification check', { workingDirectory: process.cwd() })) messages.push(message);
  const error = messages.find((message) => message.type === 'error');
  observations.push(name === 'synthetic-secret-redaction'
    ? { name, errorCode: error?.errorCode, syntheticSecretPresent: error?.error?.includes('synthetic_review_secret_sentinel') }
    : { name, errorCode: error?.errorCode, message: error?.error });
}
assert.equal(observations[0].errorCode, expectFixed ? 'credential_required' : 'prompt_failure');
assert.equal(observations[1].errorCode, expectFixed ? 'mcp_pollution' : 'credential_required');
const result = { head, scope: 'Synthetic errors through the built ACP service, under isolated test HOME; no native process, provider request or production state', observations };
writeFileSync(resolve(import.meta.dirname, process.argv[4] ?? 'pr14-status-classification-probe.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
