const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const { homedir, tmpdir } = require('node:os');
const { join } = require('node:path');
const { fixture } = require('./browser-fixtures.cjs');
const { chromium } = require(
  process.env.REPO_SYNC_PLAYWRIGHT ||
    join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),
);
const evidence = process.env.REPO_SYNC_EVIDENCE || join(tmpdir(), 'repo-sync-workbench-evidence');
async function run() {
  await mkdir(evidence, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.REPO_SYNC_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto('http://127.0.0.1:5186');
    assert.match(await page.locator('#current-task h2').innerText(), /先连接/);
    assert.equal(await page.locator('#demo-controls').isVisible(), false);
    assert.equal(await page.locator('.nav-item').count(), 2);
    await page.screenshot({ path: join(evidence, '14-first-use.png'), fullPage: true });
    await page.locator('#current-task .primary').click();
    assert.match(await page.locator('#binding-form h2').innerText(), /连接仓库/);
    assert.equal(await page.locator('#config-baseline').count(), 0);
    await page.locator('#config-externalUrl').fill('https://github.com/journey-lab/core.git');
    await page.locator('#config-internalUrl').fill('git@codehub.example:journey/core.git');
    await page.locator('#next-binding').click();
    assert.match(await page.locator('#binding-form h2').innerText(), /起始版本/);
    await page.locator('#config-baseline').fill('9b582f70');
    await page.locator('#next-binding').click();
    await page.locator('#check-binding').click();
    await page.locator('#save-binding').click();
    await page.locator('#initialize-binding').click();
    assert.equal(await page.locator('#demo-controls').isVisible(), false);
    await page.locator('#current-task .primary').click();
    for (let i = 0; i < 5; i++) await page.locator('#current-task .primary').click();
    assert.match(await page.locator('#current-task h2').innerText(), /完成审核/);
    const [pr] = await Promise.all([page.waitForEvent('popup'), page.locator('#current-task .primary').click()]);
    await pr.locator('#platform-note').fill('sentinel-只沿主按钮完成操作');
    await pr.locator('#platform-merge button').click();
    await page.locator('#auto-step').waitFor();
    await pr.close();
    await page.locator('#current-task .primary').click();
    await page.locator('#current-task .primary').click();
    assert.match(await page.locator('#current-task h2').innerText(), /新的上游更新/);
    assert.equal(await page.locator('#technical-details').getAttribute('open'), null);
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 800 });
      for (const scene of [
        'unconfigured',
        'behind',
        'waiting',
        'verify',
        'reconcile',
        'timeout',
        'plugin',
        'drift',
        'metadata',
        'synced',
      ]) {
        await fixture(page, scene);
        await page.locator('#demo-toggle').click();
        await page.evaluate(() => window.scrollTo(0, 0));
        const main = page.locator('#current-task .primary');
        assert.equal(await main.count(), 1);
        assert.equal(await main.isVisible(), true);
        const bounds = await main.boundingBox();
        assert.ok(
          bounds.y >= 0 && bounds.y + bounds.height <= 800,
          `next action below first viewport: ${scene} at ${width}`,
        );
        const sizes = await page.evaluate(() => [
          document.documentElement.scrollWidth,
          document.documentElement.clientWidth,
        ]);
        assert.ok(sizes[0] <= sizes[1], `overflow ${scene} at ${width}`);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await fixture(page, 'waiting');
    await page.locator('#demo-toggle').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => getComputedStyle(document.getElementById('toast')).opacity === '0');
    await page.screenshot({ path: join(evidence, '15-one-next-action-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({ path: join(evidence, '16-one-next-action-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(
      'PASS：首次使用与三步配置、仅沿主按钮完成同步和 PR 审批、十种状态唯一主入口、四种屏宽首屏可见、默认收起技术流程 / 演示控制、无页面或 HTTP 错误。',
    );
    console.log(`证据：${evidence}`);
  } finally {
    await browser.close();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
