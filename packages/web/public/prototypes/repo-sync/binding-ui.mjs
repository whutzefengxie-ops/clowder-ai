import { initializeBinding, saveBinding, validateBinding } from './binding.mjs';
import { renderBinding } from './render-binding.mjs';

export function createBindingUI(getState, replaceState, redraw, toast) {
  const ui = { draft: structuredClone(getState().binding), checked: null, errors: [] };
  function reset() {
    ui.draft = structuredClone(getState().binding);
    ui.checked = null;
    ui.errors = [];
  }
  function changed(event) {
    if (!event.target.closest('#binding-form')) return;
    const form = document.getElementById('binding-form');
    const entries = Object.fromEntries(new FormData(form));
    ui.draft = { ...ui.draft, ...entries };
    ui.checked = null;
    ui.errors = [];
    document.getElementById('save-binding').disabled = true;
    document.getElementById('config-result').textContent = '配置已修改，请重新检查。';
    const initialize = document.getElementById('initialize-binding');
    if (initialize) initialize.disabled = true;
  }
  function action(id) {
    if (!['check-binding', 'save-binding', 'initialize-binding'].includes(id)) return false;
    try {
      if (id === 'check-binding') {
        ui.errors = validateBinding(ui.draft);
        ui.checked = ui.errors.length ? null : JSON.stringify(ui.draft);
        redraw();
      } else if (id === 'save-binding') {
        replaceState(saveBinding(getState(), ui.draft, ui.checked), 'configuration');
        reset();
        redraw();
        toast('新绑定已保存，继续模拟初始化');
      } else {
        if (JSON.stringify(ui.draft) !== JSON.stringify(getState().binding))
          throw new Error('配置已修改，请重新检查并保存。');
        replaceState(initializeBinding(getState()), 'overview');
        reset();
        redraw();
        toast('模拟初始化完成，可以开始接收交付');
      }
    } catch (error) {
      ui.errors = [error.message];
      redraw();
    }
    return true;
  }
  return { reset, changed, action, render: () => renderBinding(getState(), ui) };
}
