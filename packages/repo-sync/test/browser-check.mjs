import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Receiver } from '../src/engine.mjs';
import { createReceiverServer } from '../src/server.mjs';
import { repositories } from './fixtures.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.REPO_SYNC_PLAYWRIGHT ||
    join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),
);
const evidence = process.env.REPO_SYNC_EVIDENCE || join(tmpdir(), 'repo-sync-git-evidence');
await mkdir(evidence, { recursive: true });
const fixture = await repositories();
const receiver = new Receiver(fixture.config);
await receiver.adopt(fixture.u0, fixture.i0);
await receiver.setQueue(fixture.plans);
const server = createReceiverServer(receiver, { demoMerge: fixture.merge });
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.REPO_SYNC_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  for (let index = 0; index < 2; index++) {
    await page.locator('[data-action="start"]').click();
    await page.locator('[data-step-state="current"]').waitFor();
    if (!index) {
      await page.getByLabel('内部 Issue 编号').fill('318');
      await page.getByLabel('内部 Issue 具体链接').fill('https://codehub.example/core/issues/318');
      await page.getByRole('button', { name: '保存此 Issue 映射' }).click();
    } else assert.equal(await page.locator('[data-form="issue"]').count(), 0);
    await page.locator('[data-action="prepare"]').click();
    await page.locator('[data-form="pr"]').waitFor({ timeout: 20000 });
    const before = await receiver.status();
    assert.equal((await receiver.git.fetch()).internal, before.accepted.internal);
    assert.match(before.templates.body, /内部 #318/);
    assert.equal(await page.locator('[data-step-state="done"]').count(), 5);
    await page.getByLabel('内部 PR 具体链接').fill(`https://codehub.example/core/pull/${index + 1}`);
    await page.getByRole('button', { name: '登记 PR，进入审核' }).click();
    const [pr] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('link', { name: '打开内部 PR ↗' }).click(),
    ]);
    await pr.waitForLoadState();
    assert.equal(new URL(pr.url()).pathname, `/demo/pr/${before.active.id}`);
    await pr.getByRole('button', { name: '模拟平台审核通过并合入' }).click();
    await pr.getByRole('heading', { name: '模拟平台已执行 Git 合入' }).waitFor({ timeout: 20000 });
    await pr.close();
    await page.reload();
    assert.equal((await receiver.status()).accepted.internal, before.accepted.internal);
    await page.getByRole('button', { name: '已在平台合入，核验 Git 结果' }).click();
    await page.locator('[data-form="receipts"]').waitFor({ timeout: 20000 });
    if (index) {
      await page.getByRole('button', { name: '保存本笔接收记录，完成同步' }).click();
      await page.locator('#error').waitFor({ state: 'visible' });
      assert.match(await page.locator('#error').innerText(), /ISSUE_UPDATE_PENDING/);
      assert.equal(await page.locator('[data-step-state="failed"]').count(), 1);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: join(evidence, '27-git-metadata-error-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.locator('[data-form="receipts"] select').selectOption('closed');
    }
    await page.getByRole('button', { name: '保存本笔接收记录，完成同步' }).click();
    if (index) await page.getByRole('heading', { name: '本轮交付已完成' }).waitFor();
    else await page.locator('[data-action="start"]').waitFor();
    const after = await receiver.status();
    assert.equal(after.deliveries[index].status, 'COMPLETE');
    assert.equal(after.issues['issue-71'].state, index ? 'closed' : 'open');
    assert.equal(after.issues['issue-71'].receipts.length, index + 1);
    if (!index) {
      await page.locator('details').first().locator(':scope > summary').click();
      await page.screenshot({ path: join(evidence, '26-git-shared-issue-u1.png'), fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS：真实 Git 两笔接收、Issue 映射复用、具体 PR 页面、合入后游标恢复、元数据失败 ×、U1 open / U2 closed 与移动端。',
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
