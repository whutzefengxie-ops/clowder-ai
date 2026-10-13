# #1590 两条可证伪原型

这些脚本只在当前 worktree 的 `.cat-cafe/tmp/acp-prototypes/` 准备固定上游副本，不接生产。`*.test.template.ts` 复制到上游测试目录后执行；其相对 import 按生成位置解析。

Codex 研究副本固定到 `51f78d67e46c3a96ee8d8bf4e43fc917ab21c73e`。从 worktree 根执行 `node scripts/acp-spikes/prepare-codex-prototype.mjs <研究副本绝对路径>`；在生成的 codex 目录执行 `npm ci --ignore-scripts`、`node build.mjs`、`node node_modules/vitest/vitest.mjs run src/__tests__/clowder-fence.test.ts`。另在 worktree 根用 API 的 tsx loader 执行 `codex-native-fence.test.ts`。

Codex 扩展只做 snapshot 与 exact steer，不能作为生产控制端口。当前只有 L1：真实桥函数、模拟 native 方法和可控竞态；operation 缓存、取消、重连、断线对账等还未形成生产生命周期合同。没有真实 native/provider 回执，不能 Go。

Claude 研究副本固定到 v0.70.0 / `d0aafb1ca26427285ffaeac8d8a4452fff28e9c3`。从 worktree 根执行 `prepare-claude-prototype.mjs <研究副本绝对路径>`；生成目录安装锁定依赖后执行 `node node_modules/vitest/vitest.mjs run src/tests/clowder-next-boundary.test.ts`。这是未修 baseline，预期 1 通过、2 失败。

增加 `--patch-next` 仅回填 next 分支，预期 2 通过、1 失败。它故意用于证明“设置 priority=next 不等于全部合同成立”，不具备 pending 真人输入保护，不能投入使用。合成 Session 对象的 RED 不是实际 SDK pending/abort 证据；完整上游 #1175 diff 与固定 v0.70.0 不兼容也单独记录，不把两种失败混为一谈。

真实 SDK/native 检查需要已明确授权的账号/profile、受限工具、原生回执和独立审查。当前认证授权待答复，两条原型均不 Go。回执见 `docs/design/2026-10-13-issue-1590-acp-unification/execution-evidence.md`。
