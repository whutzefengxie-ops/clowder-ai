import assert from 'node:assert/strict';
export async function completeFirstRun(journey) {
  const { page, request, web, log } = journey;
  assert.equal((await request('/api/cats')).cats.length, 0);
  assert.equal((await request('/api/messages?threadId=default&limit=50')).messages.length, 0);
  const creates = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/cats') creates.push(req.postDataJSON());
  });
  await log('zero-roles-and-messages-confirmed');
  await page.goto(new URL('/?lang=zh', web).href);
  const demo = page.getByRole('dialog').filter({ has: page.getByTestId('demo-transcript') });
  await demo.waitFor();
  await demo.getByRole('button', { name: '暂停', exact: true }).waitFor();
  const stages = new Set();
  const deadline = Date.now() + 70000;
  while (Date.now() < deadline) {
    const text = await demo.locator('aside').innerText();
    for (const stage of ['等待设计', '设计草图', '方案整合', '初版实现', '审查与修正', '已完善'])
      if (text.includes(stage)) stages.add(stage);
    if (await demo.getByRole('link', { name: '创建我的猫猫 →', exact: true }).count()) break;
    await page.waitForTimeout(400);
  }
  assert.equal(stages.size, 6);
  assert.equal(creates.length, 0, 'Mock collaboration must never create real roles');
  const preview = page.frameLocator('iframe[title="今天待办 · 演示成果"]');
  await preview.getByRole('textbox', { name: '新任务', exact: true }).fill('端到端验收任务');
  await preview.getByRole('button', { name: '添加', exact: true }).click();
  await preview.getByText('端到端验收任务', { exact: true }).waitFor();
  await journey.screenshot('progressive-demo-completed');
  await log('automatic-mock-a2a-and-interactive-preview', { stages: [...stages] });
  await demo.getByRole('link', { name: '创建我的猫猫 →', exact: true }).click();
  const setup = page.getByTestId('recommended-team-setup');
  await setup.waitFor();
  for (const label of ['Codex', 'Claude Code', 'DSH', 'Kimi', 'Pi']) {
    const checkbox = page.getByRole('checkbox', { name: `加入 ${label} 伙伴`, exact: true });
    assert.ok(await checkbox.isEnabled());
    assert.ok(await checkbox.isChecked());
  }
  assert.equal(await setup.getByText('Claude Code 尚未登录', { exact: true }).count(), 0);
  await journey.screenshot('five-detected-clients');
  await page.getByRole('button', { name: '一键创建 5 位伙伴', exact: true }).click();
  await setup.waitFor({ state: 'hidden', timeout: 60000 });
  const cats = (await request('/api/cats')).cats;
  assert.equal(cats.length, 5);
  assert.equal(creates.length, 5);
  for (const cat of cats) assert.ok(cat.avatar && cat.avatar !== '/avatars/default.png');
  await log('one-click-created-five-real-roles');
  return cats;
}
