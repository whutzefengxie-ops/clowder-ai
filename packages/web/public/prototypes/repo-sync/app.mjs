import { scenarios } from './data.mjs';
import { renderEvents, renderMapping, renderObjects, renderPhase } from './render-detail.mjs';
import { renderOverview } from './render-overview.mjs';
import { createState, reduce } from './state.mjs';

const storageKey = 'clowder-repo-sync-demo-v1';
const element = (id) => document.getElementById(id);
let state = createState();
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (
    saved?.schema === 1 &&
    Array.isArray(saved.deliveries) &&
    Array.isArray(saved.events) &&
    scenarios[saved.scenario]
  )
    state = saved;
} catch {
  /* Unavailable storage or an older demo starts with synthetic defaults. */
}
let view = 'overview';
let selectedPhase = state.active?.phase ?? 1;
let selectedId = state.active?.id ?? state.deliveries[0].id;
element('scenario').innerHTML = Object.entries(scenarios)
  .map(([key, label]) => `<option value="${key}">${label}</option>`)
  .join('');
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    toast('浏览器未允许本地保存，当前交互仍可使用');
  }
}
function render() {
  element('scenario').value = state.scenario;
  element('overview').innerHTML = renderOverview(state, selectedPhase);
  element('phase-detail').innerHTML = renderPhase(state, selectedPhase);
  element('object-summary').innerHTML = renderObjects(state, state.active);
  element('mapping').innerHTML = renderMapping(state, selectedId);
  element('events').innerHTML = renderEvents(state);
  for (const name of ['overview', 'mapping', 'events']) element(name).hidden = name !== view;
  const names = { overview: '同步总览', mapping: '提交与对象映射', events: '执行记录' };
  element('view-name').textContent = names[view];
  for (const button of document.querySelectorAll('.nav-item')) {
    button.classList.toggle('selected', button.dataset.view === view);
    button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false');
  }
}
function dispatch(type, extra = {}) {
  state = reduce(state, { type, ...extra });
  selectedPhase = state.active?.phase ?? 1;
  selectedId = state.active?.id ?? selectedId;
  persist();
  render();
}
let toastTimer;
function toast(message) {
  element('toast').textContent = message;
  element('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element('toast').classList.remove('visible'), 2600);
}
async function copyCommit(commit) {
  try {
    await navigator.clipboard.writeText(commit);
    toast('提交 ID 已复制');
  } catch {
    toast(`提交 ID：${commit}`);
  }
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.view) {
    view = button.dataset.view;
    render();
  }
  if (button.dataset.phase) {
    selectedPhase = Number(button.dataset.phase);
    render();
  }
  if (button.dataset.delivery) {
    selectedId = button.dataset.delivery;
    view = 'mapping';
    render();
  }
  if (button.dataset.copy) copyCommit(button.dataset.copy);
  if (['start', 'advance', 'recover', 'external'].includes(button.id)) dispatch(button.id);
  if (button.id === 'approve') {
    element('approval-context').textContent =
      `外部 PR #${state.active.sourcePr} → 内部 PR #${state.active.internalPr} · 目标 ${state.active.target}`;
    element('approval-note').value = '';
    element('approval-dialog').showModal();
    element('approval-note').focus();
  }
  if (button.id === 'cancel-approval') element('approval-dialog').close();
  if (button.id === 'adapter-button') element('adapter-dialog').showModal();
  if (button.id === 'close-adapter') element('adapter-dialog').close();
  if (button.id === 'demo-toggle') {
    const hidden = !element('demo-controls').hidden;
    element('demo-controls').hidden = hidden;
    button.textContent = hidden ? '显示演示控制' : '隐藏演示控制';
    button.setAttribute('aria-expanded', String(!hidden));
  }
  if (button.id === 'reset') reset(element('scenario').value);
});
function reset(scenario) {
  state = createState(scenario);
  selectedPhase = state.active?.phase ?? 1;
  selectedId = state.active?.id ?? state.deliveries[0].id;
  view = 'overview';
  persist();
  render();
  toast('演示状态已重置');
}
element('scenario').addEventListener('change', (event) => reset(event.target.value));
document.addEventListener('change', (event) => {
  if (event.target.id === 'mapping-delivery') {
    selectedId = event.target.value;
    render();
  }
});
element('approval-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const note = element('approval-note').value.trim();
  if (!note) return;
  element('approval-dialog').close();
  dispatch('approve', { note });
  toast('模拟合入完成，下一步验收与关单');
});
render();
