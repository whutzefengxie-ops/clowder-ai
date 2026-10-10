import { scenarios } from './data.mjs';
import { renderEvents, renderMapping, renderObjects, renderPhase } from './render-detail.mjs';
import { renderOverview } from './render-overview.mjs';
import { createState, reduce } from './state.mjs';
import { readState, storageKey, writeState } from './storage.mjs';

const element = (id) => document.getElementById(id);
let state = readState();
let view = 'overview';
let selectedPhase = state.active?.phase ?? 1;
let selectedId = state.active?.id ?? state.deliveries[0].id;
element('scenario').innerHTML = Object.entries(scenarios)
  .map(([key, label]) => `<option value="${key}">${label}</option>`)
  .join('');
function persist() {
  try {
    writeState(state);
  } catch {
    toast('浏览器未允许本地保存，当前交互仍可使用');
  }
}
function render() {
  element('auto-step').hidden = !state.active || state.active.block || ![7, 8].includes(state.active.phase);
  element('auto-step').textContent = state.active?.phase === 7 ? '模拟程序核验通过' : '模拟 Issue 核对完成';
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
  if (button.id === 'auto-step') dispatch('advance');
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
window.addEventListener('storage', (event) => {
  if (event.key !== storageKey) return;
  state = readState();
  selectedPhase = state.active?.phase ?? 1;
  render();
});
persist();
render();
