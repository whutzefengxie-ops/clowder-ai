---
feature_ids: [F143, F161]
topics: [acp, implementation, tool-results, permission, evidence]
doc_kind: report
created: 2026-10-13
tips_exempt: {reason: "修复既有工具结果与权限语义，当前阶段没有新增用户操作入口"}
---

# W0/W1、W2.S 与原型执行回执

工作区：`G:/AIwork/clowder-ai/worktrees/feat-acp-unified-client-plan-1590`；分支 `feat/acp-unified-client-plan-1590`。生产配置、服务和历史未用于本分支验收，迁移未开启。

## 阶段与门禁

| 阶段 | 本次实物 | 独立审查 | 尚未放行的边界 |
|---|---|---|---|
| W0 | 9 份冻结 Git blob hash、北向接口清单、6 个 carrier 声明、CLI/桥/SDK 版本与原生二进制 hash | 源码基线足以实施 W1 | 每个实际 binding 的 B/R/E、账号/profile、运行预算与升级演练尚未完整冻结，完整 G0 未通过 |
| W1 | 原生 `user/tool_result` 漏接修复、原生 ID/parent/invocation 配对、raw payload、失败状态、持久/直播/重放消费点 | 两个 P2 已修，代码层通过 | 官方 SDK 的真实调用因认证未取得；完整平台调用/socket/UI 链未验收，完整 G1 未通过 |
| W2.S | STDIO/HTTP 共用 fail-closed 权限边界、factory 显式默认取消、prompt admission/generation、取消隔离 | P1/P2 全部修复，安全下限通过 | 不是 W3.P 平台 principal/policy/审批/审计，也不证明原生工具已静止 |
| W4.P | 固定 Codex 桥原型构建、扩展到真实 `CodexAcpClient` 方法映射、可控 A→B 反例 | L1 证据边界通过 | 真实 native fence/bridge/provider 回执未取得，不 Go |
| W5.P | 固定 Claude 桥及候选兼容性检查、next-only 回填与反例 | RED 与证据边界确认 | next-only 未通过全部合成检查；真实非打断、UUID/result、pending 人工交互未验收，不 Go |

审查者：独立个体 `/root/acp_plan_review`，作者之外的本地同行。同家族审查，不称为跨家族审查；回执只覆盖各自阶段，未批准 G0、完整 G1、G3 或整体迁移。

## W1 的实际路径

根因：Claude 原生结果位于 `user.message.content[].tool_result`，共用 decoder 未处理该分支。print 与官方 SDK 均调用该 decoder。bg 的 assistant-only consumer 和 PTY 独立路径不在本窄修复覆盖范围。

先观察新增 decoder 检查 8 项失败、1 项通过，再修复。用原生 `tool_use_id` 发结果，保留 `parent_tool_use_id` 到 `toolParentUseId`。根调用原生 ID 不改写；内部配对按 parent/native ID，历史再按 invocation/session 分隔。没有对应 use 的结果保留原生事实，不编造工具名。原生缺省 `is_error` 为成功；畸形值保留 unknown。

`toolRawPayload` 沿用 #1519 的最小合同形状，完整 input/output/content 进入 canonical transcript；1500 字符历史预览保持有界。#1519 未整体合入本分支。ToolSpanTracker、串/并行 pending、ToolEventLog、StoredToolEvent、前台/后台消息事实及故事重放保留同一调用作用域。

独立审查发现并修正：并行 nameless/orphan 带 ID 结果不能 FIFO 消耗别的调用；新 invocation 重用 ID 不能改写旧 ToolEventLog。两个反例留在既有测试中。

真实 Claude CLI 2.1.296、模型 `claude-opus-5-5[1m]` 完成受限 Read/Agent 调用。472 个原始事件中有 5 次 use、5 次 result，其中 2 次失败、2 次子调用结果。原始输出留在 worktree 私有临时目录，脱敏完整工具块在 [fixture](../../../packages/api/test/fixtures/claude-native-tool-results.json)，hash 与脱敏规则在 [原生捕获](evidence/w1-native-capture.json)。不从 `apiKeySource:none` 推断 OAuth、账单或正式绑定。

