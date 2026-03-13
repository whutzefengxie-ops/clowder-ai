import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, mock, test } from 'node:test';

import { FeishuAdapter } from '../dist/infrastructure/connectors/adapters/FeishuAdapter.js';
import { FeishuTokenManager } from '../dist/infrastructure/connectors/adapters/FeishuTokenManager.js';

const TMP = join(tmpdir(), 'feishu-upload-test');

describe('FeishuAdapter sendMedia with upload', () => {
  /** @type {ReturnType<typeof mock.fn>} */
  let sendMessageCalls;
  /** @type {FeishuAdapter} */
  let adapter;
  /** @type {ReturnType<typeof mock.fn>} */
  let mockUploadFetch;

  beforeEach(async () => {
    await mkdir(TMP, { recursive: true });

    sendMessageCalls = mock.fn(() => Promise.resolve({}));

    // Mock fetch for both token + upload
    mockUploadFetch = mock.fn((/** @type {string} */ url) => {
      if (url.includes('/auth/v3/tenant_access_token')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ tenant_access_token: 'tok-test', expire: 7200 }),
        });
      }
      if (url.includes('/im/v1/images')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { image_key: 'img_uploaded_123' } }),
        });
      }
      if (url.includes('/im/v1/files')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { file_key: 'file_uploaded_456' } }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    const tokenManager = new FeishuTokenManager({
      appId: 'app1',
      appSecret: 'sec1',
      fetchFn: /** @type {any} */ (mockUploadFetch),
    });

    adapter = new FeishuAdapter(
      'app1',
      'sec1',
      /** @type {any} */ ({
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
        child: () => /** @type {any} */ ({}),
      }),
    );
    adapter._injectSendMessage(sendMessageCalls);
    adapter._injectTokenManager(tokenManager);
    adapter._injectUploadFetch(/** @type {any} */ (mockUploadFetch));
  });

  test('uploads image via /im/v1/images when absPath provided', async () => {
    const imgPath = join(TMP, 'test-img.jpg');
    await writeFile(imgPath, Buffer.from('fake-jpg-data'));

    await adapter.sendMedia('chat_123', {
      type: 'image',
      url: '/api/connector-media/test-img.jpg',
      absPath: imgPath,
    });

    // Should have called upload API
    const uploadCalls = mockUploadFetch.mock.calls.filter(
      (c) => typeof c.arguments[0] === 'string' && c.arguments[0].includes('/im/v1/images'),
    );
    assert.equal(uploadCalls.length, 1);

    // Should send native image message with uploaded key
    assert.equal(sendMessageCalls.mock.calls.length, 1);
    const sentParams = sendMessageCalls.mock.calls[0].arguments[0];
    assert.equal(sentParams.msgType, 'image');
    const content = JSON.parse(sentParams.content);
    assert.equal(content.image_key, 'img_uploaded_123');
  });

  test('uploads audio via /im/v1/files when absPath provided', async () => {
    const audioPath = join(TMP, 'test-audio.opus');
    await writeFile(audioPath, Buffer.from('fake-audio-data'));

    await adapter.sendMedia('chat_123', {
      type: 'audio',
      url: '/api/tts/audio/test-audio.opus',
      absPath: audioPath,
    });

    const uploadCalls = mockUploadFetch.mock.calls.filter(
      (c) => typeof c.arguments[0] === 'string' && c.arguments[0].includes('/im/v1/files'),
    );
    assert.equal(uploadCalls.length, 1);

    assert.equal(sendMessageCalls.mock.calls.length, 1);
    const sentParams = sendMessageCalls.mock.calls[0].arguments[0];
    assert.equal(sentParams.msgType, 'audio');
    const content = JSON.parse(sentParams.content);
    assert.equal(content.file_key, 'file_uploaded_456');
  });

  test('falls back to text link when no tokenManager', async () => {
    // Create adapter WITHOUT tokenManager
    const plainAdapter = new FeishuAdapter(
      'app1',
      'sec1',
      /** @type {any} */ ({
        info: () => {},
        error: () => {},
        warn: () => {},
        debug: () => {},
        child: () => /** @type {any} */ ({}),
      }),
    );
    const plainSend = mock.fn(() => Promise.resolve({}));
    plainAdapter._injectSendMessage(plainSend);

    await plainAdapter.sendMedia('chat_123', {
      type: 'image',
      url: '/api/connector-media/test-img.jpg',
      absPath: '/tmp/test-img.jpg',
    });

    // Should fall back to text link
    assert.equal(plainSend.mock.calls.length, 1);
    const sentParams = plainSend.mock.calls[0].arguments[0];
    assert.equal(sentParams.msgType, 'text');
    assert.ok(JSON.parse(sentParams.content).text.includes('🖼️'));
  });

  test('still uses platform keys when available (no upload needed)', async () => {
    await adapter.sendMedia('chat_123', {
      type: 'image',
      imageKey: 'img_existing_key',
    });

    // Should NOT call upload API
    const uploadCalls = mockUploadFetch.mock.calls.filter(
      (c) => typeof c.arguments[0] === 'string' && c.arguments[0].includes('/im/v1/images'),
    );
    assert.equal(uploadCalls.length, 0);

    // Should send with existing key
    assert.equal(sendMessageCalls.mock.calls.length, 1);
    const content = JSON.parse(sendMessageCalls.mock.calls[0].arguments[0].content);
    assert.equal(content.image_key, 'img_existing_key');
  });
});
