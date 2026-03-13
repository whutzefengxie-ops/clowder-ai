import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from '@/components/ChatInput';

vi.mock('@/components/icons/SendIcon', () => ({
  SendIcon: () => React.createElement('span', null, 'send'),
}));
vi.mock('@/components/icons/LoadingIcon', () => ({
  LoadingIcon: () => React.createElement('span', null, 'loading'),
}));
vi.mock('@/components/icons/AttachIcon', () => ({
  AttachIcon: () => React.createElement('span', null, 'attach'),
}));
vi.mock('@/components/ImagePreview', () => ({
  ImagePreview: () => null,
}));
vi.mock('@/utils/compressImage', () => ({
  compressImage: (f: File) => Promise.resolve(f),
}));

beforeAll(() => {
  (globalThis as { React?: typeof React }).React = React;
});
afterAll(() => {
  delete (globalThis as { React?: typeof React }).React;
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
  const defaults = { onSend: vi.fn(), disabled: false };
  act(() => {
    root.render(React.createElement(ChatInput, { ...defaults, ...props }));
  });
}

function getTextarea(): HTMLTextAreaElement {
  return container.querySelector('textarea')!;
}

function getModeButton(): HTMLButtonElement {
  return container.querySelector('button[aria-label="Mode"]')!;
}

function typeInTextarea(value: string) {
  const ta = getTextarea();
  act(() => {
    // Simulate native input: set value then fire change
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set!;
    nativeInputValueSetter.call(ta, value);
    ta.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('ChatInput menu state isolation', () => {
  it('clicking mode button clears mention menu', () => {
    render();

    // Type "@" to trigger mention autocomplete
    typeInTextarea('@');

    // Mention menu should be visible
    const mentionMenu = container.querySelectorAll('.w-64');
    expect(mentionMenu.length).toBe(1);

    // Now click mode button
    act(() => {
      getModeButton().click();
    });

    // Mention menu (.w-64) should be gone, mode menu (.w-72) should appear
    expect(container.querySelectorAll('.w-64').length).toBe(0);
    expect(container.querySelectorAll('.w-72').length).toBe(1);
  });

  it('only one menu is visible at a time after mode click', () => {
    render();

    // Type "@" to trigger mention menu
    typeInTextarea('@');
    expect(container.querySelectorAll('.w-64').length).toBe(1);

    // Click mode button
    act(() => {
      getModeButton().click();
    });

    // Only mode menu visible
    const mentionMenus = container.querySelectorAll('.w-64');
    const modeMenus = container.querySelectorAll('.w-72');
    expect(mentionMenus.length).toBe(0);
    expect(modeMenus.length).toBe(1);
  });
});
