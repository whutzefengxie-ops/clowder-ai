import { progressSteps } from './progress.mjs';
import { receiptFields } from './receipts.mjs';

const content = document.getElementById('content');
const errorPanel = document.getElementById('error');
let snapshot;
let view = 'workbench';
let busy = false;
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const sha = (value) => `<code title="${esc(value)}">${esc(value)}</code>`;
const button = (action, label) => `<button type="button" class="primary" data-action="${action}">${label}</button>`;
async function refresh() {
  const response = await fetch('/api/status');
  if (!response.ok) throw new Error('无法读取工作台');
  snapshot = await response.json();
  render();
}
async function action(input) {
  if (busy) return;
  busy = true;
  errorPanel.hidden = true;
  for (const element of document.querySelectorAll('button')) element.disabled = true;
  try {
    const response = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Repo-Sync-Token': snapshot.token },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`${result.code}：${result.message ?? '请求失败'}`);
    await refresh();
    return result;
  } catch (error) {
    await refresh();
    errorPanel.textContent = error.message;
    errorPanel.hidden = false;
  } finally {
    busy = false;
    for (const element of document.querySelectorAll('button')) element.disabled = false;
  }
}
function configuration() {
  const { config, state } = snapshot;
  return `<section class="card"><h2>仓库连接与基线</h2><div class="split"><div><small>外部来源</small>${esc(config.sourceUrl)}<p>交付分支：${esc(config.sourceBranch)}</p></div><div><small>内部接收</small>${esc(config.internalUrl)}<p>合入分支：${esc(config.targetBranch)}</p></div></div><p>地址与检查命令来自本地私有配置。凭据由 Git / gh 的现有认证管理。</p>${state ? `<h3>初始对应</h3>${sha(state.initial.upstream)} → ${sha(state.initial.internal)}<h3>当前已接受对应</h3>${sha(state.accepted.upstream)} → ${sha(state.accepted.internal)}` : `${button('heads', '读取两侧当前版本')}<form data-form="adopt"><label for="upstream">外部已同步版本 U0（完整 SHA）</label><input id="upstream" name="upstream" required><label for="internal">内部当前版本 I0（完整 SHA）</label><input id="internal" name="internal" required><p>已有仓落后时，U0 填上次已同步版本；不能直接填外部最新版本。程序核验两侧 tree、内部 HEAD 和来源历史后登记。</p><button class="primary" type="submit">核验并登记已有基线</button></form>`}</section>`;
}
const states = {
  ISSUES_REQUIRED: [
    '在内部平台创建或复用 Issue',
    '登记来源与内部对象的对应。已有映射可直接复用；候选分支推送前先完成映射。',
  ],
  PUSH_RESULT_UNKNOWN: ['候选分支推送结果待确认', '先核对同名 ref 的实际 SHA。复用相同候选，冲突时暂停。'],
  PR_REQUIRED: [
    '候选已推送，在内部平台创建 PR',
    '使用下方标题和正文，选择展示的候选分支与目标分支。创建后登记具体 PR 链接。',
  ],
  WAITING_APPROVAL: [
    '在内部 PR 完成审核与合入',
    '打开具体 PR，在平台正常审核合入；回来核验。程序只读取 Git 结果，不替代平台审批。',
  ],
  CODE_ACCEPTED_PENDING_METADATA: [
    '代码已接受，更新 Issue 接收状态',
    '按平台实际状态保存本笔记录。有后续交付时保持打开，本笔仍可完成；接收条件满足后在平台关闭并确认。',
  ],
};
function primary(active, state) {
  if (!active)
    return state.queue.length
      ? button('start', `同步上游 PR #${state.queue[0].source.number} →`)
      : snapshot.synthetic
        ? '<small>本轮两笔演示已完成，可回看下方记录。</small>'
        : button('discover', '检查上游更新');
  if (active.error || active.status === 'PUSH_RESULT_UNKNOWN') return button('recover', '核对原交付并恢复');
  if (active.status === 'ISSUES_REQUIRED' && active.issues.every((issue) => state.issues[issue.sourceId]))
    return button('prepare', '检查并推送候选分支 →');
  if (active.status === 'WAITING_APPROVAL')
    return `<a class="button primary" href="${snapshot.synthetic ? `/demo/pr/${active.id}` : esc(active.prUrl)}" target="_blank" rel="noopener">打开内部 PR ↗</a>${button('recover', '已在平台合入，核验 Git 结果')}`;
  const destinations = {
    ISSUES_REQUIRED: ['issue-mappings', '登记内部 Issue 对应 →'],
    PR_REQUIRED: ['pr-form', '登记内部 PR 链接 →'],
    CODE_ACCEPTED_PENDING_METADATA: ['receipt-form', '确认 Issue 接收记录 →'],
  };
  const [id, label] = destinations[active.status];
  return `<a class="button primary" href="#${id}">${label}</a>`;
}
function workflow(active, state = snapshot.state) {
  const marks = { done: '✓', current: '●', pending: '○', failed: '×' };
  return `<p>最近读取的内部 HEAD：${sha(state.observedInternal ?? state.accepted.internal)}${state.observedInternal && state.observedInternal !== state.accepted.internal ? ' · 尚未登记为接受版本' : ''}</p><ol class="flow">${progressSteps(
    active,
    state,
  )
    .map(
      (group) =>
        `<li><b>${group.label}</b>${group.children.map((step) => `<small data-step-state="${step.status}" class="${step.status === 'failed' ? 'bad' : step.status === 'done' ? 'good' : ''}">${marks[step.status]} ${step.name}</small>`).join('')}</li>`,
    )
    .join('')}</ol>`;
}
function issueForms(active, state) {
  return active.issues
    .map((issue) => {
      const mapping = state.issues[issue.sourceId];
      return `<div class="card"><h3><a href="${esc(issue.url)}" target="_blank" rel="noopener">来源 Issue #${issue.number} ↗</a> · ${esc(issue.title)}</h3>${mapping ? `<p>内部 #${esc(mapping.internalId)} · <a href="${esc(mapping.url)}" target="_blank" rel="noopener">打开内部 Issue ↗</a></p>` : `<details><summary>复制 Issue 来源正文</summary><pre>${esc(`来源：${issue.url}\n\n${issue.body ?? ''}`)}</pre></details><form data-form="issue" data-source="${esc(issue.sourceId)}"><label>内部 Issue 编号<input name="internalId" required></label><label>内部 Issue 具体链接<input name="url" type="url" required></label><button type="submit">保存此 Issue 映射</button></form>`}</div>`;
    })
    .join('');
}
function currentForm(active, state) {
  const anchors = {
    ISSUES_REQUIRED: 'issue-mappings',
    PR_REQUIRED: 'pr-form',
    CODE_ACCEPTED_PENDING_METADATA: 'receipt-form',
  };
  return `<div id="${anchors[active.status] ?? 'step-content'}">${currentFormContent(active, state)}</div>`;
}
function currentFormContent(active, state) {
  if (active.status === 'ISSUES_REQUIRED') return issueForms(active, state);
  if (active.status === 'PR_REQUIRED')
    return `<section class="card"><h3>内部 PR 模板</h3><pre>${esc(snapshot.state.templates.title)}\n\n${esc(snapshot.state.templates.body)}</pre><form data-form="pr"><label>内部 PR 具体链接<input name="url" type="url" required></label><button type="submit" class="primary">登记 PR，进入审核</button></form></section>`;
  if (active.status === 'CODE_ACCEPTED_PENDING_METADATA')
    return `<section class="card"><form data-form="receipts"><h3>确认平台实际状态并保存接收记录</h3>${receiptFields(active, state, esc, sha)}<button type="submit" class="primary">保存本笔接收记录，完成同步</button><p>此操作记录人工核对结果，不向内部平台发送关单请求。</p></form></section>`;
  return '';
}
function workbench() {
  const state = snapshot.state;
  if (!state)
    return `<section class="card task"><h2>先确认两侧已有基线</h2><p>连接已从私有配置载入，登记外部已同步版本与内部当前版本即可开始。</p><button type="button" data-view="configuration" class="primary">配置同步基线 →</button></section>`;
  const active = state.active;
  const [title, description] = active
    ? taskPresentation(active, state)
    : [
        state.queue.length ? '有上游更新可以接收' : '本轮交付已完成',
        state.queue.length
          ? '按 main 实际接受顺序逐笔处理，内部 main 在平台合入前保持原版本。'
          : '可检查新更新，也可展开每笔记录回看过程。',
      ];
  if (!active && !state.queue.length && state.accepted.upstream !== state.latest)
    return `<section class="card task"><h2>读取上游交付清单</h2><p>Git 已读取到更新版本。先关联 PR、Issue 与实际提交并冻结范围，再发起同步。</p>${button('discover', '检查上游更新')}</section>`;
  return `<section class="card task"><div class="task-top"><div><span class="badge">${active ? esc(active.status) : '准备就绪'}</span><h2>${title}</h2><p>${description}</p></div><div>${primary(active, state)}</div></div>${active ? `<p>候选分支：${esc(active.branch)} → ${esc(snapshot.config.targetBranch)}</p>${workflow(active)}` : ''}</section><section class="card versions"><div><small>已接受上游</small>${sha(state.accepted.upstream)}</div><div><small>对应内部 commit</small>${sha(state.accepted.internal)}</div><div><small>冻结扫描目标</small>${sha(state.latest)}<small>${state.queue.length} 笔待完成交付</small></div></section>${active?.error ? `<div class="card bad">× ${esc(active.error.code)}<p>${esc(active.error.message)}</p></div>` : ''}${active ? currentForm(active, state) : ''}<section class="card"><h3>本轮同步与审计</h3>${
    state.deliveries
      .map(
        (delivery) =>
          `<details><summary>${esc(delivery.source.title)} · ${esc(delivery.status)}</summary><p>${esc(delivery.id)} · ${esc(delivery.branch)}</p>${delivery.prUrl ? `<p><a href="${snapshot.synthetic ? `/demo/pr/${delivery.id}` : esc(delivery.prUrl)}" target="_blank" rel="noopener">打开对应内部 PR ↗</a></p>` : ''}<p>目标 ${sha(delivery.target)} → 内部 ${sha(delivery.acceptedInternal ?? '待接受')}</p><details><summary>本笔原始 commit 对应</summary><pre>${esc(delivery.commits.map((commit) => `${commit} → ${commit}`).join('\n'))}</pre><small>原始对象 SHA 保留；内部接收节点单独记录。</small></details><pre>${esc(
            state.events
              .filter((event) => event.deliveryId === delivery.id)
              .map((event) => `${event.time} ${event.message}`)
              .join('\n'),
          )}</pre>${Object.values(delivery.issueResults)
            .map(
              (result) =>
                `<small>${result.state === 'open' ? 'Issue 保持打开' : 'Issue 已关闭'} · 接收记录已保存${result.pending.length ? '，等待后续交付' : ''}</small>`,
            )
            .join('')}</details>`,
      )
      .join('') || '<p>开始同步后，这里按每笔交付显示执行记录。</p>'
  }</section>`;
}
function taskPresentation(active, state) {
  if (active.error) return ['执行暂停，先核对原交付', active.error.message];
  if (active.status === 'ISSUES_REQUIRED' && active.issues.every((issue) => state.issues[issue.sourceId]))
    return ['内部 Issue 已就绪，准备同步代码', '点击检查并推送候选分支。原始提交保留，内部 main 仍等待平台审批。'];
  return states[active.status] ?? ['核对当前结果', '恢复原交付后继续。'];
}
function renderPlatform() {
  const delivery = snapshot.state?.active;
  if (!delivery || !location.pathname.endsWith(delivery.id))
    return '<section class="card"><h2>这笔模拟 PR 已结束或不属于当前交付</h2><a href="/">返回工作台</a></section>';
  return `<section class="card"><span class="badge">合成内部平台 · 真实 Git 合并</span><h2>${esc(delivery.source.title)}</h2><p>${esc(delivery.branch)} → ${esc(snapshot.config.targetBranch)}</p><p>候选 ${sha(delivery.candidate)}</p><p>此页模拟平台审批，将候选合并到独立虚构内仓；实际环境在真实 PR 页面审核。</p>${delivery.status === 'WAITING_APPROVAL' ? button('demo-merge', '模拟平台审核通过并合入') : '<p>Git 接收结果已核验。</p>'}<p><a href="/">返回同步工作台核验结果 →</a></p></section>`;
}
function render() {
  document.getElementById('mode').textContent = snapshot.synthetic
    ? '合成仓库演示 · 执行真实 Git'
    : '真实 Git · 平台对象人工登记';
  content.innerHTML =
    snapshot.synthetic && location.pathname.startsWith('/demo/pr/')
      ? renderPlatform()
      : view === 'configuration'
        ? configuration()
        : workbench();
  const badge = content.querySelector('.task .badge');
  if (badge && snapshot.state?.active)
    badge.textContent = snapshot.state.active.error
      ? '执行异常'
      : snapshot.state.active.status === 'WAITING_APPROVAL'
        ? '等待内部审核'
        : '完成当前步骤';
  renderFreshness();
}
function renderFreshness() {
  if (view === 'workbench' && snapshot.state && !location.pathname.startsWith('/demo/pr/')) {
    const freshness = document.createElement('p');
    freshness.className = 'badge';
    freshness.textContent =
      snapshot.state.accepted.upstream === snapshot.state.latest
        ? snapshot.state.active
          ? '代码已接收至本轮最新 · 本笔记录待完成'
          : '代码与本轮扫描目标一致'
        : '代码尚未接收至本轮扫描的最新版本';
    content.prepend(freshness);
  }
}
document.addEventListener('click', async (event) => {
  const element = event.target.closest('button');
  if (!element) return;
  if (element.dataset.view) {
    view = element.dataset.view;
    render();
  }
  if (element.dataset.action) {
    const result = await action({ action: element.dataset.action, deliveryId: snapshot.state?.active?.id });
    if (element.dataset.action === 'demo-merge' && result) {
      content.innerHTML =
        '<section class="card"><h2>模拟平台已执行 Git 合入</h2><p>返回工作台核验并补写接收记录。</p><a href="/">返回工作台 →</a></section>';
    }
    if (element.dataset.action === 'heads' && result) {
      document.getElementById('internal').value = result.result.internal;
      document.getElementById('upstream').placeholder = `最新 ${result.result.upstream}；请填已同步版本`;
    }
  }
});
document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const fields = Object.fromEntries(new FormData(form));
  const input = { action: form.dataset.form, ...fields };
  if (input.action === 'issue') input.sourceId = form.dataset.source;
  if (input.action === 'receipts')
    input.observations = snapshot.state.active.issues.map((issue) => ({
      sourceId: issue.sourceId,
      internalId: snapshot.state.issues[issue.sourceId].internalId,
      state: fields[issue.sourceId],
    }));
  await action(input);
});
refresh().catch((error) => {
  errorPanel.textContent = error.message;
  errorPanel.hidden = false;
});
