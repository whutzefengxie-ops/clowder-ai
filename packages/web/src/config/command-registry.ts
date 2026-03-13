/**
 * Slash command registry — single source of truth for all chat commands.
 * Used by useChatCommands (dispatch) and HubCommandsTab (display).
 *
 * To add a new command:
 * 1. Add a CommandDefinition here
 * 2. Add the handler in useChatCommands.ts
 * That's it — the "命令速查" tab picks it up automatically.
 */

export type CommandCategory = 'general' | 'memory' | 'knowledge' | 'game' | 'task' | 'vote' | 'connector';

export interface CommandDefinition {
  /** The command string, e.g. '/help' */
  name: string;
  /** Usage pattern, e.g. '/config set <key> <value>' */
  usage: string;
  /** Human-readable description (Chinese) */
  description: string;
  /** Grouping category for display */
  category: CommandCategory;
}

export const COMMAND_CATEGORIES: Record<CommandCategory, string> = {
  general: '通用',
  memory: '记忆',
  knowledge: '知识库',
  game: '游戏',
  task: '任务',
  vote: '投票',
  connector: '跨平台',
};

export const COMMANDS: CommandDefinition[] = [
  // --- general ---
  { name: '/help', usage: '/help', description: '打开功能速查面板', category: 'general' },
  { name: '/config', usage: '/config', description: '打开系统配置面板', category: 'general' },
  { name: '/config set', usage: '/config set <key> <value>', description: '热更新运行时配置', category: 'general' },

  // --- memory ---
  { name: '/remember', usage: '/remember <key> <value>', description: '保存对话记忆', category: 'memory' },
  { name: '/recall', usage: '/recall [key]', description: '查看对话记忆（无 key 列出全部）', category: 'memory' },
  { name: '/approve', usage: '/approve <entryId>', description: '审批待发布的记忆条目', category: 'memory' },
  { name: '/archive', usage: '/archive <entryId>', description: '归档已发布的记忆条目', category: 'memory' },

  // --- knowledge ---
  { name: '/evidence', usage: '/evidence <query>', description: '搜索项目知识库（Hindsight）', category: 'knowledge' },
  { name: '/reflect', usage: '/reflect <query>', description: 'AI 反思项目知识', category: 'knowledge' },
  { name: '/signals', usage: '/signals [inbox]', description: '查看今日 Signal inbox', category: 'knowledge' },
  { name: '/signals search', usage: '/signals search <query>', description: '搜索 Signal 文章', category: 'knowledge' },
  {
    name: '/signals sources',
    usage: '/signals sources [sourceId on|off]',
    description: '查看/切换信源启用状态',
    category: 'knowledge',
  },
  { name: '/signals stats', usage: '/signals stats', description: '查看 Signal 统计信息', category: 'knowledge' },

  // --- task ---
  { name: '/tasks extract', usage: '/tasks extract [N]', description: '从对话中提取任务', category: 'task' },

  // --- vote (F079) ---
  { name: '/vote', usage: '/vote', description: '打开投票配置面板', category: 'vote' },
  { name: '/vote status', usage: '/vote status', description: '查看当前投票状态', category: 'vote' },
  { name: '/vote cast', usage: '/vote cast <选项>', description: '投票给指定选项', category: 'vote' },
  { name: '/vote end', usage: '/vote end', description: '结束当前投票并显示结果', category: 'vote' },

  // --- game (F101) ---
  { name: '/game', usage: '/game werewolf [player|god-view] [voice]', description: '开始狼人杀游戏', category: 'game' },
  { name: '/game status', usage: '/game status', description: '查看当前游戏状态', category: 'game' },
  { name: '/game end', usage: '/game end', description: '结束当前游戏', category: 'game' },

  // --- connector (F088, Telegram/飞书等跨平台命令) ---
  { name: '/where', usage: '/where', description: '查看当前绑定的 thread', category: 'connector' },
  { name: '/new', usage: '/new [标题]', description: '创建新 thread 并切换', category: 'connector' },
  { name: '/threads', usage: '/threads', description: '列出最近的 threads', category: 'connector' },
  { name: '/use', usage: '/use <F号|序号|关键词>', description: '切换到指定 thread', category: 'connector' },
];
