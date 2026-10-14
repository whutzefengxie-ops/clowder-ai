import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type HubCatEditorFormState, initialState } from '../../hub-cat-editor.model';
import { NativePartnerCard } from '../NativePartnerCard';
import { recommendNativePartners } from '../native-onboarding';

vi.mock('../../settings/members/MemberRuntimeFields', () => ({ MemberRuntimeFields: () => null }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function mount(status: 'configured' | 'login_required', change: Partial<HubCatEditorFormState> = {}) {
  const partner = recommendNativePartners(
    [
      {
        id: 'claude',
        label: 'Claude Code',
        clientId: 'anthropic',
        installed: true,
        models: [],
        readiness: { status, checkedAt: 1, loginCommand: 'claude auth login' },
      },
    ],
    [],
    [],
    'scope-journey',
  )[0];
  partner.form = { ...initialState(), ...partner.form, ...change };
  act(() => root.render(<NativePartnerCard partner={partner} created patch={vi.fn()} onValidityChange={vi.fn()} />));
  return host.textContent ?? '';
}
it.each(['configured', 'login_required'] as const)('retains %s evidence for the ordinary default partner', (status) => {
  expect(mount(status)).toContain(status === 'configured' ? '已检测登录' : '尚未登录');
});
it.each([
  ['explicit account', { accountRef: 'company-account' }],
  ['custom configuration', { cliConfigArgs: ['--settings', '/fixture/settings.json'] }],
  ['custom startup', { commandArgs: '--custom-startup' }],
  ['ACP identity', { clientId: 'acp' }],
] satisfies [
  string,
  Partial<HubCatEditorFormState>,
][])('does not apply either default login result to %s', (_, change) => {
  for (const status of ['configured', 'login_required'] as const) {
    const text = mount(status, change);
    expect(text).not.toContain('已检测登录');
    expect(text).not.toContain('尚未登录');
    expect(text).toContain('此连接的登录状态尚未检查');
  }
});
