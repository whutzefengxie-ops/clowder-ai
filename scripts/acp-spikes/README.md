# #1590 两条可证伪原型

这些脚本只在当前 worktree 的 `.cat-cafe/tmp/acp-prototypes/` 准备固定上游副本，不接生产。`*.test.template.ts` 复制到上游测试目录后执行；其相对 import 按生成位置解析。

Codex 研究副本固定到 `51f78d67e46c3a96ee8d8bf4e43fc917ab21c73e`。从 worktree 根执行 `node scripts/acp-spikes/prepare-codex-prototype.mjs <研究副本绝对路径>`；在生成的 codex 目录执行 `npm ci --ignore-scripts`、`node build.mjs`、`node node_modules/vitest/vitest.mjs run src/__tests__/clowder-fence.test.ts`。另在 worktree 根用 API 的 tsx loader 执行 `codex-native-fence.test.ts`。

Codex 扩展提供 snapshot、exact steer 与 receipt，不能作为生产控制端口。现已有真实 native ID export、caller fence、有效/陈旧/非空未知/取消目标；2026-10-14 补上隔离持久认领、warm/cold 对账和 native clientId 证明，见控制恢复回执。设置 `CLOWDER_CONTROL_JOURNAL` 与冻结 `CLOWDER_CONTROL_BINDING_REVISION` 才启用持久路径；未设置时保留原型进程缓存。`CLOWDER_SPIKE_LOSE_NATIVE_REPLY=after-first` 只用于接受后故障注入。原型 journal 不承诺断电持久或活动断线存活，生产仍须复用既有 durable owner，完整 W4.P 仍 held。

Claude 研究副本固定到 v0.70.0 / `d0aafb1ca26427285ffaeac8d8a4452fff28e9c3`。从 worktree 根执行 `prepare-claude-prototype.mjs <研究副本绝对路径>`；生成目录安装锁定依赖后执行 `node node_modules/vitest/vitest.mjs run src/tests/clowder-next-boundary.test.ts`。这是未修 baseline，预期 1 通过、2 失败。

增加 `--patch-next` 回填 next 分支、窄 notice route、UUID 回执与原型协商。当前边界检查 3 通过；历史 2 通过/1 失败的“不允许 pending 时入队”判据已按独立审查纠正，真实 SDK 的未回答权限等待证据另存。完整上游 #1175 diff 与固定 v0.70.0 不兼容单独记录。

`--patch-followup` 是本地 narrow patch：原生命令 UUID → model message ID → tool ID → followup run ID 确认所有权，避免 owned autonomous idle 吞掉 steering 主请求的结清；外来任务的债务与 usage 仍分离。原无补丁的两类确定性 RED 已观察，修正版受影响 steering/next 检查 29 项通过，并重跑真实 now/next。生成目录用 `node node_modules/vitest/vitest.mjs run src/tests/acp-agent.test.ts src/tests/clowder-next-boundary.test.ts -t 'turn steering|W5.P'` 验证。

`readonly-fixture-mcp.mjs` 只读取环境指定目录内的 synthetic sentinel，允许固定 scenario 与最多 8 秒延迟、12 次调用，没有任意路径/命令入口。真实运行器及认证副本留在私有 `.cat-cafe/tmp/`，不加入 Git。当前用户已授权限定认证测试；它不授权发送仓库源码或公开消息。两条完整原型仍 held，回执见 `docs/design/2026-10-13-issue-1590-acp-unification/execution-evidence.md`。
