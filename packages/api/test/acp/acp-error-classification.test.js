// @ts-check
/**
 * Tests for ACP error classification, including credential error detection.
 * Issue #1668: Ensure credential-related errors are properly identified.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// We'll test through the service's error handling, using synthetic errors
// that match the patterns observed in real DSH/Pi credential failures.

describe('ACP credential error classification', () => {
  it('identifies missing API key errors', async () => {
    // RED test: Will fail until error classification is implemented
    const { AcpAgentService } = await import(
      '../../dist/domains/cats/services/agents/providers/acp/AcpAgentService.js'
    );
    const { AcpProtocolError } = await import('../../dist/domains/cats/services/agents/providers/acp/AcpClient.js');

    const service = new AcpAgentService({
      catId: 'test-cat',
      pool: {
        async acquire() {
          return {
            client: {
              promptCapabilities: {},
              onCapacity() {},
              offCapacity() {},
              clearRecentCapacitySignal() {},
              async newSession() {
                throw new AcpProtocolError(-32603, 'Internal error', {
                  error: 'Credential required: API key missing',
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

    const error = messages.find((m) => m.type === 'error');
    assert.ok(error, 'Should emit an error message');
    assert.equal(error.errorCode, 'credential_required', 'Should classify as credential_required');
    assert.match(error.error, /credential/i, 'Error message should mention credentials');
  });

  it('identifies authentication failures', async () => {
    const { AcpAgentService } = await import(
      '../../dist/domains/cats/services/agents/providers/acp/AcpAgentService.js'
    );
    const { AcpProtocolError } = await import('../../dist/domains/cats/services/agents/providers/acp/AcpClient.js');

    const service = new AcpAgentService({
      catId: 'test-cat',
      pool: {
        async acquire() {
          return {
            client: {
              promptCapabilities: {},
              onCapacity() {},
              offCapacity() {},
              clearRecentCapacitySignal() {},
              async newSession() {
                throw new AcpProtocolError(-32603, 'Unauthorized', { error: 'Authentication failed' });
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
      providerName: 'Pi',
    });

    const messages = [];
    for await (const message of service.invoke('test task', { workingDirectory: '.' })) {
      messages.push(message);
    }

    const error = messages.find((m) => m.type === 'error');
    assert.ok(error);
    assert.equal(error.errorCode, 'credential_required');
  });

  it('does not misclassify capacity errors as credential errors', async () => {
    const { AcpAgentService } = await import(
      '../../dist/domains/cats/services/agents/providers/acp/AcpAgentService.js'
    );
    const { AcpProtocolError } = await import('../../dist/domains/cats/services/agents/providers/acp/AcpClient.js');

    const service = new AcpAgentService({
      catId: 'test-cat',
      pool: {
        async acquire() {
          return {
            client: {
              promptCapabilities: {},
              onCapacity() {},
              offCapacity() {},
              clearRecentCapacitySignal() {},
              async newSession() {
                throw new AcpProtocolError(-32000, 'Resource exhausted');
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
      providerName: 'Test',
    });

    const messages = [];
    for await (const message of service.invoke('test task', { workingDirectory: '.' })) {
      messages.push(message);
    }

    const error = messages.find((m) => m.type === 'error');
    assert.ok(error);
    assert.equal(error.errorCode, 'model_capacity', 'Should classify as model_capacity, not credential_required');
  });
});
