import { defineShellCopy } from '../shell/shell-copy';

export const onboardingEntryCopy = defineShellCopy({
  zh: {
    watch: '看看团队如何协作',
    create: '一键检测本机工具',
    manual: '手动添加成员',
    manage: '成员与运行时',
    empty: '还没有成员，先检测本机工具，再选择要加入的伙伴。',
  },
  en: {
    watch: 'See the team collaborate',
    create: 'Detect local tools',
    manual: 'Add a member manually',
    manage: 'Members & runtimes',
    empty: 'No members yet. Detect local tools, then choose which teammates to add.',
  },
});