真实数据 → 生产 decoder → `TranscriptWriter` 写盘 → 新 `TranscriptReader` 冷读，10 个工具事件和完整 raw output 不丢。随后在 `https://claude-w1-replay.test` 的隔离 Edge 中用生产 `ReplayMessageList`/`CliOutputBlock` 展开 5 个工具行并刷新，2 次原生失败仍可见、无 pageerror。该证据是实际组件和实际持久数据，网络夹具并非生产 API/socket；截图没有加载完整产品样式，不用于视觉验收。

## W2.S 的实际边界

- 两条实际权限入口先观察默认 Allow 的 2 项 RED。无 handler、factory 未接审批、异常/rejection、超时、非法选择和畸形 schema 均返回 ACP `cancelled`；仅显式 handler 的合法选项才能 selected。
- 真实 prompt 在写 wire 前准入；原生终态撤销准入；取消、超时或 consumer 提前退出且未获原生终态，隔离旧连接的该 session。后续请求不能自行重开；其他活跃 session 保持独立。取消后的新执行需要新连接，复用现有 pool 退役判断。
- 审批决定与写 wire 之间再检查 admission generation；同步 allow 后同 tick cancel 也不能送 selected。迟到 callback、新权限 request、旧 session 的再 prompt 和 closed connection 不再获得权限。
- 实际 STDIO/随机端口 HTTP NDJSON 夹具验证 A 取消、B 正常、数字 ID 原样保留、畸形 kind 取消、STDIO 原生终态后的迟到请求，以及 consumer early-return。模拟 native/权限 owner，未声称真人审批 UI 验收。

## Go/No-Go 的当前结论

Codex 原型在固定 `51f78d67` 的 `extMethod` 中挂接 `_clowder/v1/control`，`snapshot` 读取 native callback 所保存的 turn ID；caller `expectedTurnId` 原值经真正 `CodexAcpClient.steerTurn` 进入 native `turn/steer.expectedTurnId`。桥方法检查 1 项、可控 fake native race/idempotency 检查 2 项通过。未启动真实模型/原生 A/B 竞态，也未验证断线对账、取消全部交错，因此不能 Go；这个实现只用于原型，不是生产能力合同。

Claude 固定 v0.70.0 / `d0aafb1c` / SDK 0.3.232。实际 `git apply --check` 证明 #1175 完整 diff 不能直接应用到固定源码。未修桥的 3 个检查为 1 通过、2 失败；next-only 最小回填后为 2 通过、1 失败。通过项仅证明 next/UUID 输入和 idle promptRequired 分支；失败项用合成 `pendingUserInputCount=1` 对象测试保守不投递条件，不能外推为真实 SDK 已绕过审批或发生 abort。完整非打断语义和维护路线仍待证明，不据此断言 ACP 不可行。

原型准备脚本和检查位于 `scripts/acp-spikes/`；上游副本在 worktree 的 `.cat-cafe/tmp/acp-prototypes/`，没有嵌入 Git 仓库；研究 clone 在 workspace 根目录。未修改上游源仓，也未公开发社区消息。

## 验证与限制

最终受影响检查：API build；131 项既有/入口回归；42 项新源码检查；28 项前端适配器检查；1 项浏览器重放。具体输出与 SHA 见 [机器回执](evidence/stage-validation.json)。Biome 对变更文件检查通过，保留既有 complexity/non-null 等 warning；API 类型检查及前端源码类型检查通过。

完整 Web tsc 另有既有 `vitest.config.ts` 的重复 Vitest reporter 类型身份冲突，前端源码检查排除该配置后通过，未称整个 `pnpm lint` 通过。更宽的 print/SDK 检查曾有 6 项失败：5 项 Windows 下 MCP 参数为文件路径而测试按内联 JSON 读取，1 项 SDK `/tmp/images` 与 Windows resolved path 预期不一致。相关启动实现本次未改，失败记录保留；未单独证明这些用例的原版本执行结果，因此不能用“全量回归通过”覆盖它们。

无用户设置的真实官方 SDK 测试返回 `Not logged in`。启用现有用户设置的重试被自动审批拒绝，理由为缺少对此认证来源和出站数据的明确授权；限定 Read/Agent、禁 hooks、预算/合成数据的授权问题已提出，收到答复前不重试。该限制同时阻止用认证模型完成两个原型的 L2。

原始 JSONL、冷读历史、日志、截图均保留在本 worktree `.cat-cafe/tmp/`。不把这些夹具视作运行中的正式安装、生产账号或线上成员已更新。整体迁移保持关闭，现有 native 服务未被替换。
