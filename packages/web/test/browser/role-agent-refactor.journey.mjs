import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { test } from 'node:test';
import { scene } from './f322-members-fixture.mjs';
import { nativeMemberProducer } from './f322-members-native-producer.fixture.mjs';
import { configRoutes } from '../../../api/dist/routes/config.js';
import { sessionStrategyConfigRoutes } from '../../../api/dist/routes/session-strategy-config.js';
import { configStore } from '../../../api/dist/config/ConfigStore.js';

const evidence = resolve('../../artifacts/role-agent-refactor-20261029-gpt-sol/browser');
mkdirSync(evidence, { recursive: true });

test(
  'official member settings persist role and CAS global settings through the real API routes',
  { timeout: 60000 },
  async () => {
    const producer = await nativeMemberProducer(undefined, {
      clientId: 'openai',
      cliCommand: 'codex',
      accountRef: 'codex',
      initialModel: 'fixture-model',
      retainRoot: true,
    });
    await producer.app.register(configRoutes, { projectRoot: producer.root, auditLog: { append: async () => {} } });
    await producer.app.register(sessionStrategyConfigRoutes);
    const { context, page, state } = await scene(1280, false, false, false, {
      catsProducer: producer,
      settingsProducer: producer,
      accounts: [{ id: 'codex', clientId: 'openai', authType: 'oauth', displayName: '隔离测试账号', builtin: true }],
    });
    try {
      await page.goto('https://f322-members.test/settings?s=members&cat=gemini38');
      await page.getByTestId('member-settings-page').waitFor();
      await page.getByRole('button', { name: '身份与职责', exact: true }).click();
      await page.getByLabel('职责', { exact: true }).fill('浏览器验收：代码审查伙伴');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.getByText('已保存。正在运行的回合不变，后续调用使用新设置。', { exact: true }).waitFor();
      const read = await producer.app.inject({ method: 'GET', url: '/api/cats' });
      assert.equal(read.json().cats[0].roleDescription, '浏览器验收：代码审查伙伴');
      await page.screenshot({ path: join(evidence, 'member-role-saved.png'), fullPage: true });
      await page.reload();
      await page.getByRole('button', { name: '身份与职责', exact: true }).click();
      assert.equal(await page.getByLabel('职责', { exact: true }).inputValue(), '浏览器验收：代码审查伙伴');
      await page.getByRole('button', { name: '高级接入', exact: true }).click();
      await page.getByText('Codex 全局运行参数', { exact: true }).click();
      const before = await producer.app.inject({ method: 'GET', url: '/api/config' });
      const previous = before.json().config.cli.codexSandboxMode;
      const target = previous === 'read-only' ? 'workspace-write' : 'read-only';
      await page.getByLabel('Codex Sandbox', { exact: true }).selectOption(target);
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.getByText('已保存。正在运行的回合不变，后续调用使用新设置。', { exact: true }).waitFor();
      const write = state.writes.find(
        (entry) => entry.path === '/api/config' && entry.body.key === 'cli.codexSandboxMode',
      );
      assert.equal(write.body.expectedRevision, before.json().revisions['cli.codexSandboxMode']);
      assert.equal(configStore.get('cli.codexSandboxMode'), target);
      await page.screenshot({ path: join(evidence, 'member-global-cas-saved.png'), fullPage: true });
      writeFileSync(
        join(evidence, 'result.json'),
        JSON.stringify(
          {
            passed: true,
            fixture: 'SettingsShell + official MemberSettingsPage + actual Fastify routes',
            platform: process.platform,
            nativeClientCalled: false,
            finalPackage: false,
            catalogRoot: producer.root,
            role: read.json().cats[0].roleDescription,
            globalKey: write.body.key,
            expectedRevision: write.body.expectedRevision,
            retained: true,
          },
          null,
          2,
        ),
      );
    } finally {
      await context.close();
      await producer.close();
      configStore.reset();
    }
  },
);
