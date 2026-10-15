import { describe, expect, it } from 'vitest';
import type { CatData } from '@/hooks/useCatData';
import templateConfig from '../../../../../../cat-template.json';
import { initialState } from '../../hub-cat-editor.model';
import type { RuntimeChoice } from '../../settings/members/member-runtime-draft';
import { recommendNativePartners } from '../native-onboarding';
import { nativePartnerIdentity } from '../native-partner-identity';

const tools: RuntimeChoice[] = (['kimi', 'opencode'] as const).map((id) => ({
  id,
  label: id === 'kimi' ? 'Kimi' : 'OpenCode',
  clientId: id,
  installed: true,
  configuredModel: id === 'kimi' ? 'kimi-code/kimi-for-coding' : 'personal/gpt-test',
  models: [],
}));

describe('native partner identities reflect tools rather than an unrelated model family', () => {
  it('uses the real Kimi and OpenCode templates and distinct, editable personalities', () => {
    const partners = tools.map((runtime) => ({
      form: nativePartnerIdentity(runtime, templateConfig.roleTemplates, []),
    }));
    expect(partners.map(({ form }) => form.avatar)).toEqual([
      '/avatars/family/kimi.png',
      '/avatars/family/opencode.png',
    ]);
    expect(partners.map(({ form }) => form.displayName)).toEqual(['梵花猫', '金渐层']);
    expect(new Set(partners.map(({ form }) => form.personality)).size).toBe(2);
    for (const { form } of partners) {
      expect(form.roleDescription).not.toMatch(/GLM|多专家|LSP/);
      expect(form.personality.length).toBeGreaterThan(5);
      expect(form.defaultModel).toBe('');
      expect(form.cliEffort).toBe('');
    }
  });
  it('never falls back to a different family when its specific template is absent', () => {
    const onlyGlm = templateConfig.roleTemplates.filter(({ id }) => id === 'dragon-li');
    const partners = tools.map((runtime) => ({ form: nativePartnerIdentity(runtime, onlyGlm, []) }));
    expect(partners.map(({ form }) => form.displayName)).toEqual(['Kimi 伙伴', 'OpenCode 伙伴']);
    expect(partners.every(({ form }) => !form.roleDescription.includes('GLM'))).toBe(true);
    expect(partners.every(({ form }) => form.avatar !== '/avatars/family/glm52.png')).toBe(true);
  });
  it('uses a neutral identity for a generic ACP tool', () => {
    const partner = recommendNativePartners(
      [
        {
          id: 'dsh',
          label: 'DSH',
          clientId: 'acp',
          installed: true,
          models: [],
          acp: { command: 'dsh', startupArgs: [] },
        },
      ],
      templateConfig.roleTemplates,
      [],
      'dsh-identity',
    )[0];
    expect(partner.form.avatar).toBe('/avatars/default.png');
    expect(partner.form.displayName).toBe('DSH 伙伴');
    expect(partner.form.roleDescription).not.toContain('GLM');
  });
  it('recommends Pi instead of OpenCode for a new partner', () => {
    const pi: RuntimeChoice = {
      id: 'pi',
      label: 'Pi',
      clientId: 'acp',
      installed: true,
      models: [],
      acp: { command: 'node', startupArgs: ['pi-bridge.mjs'] },
    };
    const partners = recommendNativePartners([...tools, pi], templateConfig.roleTemplates, [], 'pi-replacement');
    expect(partners.map(({ runtime }) => runtime.label)).toEqual(['Kimi', 'Pi']);
    const form = partners[1].form;
    expect(form.nickname).toBe('派派');
    expect(form.avatar).not.toBe(partners[0].form.avatar);
    expect(form.personality).not.toBe(partners[0].form.personality);
    expect(form.roleDescription).not.toMatch(/GLM|OpenCode/);
    expect(form.defaultModel).toBe('');
  });
  it('preserves the complete existing identity, including custom names and model overrides', () => {
    const cat = {
      id: 'kimi',
      displayName: '我的研究伙伴',
      name: '我的研究伙伴',
      nickname: '自定义昵称',
      avatar: '/custom.png',
      clientId: 'kimi',
      configurationSource: 'native_tool',
      carrier: 'cli',
      defaultModel: 'explicit/model',
      mentionPatterns: ['@research'],
      color: { primary: '#123456', secondary: '#abcdef' },
      roleDescription: '我设定的分工',
      personality: '我设定的性格',
    } as CatData;
    expect(recommendNativePartners(tools.slice(0, 1), templateConfig.roleTemplates, [cat], 'existing')[0].form).toEqual(
      initialState(cat),
    );
  });
});
