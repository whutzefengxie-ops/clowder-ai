import type { CatData } from '@/hooks/useCatData';
import { initialState } from '../hub-cat-editor.model';
import { templateForm } from '../settings/members/member-editor-state';
import type { RuntimeChoice } from '../settings/members/member-runtime-draft';
import type { TemplateCard } from './TemplateStep';

const templatesByClient: Record<string, string> = {
  anthropic: 'ragdoll',
  openai: 'maine-coon',
  kimi: 'turkish-van',
  opencode: 'golden-chinchilla',
};

/** Tool identities are independent of the model/provider chosen in that tool. */
export function nativePartnerIdentity(runtime: RuntimeChoice, templates: TemplateCard[], cats: CatData[]) {
  const template = templates.find((item) => item.id === templatesByClient[runtime.clientId]);
  const form = template
    ? templateForm(template, cats, initialState())
    : {
        ...initialState(),
        name: `${runtime.label} 伙伴`,
        displayName: `${runtime.label} 伙伴`,
        nickname: runtime.label,
        avatar: '/avatars/default.png',
        roleDescription: '一起分析问题、完成任务',
        personality: '认真务实，先确认目标，完成后说明结果',
        teamStrengths: '任务拆解、实现与验证',
      };
  if (runtime.clientId === 'opencode') {
    form.roleDescription = '负责编码实现和工具协作，模型跟随 OpenCode 配置';
    form.personality = '沉稳务实，先确认目标，再逐步实现并回报结果';
    form.teamStrengths = '编码实现、工具协作、结果验证';
  }
  if (runtime.id === 'pi' || runtime.label === 'Pi') {
    form.name = form.displayName = 'Pi 伙伴';
    form.nickname = '派派';
    form.avatar = '/avatars/default.png';
    form.roleDescription = '轻量编码伙伴，负责拆解小任务、实现和验证';
    form.personality = '敏捷克制，先给最小可用实现，再补验证细节';
    form.teamStrengths = '任务拆解、编码实现、测试验证';
  }
  return form;
}
