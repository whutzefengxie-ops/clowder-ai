export const BASE = 'a17e9b40';
export const COMPLETE = 9;
export const phases = [
  '发现交付',
  '冻结与校验',
  '映射 Issue',
  '搬运提交',
  '创建内部 PR',
  '运行检查',
  '等待审批',
  '合入后核验',
  '核对 Issue 状态',
  '完成',
];
export const deliveries = [
  {
    id: 'delivery-041',
    target: 'c2f84d91',
    sourcePr: 84,
    internalPr: 92,
    issue: 71,
    internalIssue: 318,
    title: '统一插件加载与生命周期',
    time: '10:24',
    commits: ['bf903a62', 'c2f84d91'],
    mode: 'Merge',
    files: 12,
  },
  {
    id: 'delivery-042',
    target: 'e90bd735',
    sourcePr: 87,
    internalPr: 93,
    issue: 76,
    internalIssue: 319,
    title: '增加插件配置校验',
    time: '11:08',
    commits: ['e90bd735'],
    mode: 'Squash',
    files: 6,
  },
];
export const scenarios = {
  unconfigured: '首次配置连接',
  waiting: '等待内部审批',
  verify: '合入后核验',
  reconcile: '核对 Issue 状态',
  behind: '尚未开始同步',
  timeout: 'PR 创建结果待核对',
  plugin: '插件兼容检查失败',
  drift: '内部核心基线偏移',
  metadata: '代码最新 · 关单待补齐',
  synced: '全部同步完成',
};
export const phaseDetails = [
  [
    '发现交付',
    '按外部 main 的落地顺序识别已合入 PR，关联 Issue 与实际落地提交。',
    'repo-sync discover --source github/demo/core',
  ],
  [
    '冻结与校验',
    '固定交付目标，核验接受基线，先在本地准备候选分支和文件树，再创建平台对象；后续更新只加入队列。',
    'git fetch upstream main\ngit diff --exit-code accepted-upstream internal/main -- .',
  ],
  [
    '映射 Issue',
    '按外部对象 ID 查映射，存在则复用；创建内部 Issue 后写入映射账本。',
    'repo-sync issue ensure --source 71 --delivery delivery-041',
  ],
  [
    '搬运提交',
    '推送已从内部 main 构造并校验的候选分支，保留上游原始对象；首次快照接收需先连接已确认的初始化历史。',
    'git fetch upstream main\ngit switch -c sync/delivery-041 internal/main\n# 仅首次独立快照：基线树相同才连接历史\ngit merge --no-ff --allow-unrelated-histories a17e9b40\ngit merge --no-ff c2f84d91\n# 核对候选树与冻结目标相同后推送\ngit push internal sync/delivery-041',
  ],
  [
    '创建内部 PR',
    '先核对交付 ID 与候选分支是否已有 PR，再创建；超时后查回结果，避免重复。',
    'repo-sync pr ensure --delivery delivery-041 --base main',
  ],
  [
    '运行检查',
    '比较候选核心文件树，执行测试与独立插件兼容检查。失败时不移动内部 main。',
    'repo-sync checks run --delivery delivery-041',
  ],
  [
    '等待审批',
    '人工在内部平台的具体 PR 页面审核和合入。同步工具只读取结果，点击打开 PR 不代表审批通过。',
    'repo-sync pr inspect --id 92',
  ],
  [
    '合入后核验',
    '程序自动读取 PR 合入结果，获取实际 main，核验其文件树与目标一致、来源提交仍可达；通过后更新接受版本，无需人工验收按钮。',
    'git fetch internal main\ngit diff --exit-code c2f84d91 internal/main -- .\ngit merge-base --is-ancestor c2f84d91 internal/main',
  ],
  [
    '核对 Issue 状态',
    '程序自动核对已映射的正确内部 Issue。平台已自动关闭则只记录；未关闭且确有本交付关闭义务时，按映射显式关闭。普通关联 Issue 保持打开。',
    'repo-sync issue reconcile --delivery delivery-041',
  ],
  ['完成', '代码验收和元数据核对均完成，下一笔交付可以开始。', 'repo-sync ledger inspect --delivery delivery-041'],
];
