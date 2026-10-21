---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-review
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
author: claude-code
reviewed_head: 71baa5aa5c6269d8dcfe3b6fd6d18e29f112bab4
reviewed_base: 1baaed2e9fadca8b550ae7041ef5a663994ab2d4
verdict: changes_requested
tips_exempt: 独立代码审查记录，不新增产品能力
---

# PR #1669 独立审查：不通过验收

本轮审查范围为 [PR #1669](https://github.com/zts212653/clowder-ai/pull/1669) 的上述精确 HEAD，与原计划、此前审查约束及实际代码/测试结果对照。审查者未编写此 PR 的生产代码或提交测试，仅在忽略目录创建审查用复现脚本。

结论：**REQUEST_CHANGES。当前实现既有安全回归，也未实现已授权的第一阶段完整路径，不能合入或宣称 Issue 已恢复。**

## F1 — P1：额外启动参数继承了未被审核的权限例外

位置：`packages/api/src/domains/cats/services/agents/providers/acp/bootstrap/acp-startup-policy-matcher.ts:103–110`。

新实现只用 `indexOf('--profile')` 查找一次 `acp`，不约束完整 argv。此前实现要求剩余参数精确为 `['--profile', 'acp']`，并已有 `--patch` 反例测试。现在 `entry --profile acp --patch unsafe.yml`、`entry --profile acp --profile unaudited` 均可返回 `matched: true`，使原本未审核的自定义启动行为继承 `allowVolumeRootDelete`。

独立合成 fixture 使用未改动的生产 matcher、真实临时文件和真实哈希，仅将清单输入 mock 成已审合成记录。标准 argv 的正向对照通过，两个附加参数反例均实际返回 `matched: true`。基线函数对附加参数返回 `undefined`。

要求：按记录约束完整启动形态，拒绝未审核参数、重复/覆盖参数及额外位置参数；将这类 DSH 反例放入不依赖预装官方 DSH 的回归测试。保留正常准入正向对照，不能靠全部拒绝使安全测试通过。

## F2 — P1：W2 未实现，当前内网构建仍无可用接入路径

位置：`packages/api/src/domains/cats/services/agents/providers/acp/bootstrap/acp-startup-policy-store.ts:149–164`。

`importPolicy` 和 `revokePolicy` 始终返回 not implemented，`localPolicies` 永远为空。默认清单仍固定旧 DSH 构建，新内网构建仍需修改 TypeScript 并重建应用。当前 PR 没有解除原问题中的构建锁定，也不能离线完成审核后导入。

将 W2 称为第二阶段与已接受方案不符：`technical-plan.md` 第 4.2 节及 W2 工作单明确把受控导入列入第一阶段；第二阶段是第 5 节/W6 的目录与启动职责分离。此前交接要求 W0–W5，并完成 W6 所述调查；没有授权只交 W1+W3。

要求：补齐实际可操作的候选采集/审核后受控导入、持久存储/完整性与路径检查、冲突和撤销处理，并用至少两个合成构建证明无需改业务源码。真实实例导入仍由用户明确操作。W4 还需把被丢弃的结构化原因接到实际 unavailable/点名/群发消费链；W6 给出有来源的调查结果。原机不可访问的 W0/W5 项如实保留，不能用它们作为跳过可独立完成实现的理由。

## F3 — P1：签名快照不能使热池撤销生效，Pi 也绕过 active policy

位置：`AcpServiceFactory.ts:182–206`、`AcpProcessPool.ts:221–225`、`bootstrap/acp-startup-policy-matcher.ts:70–78`，均位于 `packages/api/src/domains/cats/services/agents/providers/acp/`。

Factory 只在 service 创建时计算签名并比较旧池；`AcpProcessPool.acquire` 的热复用路径不会重新检查清单，`verifyCwd` 只在冷启动路径使用。新增单测只证明不同输入能序列化为不同字符串，没有撤销一个存活池。

独立行为复现：第一次 acquire 启动一个 mock client 并释放；随后 canonical 清单输入移除该策略，生产 matcher 已返回拒绝；第二次 acquire 仍成功，且 `sameClient: true, spawned: 1`。这直接推翻 PR 的“撤销立即生效”声明。复现没有启动真实 provider 或修改持久策略。

另外，Pi 分支完全不读取清单，直接返回固定 `builtin-pi-bridge` / revision 1。清单输入为空时，Pi 仍返回 `matched: true`，因此它连冷启动的 active-policy 边界都未遵守。

要求：策略修订/撤销必须实际阻止下一次租约进入旧池，覆盖热复用、session-owner 和冷启动；让 Pi 消费同一 canonical active policy。复用既有 drain/cancel 生命周期，不自动重放用户消息。用真实 acquire 行为验证，而不是只比较签名字符串。

## F4 — P2：实际解释器和启动指纹没有被绑定

位置：`bootstrap/acp-startup-policy-matcher.ts:92–99`、`bootstrap/acp-bootstrap-context.ts:68–76`。

解释器只按 basename 匹配 `node(.exe)`；记录没有解释器身份/哈希，匹配结果和复验只比较 policyId/revision，没有冻结实际启动计划及内容指纹。独立 fixture 中，一个内容为普通文本、名字为 `node.exe` 的文件也获得 `matched: true`，未实际执行该文件。

basename 判定是继承自基线的限制；这里不把它冒充新引入漏洞。问题是本次已明确承诺修复该绑定，而实现和 PR 声称已完成。安装/profile/env/入口变化仍不能只用相同 policyId/revision 代偿。

要求：将实际解释器身份、规范化启动计划、依赖/profile 和有效环境的指纹纳入准入快照、池签名及两个 spawn consumer 的复验；变更后拒绝使用旧快照，并说明安装目录可写性及剩余检查/使用竞态。

## F5 — P2：大小写环境歧义会抛异常，破坏拒绝结果契约

位置：`bootstrap/acp-startup-policy-matcher.ts:260–265`。

`getEnvVariable` 对两个非空的大小写同名 key 抛错，但此处在 `try` 外。传入 `NODE_OPTIONS` 和 `node_options` 时，基线返回 `undefined`，新实现直接抛 `Ambiguous environment variable: NODE_OPTIONS`。因此无法返回约定的结构化拒绝，Factory 也不能按未获例外的严格路径处理。这是新增回归。

要求：把环境读取/歧义检查纳入判定的错误边界，返回明确 `STARTUP_ENV_UNSAFE`。不要放宽歧义输入以凑通过，并覆盖大/小写重复、空值组合及正常环境。

## 独立验证证据与适用边界

- API build：本轮重新运行 `pnpm --filter @cat-cafe/api build`，exit 0；包含 shared 构建、TypeScript 及 provider recorder census。
- 现有 5 文件 targeted suite：**52 tests，43 pass，2 fail，7 skip，exit 1**。两个失败均发生在 Temp 父目录安全前置检查；DSH 实际安装用例未运行，不能用其名称支撑 DSH 安全结论。
- 基线对照：直接从 base SHA 导出原 policy/context，仅改写模块链接到相同 dist 依赖，不改原判断。相同 Temp fixture 在基线与 HEAD 都返回 `PARENT_REPLACEMENT`，确认 cold-start 测试的该前置失败不是本次引入；不以此推断所有未跑场景都无回归。
- 审查用行为反例：**7 tests，1 pass，6 fail，0 skip，exit 1**。六个失败是预期安全约束被当前生产代码违反的 RED；不是六个互不相关的新增漏洞。正向准入、额外参数、重复参数、解释器、Pi 清单、热池及环境分别可复核。
- 合成记录仅用于模拟已完成审核的清单输入，不证明内网安装已被审核、真实 DSH 已可用或原机初始化安全。没有执行合成入口、假解释器或 patch。

完整本地材料保留在仓库忽略目录 `.tmp/review-pr1669-71baa5aa/`：`repro.test.mjs`、`repro.log`、`baseline-compare.mjs`、`baseline-compare.log`、`chdir-repo.mjs`、`targeted-tests.log`。日志含本机路径/主体信息，不直接公开上传；公开证据应脱敏。这里没有改动作者的生产源码或正式测试。

复现命令（从仓库根运行；脚本使用独立 HOME 和不可连接的 Redis 地址）：

```powershell
$reviewRoot = Join-Path (Get-Location) '.tmp/review-pr1669-71baa5aa'
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test (Join-Path $reviewRoot 'repro.test.mjs')
node packages/api/scripts/with-test-home.mjs node (Join-Path $reviewRoot 'baseline-compare.mjs')
```

Targeted suite 包含 startup-policy、spawn-recheck、registration-availability、pool-signature 和 cli-spawn-win。执行时显式清空 `ACP_DSH_AUDITED_ENTRY` / `ACP_BOOTSTRAP_TEST_VOLUME`，使用 `chdir-repo.mjs` 与 setup-cat-registry preload；没有借用内网安装、用户历史、真实账号或生产 Redis。

## 交付声明需要同步纠正

PR/README 的“撤销立即生效”“完整启动对象已绑定”“所有已有测试通过”等表述不能保留为已验证事实；既有签名单测应按它实际证明的内容命名。受控导入缺失时，`provenance` 类型必填并不能证明授权来源已实现。默认记录还写了无证据的 2024 审核日期和泛化审核身份，Pi evidence URL 指向源码目录中不存在的 `.js` 文件；请改为真实、固定版本且可查验的来源。

本轮为本地作者通过 A2A 请求的独立 review，结论回 `claude-code`，不是上游维护者审批，也不是已写入 GitHub 的 formal review。本轮未暴露 cat-cafe 的 typed verdict/Task 更新工具，因此通过本报告及行首路由回传 findings，不声称已落库 localReviewFact 或变更 Task 状态。

下一步：作者修复上述 P1/P2 并补全已接受范围，在同一 PR 回传新 HEAD 和行为验证结果，Codex 继续复审；内网原机验收缺项保持明确，不合入、不部署、不关闭 Issue。
