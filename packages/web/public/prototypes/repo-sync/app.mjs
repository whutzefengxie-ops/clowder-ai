import { createBindingUI } from './binding-ui.mjs';
import { scenarios } from './data.mjs';
import { deliveryPhase } from './delivery.mjs';
import { renderDelivery } from './render-delivery.mjs';
import { renderMapping, renderObjects } from './render-detail.mjs';
import { renderOverview } from './render-overview.mjs';
import { createState, reduce } from './state.mjs';
import { readState, storageKey, writeState } from './storage.mjs';

const element = (id) => document.getElementById(id);
let state = readState();
let view = state.binding.status === 'ready' ? 'overview' : 'configuration';
let selectedPhase = state.active?.phase ?? 1;
let selectedId = state.active?.id ?? state.deliveries[0].id;
const bindingUI = createBindingUI(() => state, replaceState, render, toast);
function replaceState(next, nextView) {
  state = next;
  view = nextView;
  selectedPhase = state.active?.phase ?? 1;
  selectedId = state.active?.id ?? state.deliveries[0].id;
  persist();
}
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
  element('scenario').value = state.scenario;
  element('overview').innerHTML = view === 'delivery' ? '' : renderOverview(state, selectedPhase);
  element('delivery').innerHTML = view === 'delivery' ? renderDelivery(state, selectedId, selectedPhase) : '';
  if (element('object-summary')) element('object-summary').innerHTML = renderObjects(state, state.active);
  element('mapping').innerHTML =
    state.binding.status === 'ready'
      ? renderMapping(state, selectedId)
      : '<div class="notice">初始化完成后才会建立提交与对象映射。</div>';
  element('configuration').innerHTML = bindingUI.render();
  element('repo-label').textContent =
    state.binding.status === 'draft'
      ? '尚未绑定仓库'
      : state.binding.externalUrl
          .replace(/\.git$/, '')
          .split(/[/:]/)
          .slice(-2)
          .join(' / ');
  for (const name of ['overview', 'mapping', 'delivery', 'configuration']) element(name).hidden = name !== view;
  const names = {
    overview: '同步总览',
    mapping: '提交与对象映射',
    delivery: '交付详情与审计',
    configuration: '仓库连接与初始化',
  };
  element('view-name').textContent = names[view];
  for (const button of document.querySelectorAll('.nav-item')) {
    const current = button.dataset.view === view || (view === 'delivery' && button.dataset.view === 'overview');
    button.classList.toggle('selected', current);
    button.setAttribute('aria-current', current ? 'page' : 'false');
  }
}
function dispatch(type, extra = {}) {
  state = reduce(state, { type, ...extra });
  if (view !== 'delivery' || selectedId === state.active?.id) {
    selectedPhase = state.active?.phase ?? 1;
    selectedId = state.active?.id ?? selectedId;
  }
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
function navigate(button) {
  if (button.dataset.view) {
    view = button.dataset.view;
    render();
    return true;
  }
  if (button.dataset.phase) {
    selectedPhase = Number(button.dataset.phase);
    render();
    return true;
  }
  if (button.dataset.delivery) {
    selectedId = button.dataset.delivery;
    const delivery = state.deliveries.find((item) => item.id === selectedId);
    selectedPhase = deliveryPhase(state, delivery) || 1;
    view = 'delivery';
    render();
    return true;
  }
  if (button.dataset.map) {
    selectedId = button.dataset.map;
    view = 'mapping';
    render();
    return true;
  }
  return false;
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || bindingUI.action(button.id) || navigate(button)) return;
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
  const next = createState(scenario, state.binding);
  next.archives = state.archives;
  state = next;
  bindingUI.reset();
  selectedPhase = state.active?.phase ?? 1;
  selectedId = state.active?.id ?? state.deliveries[0].id;
  view = state.binding.status === 'ready' ? 'overview' : 'configuration';
  persist();
  render();
  toast('演示状态已重置');
}
element('scenario').addEventListener('change', (event) => reset(event.target.value));
document.addEventListener('change', (event) => {
  bindingUI.changed(event);
  if (event.target.id === 'mapping-delivery') {
    selectedId = event.target.value;
    render();
  }
});
document.addEventListener('input', (event) => bindingUI.changed(event));
document.getElementById('configuration').addEventListener('submit', (event) => event.preventDefault());
window.addEventListener('storage', (event) => {
  if (event.key !== storageKey) return;
  state = readState();
  bindingUI.reset();
  if (view !== 'delivery' || selectedId === state.active?.id) selectedPhase = state.active?.phase ?? 1;
  render();
});
persist();
render();
