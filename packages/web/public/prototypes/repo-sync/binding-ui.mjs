import { defaultBinding, initializeBinding, saveBinding, validateBinding } from './binding.mjs';
import { BASE, COMPLETE } from './data.mjs';
import { renderBinding } from './render-binding.mjs';

export function createBindingUI(getState, replaceState, redraw, toast) {
  const ui = { draft: null, checked: null, errors: [], step: 1, editing: false };
  function reset() {
    ui.draft = structuredClone(getState().binding);
    if (ui.draft.status === 'draft') {
      const example = defaultBinding();
      if (!ui.draft.externalUrl) ui.draft.externalUrl = example.externalUrl;
      if (!ui.draft.internalUrl) ui.draft.internalUrl = example.internalUrl;
    }
    if (!ui.draft.baseline) ui.draft.baseline = BASE;
    ui.checked = null;
    ui.errors = [];
    ui.editing = getState().binding.status !== 'ready';
    ui.step = getState().binding.status === 'saved' ? 3 : 1;
  }
  function changed(event) {
    if (!event.target.closest('#binding-form')) return;
    ui.draft = { ...ui.draft, ...Object.fromEntries(new FormData(document.getElementById('binding-form'))) };
    ui.checked = null;
    ui.errors = [];
    const save = document.getElementById('save-binding');
    if (save) save.disabled = true;
    const result = document.getElementById('config-result');
    if (result) result.textContent = '配置已修改，请重新检查。';
    document.getElementById('wizard-error')?.replaceChildren();
  }
  const actions = {
    'example-binding'() {
      const example = defaultBinding();
      for (const field of ['externalUrl', 'internalUrl', 'sourceBranch', 'targetBranch', 'internalWebUrl'])
        ui.draft[field] = example[field];
      ui.checked = null;
      ui.errors = [];
      toast('已填入示例仓库，可以直接点击下一步');
    },
    'edit-binding'() {
      if (getState().active && getState().active.phase < COMPLETE) throw new Error('当前同步尚未完成，不能修改连接。');
      ui.editing = true;
      ui.step = 1;
    },
    'cancel-binding': reset,
    'previous-binding'() {
      ui.step = Math.max(1, ui.step - 1);
      ui.errors = [];
    },
    'next-binding'() {
      ui.errors = validateBinding(ui.draft, ui.step === 1 ? 'connection' : 'baseline');
      if (!ui.errors.length) ui.step += 1;
    },
    'check-binding'() {
      ui.errors = validateBinding(ui.draft);
      ui.checked = ui.errors.length ? null : JSON.stringify(ui.draft);
    },
    'save-binding'() {
      replaceState(saveBinding(getState(), ui.draft, ui.checked), 'configuration');
      reset();
      toast('连接已保存，完成模拟初始化即可使用');
    },
    'initialize-binding'() {
      if (JSON.stringify(ui.draft) !== JSON.stringify(getState().binding))
        throw new Error('配置已修改，请重新检查并保存。');
      replaceState(initializeBinding(getState()), 'overview');
      reset();
      toast('初始化完成，现在可以开始同步');
    },
  };
  function action(id) {
    if (!Object.hasOwn(actions, id)) return false;
    try {
      actions[id]();
      redraw();
    } catch (error) {
      ui.errors = [error.message];
      redraw();
    }
    return true;
  }
  reset();
  return { reset, changed, action, render: () => renderBinding(getState(), ui) };
}
