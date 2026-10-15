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
function mount(
  status: 'configured' | 'login_required',
  change: Partial<HubCatEditorFormState> = {},
  clientId: 'anthropic' | 'openai' | 'opencode' = 'anthropic',
) {
  const partner = recommendNativePartners(
    [
      {
        id: clientId === 'openai' ? 'codex' : clientId === 'opencode' ? 'opencode' : 'claude',
        label: clientId === 'openai' ? 'Codex' : clientId === 'opencode' ? 'OpenCode' : 'Claude Code',
        clientId,
        installed: true,
        models: [],
        readiness: { status, checkedAt: 1, loginCommand: clientId === 'openai' ? 'codex login' : 'claude auth login' },
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
it('does not promise Codex creation before the native login admission check can pass', () => {
  const text = mount('login_required', {}, 'openai');
  expect(text).toContain('新增伙伴前需要先登录');
  expect(text).not.toContain('可先创建伙伴');
});
it('shows the existing OpenCode workspace requirement before the first message', () => {
  expect(mount('configured', {}, 'opencode')).toContain('请先为对话选择项目目录');
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
