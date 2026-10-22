// @ts-check
/**
 * Integration test for credential error flow: detection → classification → user-visible error.
 * Issue #1668: Verify complete credential diagnostic path.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('ACP credential error flow', () => {
  it('full flow: DSH missing key → credential_required → user guidance', async () => {
    // This integration test verifies the complete path from a real DSH-style
    // credential error through classification to user-facing error message.
    const { AcpAgentService } = await import(
      '../../dist/domains/cats/services/agents/providers/acp/AcpAgentService.js'
    );
    const { AcpProtocolError } = await import('../../dist/domains/cats/services/agents/providers/acp/AcpClient.js');

    const service = new AcpAgentService({
      catId: 'test-dsh',
      pool: {
        async acquire() {
          return {
            client: {
              promptCapabilities: {},
              onCapacity() {},
              offCapacity() {},
              clearRecentCapacitySignal() {},
              async newSession() {
                // Simulate real DSH error from Issue #1668
                throw new AcpProtocolError(-32603, 'Internal error: turn failed', {
                  error:
                    'llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service',
                });
              },
              async *promptStream() {},
            },
            release() {},
          };
        },
      },
      poolKey: {},
      projectRoot: '.',
      mcpSupport: false,
      providerName: 'DSH',
    });

    const messages = [];
    for await (const message of service.invoke('test task', { workingDirectory: '.' })) {
      messages.push(message);
    }

    // Verify error was detected and classified
    const error = messages.find((m) => m.type === 'error');
    assert.ok(error, 'Should emit error message');
    assert.equal(error.errorCode, 'credential_required', 'Should classify as credential_required');

    // Verify user-facing guidance is present
    assert.match(error.error, /凭据缺失或无效/, 'Should contain user-facing guidance in Chinese');
    assert.match(error.error, /Hub.*账号设置.*API key/i, 'Should mention Hub account settings');

    // Verify original error details are preserved
    assert.match(error.error, /no API key for provider route/i, 'Should preserve original error pattern');
  });

  it('spawn-env credential error produces correct errorCode for registry', async () => {
    // Verify that spawn-env credential errors are correctly typed for AcpServiceFactory
    const { tryPrepareAcpProcessEnv } = await import(
      '../../dist/domains/cats/services/agents/providers/acp/acp-spawn-env.js'
    );

    const result = tryPrepareAcpProcessEnv({
      clientId: 'acp',
      provider: 'deepseek-official',
      baseModel: 'deepseek-chat',
      account: {
        id: 'test-account',
        authType: 'api_key',
        // Missing apiKey will trigger credential error
        envVars: { DEEPSEEK_API_KEY: '${api_key}' },
      },
    });

    assert.equal(result.ok, false, 'Should fail validation');
    assert.equal(result.errorCode, 'credential_required', 'Should return credential_required errorCode');
    assert.match(result.error.message, /Credential required/i, 'Error message should indicate credential issue');
  });
});
