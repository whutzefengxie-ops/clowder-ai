import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { DEMO_DELIVERABLE_HTML } from '../../onboarding-demo/demo-deliverable';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { runScripts: 'dangerously' }) => { window: Window & typeof globalThis };
};

it('delivers the promised add, complete, filter and reviewed empty-state interactions', () => {
  const dom = new JSDOM(DEMO_DELIVERABLE_HTML, { runScripts: 'dangerously' });
  try {
    const page = dom.window.document;
    const input = page.querySelector<HTMLInputElement>('#new-task');
    const add = page.querySelector<HTMLButtonElement>('#add-task');
    if (!input || !add) throw new Error('Missing task form');
    input.value = '   ';
    add.click();
    expect(page.querySelector('#feedback')?.textContent).toContain('先写下一件小事');
    input.value = '  用户自己的小目标  ';
    add.click();
    expect(page.querySelector('#tasks')?.textContent).toContain('用户自己的小目标');
    page.querySelector<HTMLButtonElement>('[data-filter="open"]')?.click();
    while (page.querySelector<HTMLInputElement>('input[type="checkbox"]')) {
      page.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    }
    expect(page.querySelector<HTMLElement>('#empty')?.hidden).toBe(false);
    expect(page.querySelector('#empty')?.textContent).toContain('今天的任务都完成了');
    page.querySelector<HTMLButtonElement>('[data-filter="done"]')?.click();
    expect(page.querySelectorAll('#tasks li')).toHaveLength(4);
    expect(page.querySelector('#count')?.textContent).toBe('4 / 4 已完成');
    input.value = '<img src=x onerror=alert(1)>';
    add.click();
    expect(page.querySelector('#feedback')?.textContent).toContain('切换到');
    page.querySelector<HTMLButtonElement>('[data-filter="all"]')?.click();
    expect(page.querySelector('#tasks img')).toBeNull();
    expect(page.querySelector('#tasks')?.textContent).toContain('<img src=x onerror=alert(1)>');
  } finally {
    dom.window.close();
  }
});
