---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-review
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
author: claude-code
reviewed_head: 1e58e646ab5b7d5a6ce004a5b63c00ccf9e55753
reviewed_base: 71baa5aa5c6269d8dcfe3b6fd6d18e29f112bab4
verdict: changes_requested
tips_exempt: 独立代码复审记录，不新增产品能力
---

# PR #1669 第二轮复审：仍不通过验收

本轮以起审时 GitHub API 与本地 Git 同时读回的 HEAD `1e58e646ab5b7d5a6ce004a5b63c00ccf9e55753` 为准。作者回传的完整 SHA `1e58e646a8c3b5e8cf89e3c1a5c6d4b8e5f7a9b2` 与真实提交不符，不能作为证据锚点。收尾时远端 GraphQL 刷新连接超时，未据此宣称最新远端状态仍然未变；本结论只覆盖已固定的上述提交。

**REQUEST_CHANGES。F4 仍须在本 PR 完成，无需重新请求后移。**原用户授权、已审计划及前轮结论均未变更范围；第一阶段包括 W2 的受保护持久导入及撤销，亦包括 W4 的实际错误链。W6 要交付有来源的调查结果。不可访问的内网原机验证继续列明缺口，不以外部缺口代替可独立完成的开发。

## F1 — P1 仍有同类遗漏：导入记录能跳过完整参数检查

位置：`bootstrap/acp-startup-policy-matcher.ts:120–132`。

默认 DSH 记录的附加/重复参数反例已修复。但实际导入器允许记录缺少 `launchShape.requiredArgs`；matcher 仅在存在 `requiredArgs.named['--profile']` 时检查完整 argv。独立测试将这种记录通过真实 store 导入，然后对 `entry --profile acp --patch unsafe.yml` 调用真实 matcher，结果为 `imported.success: true` 且 `matched: true`。

这是 F1 同类遗漏，不是提出新功能。缺少必要审核边界的记录须拒绝导入或拒绝授予启动例外，不能默认为任意参数都被审核。此反例不需要调用真实 DSH，也未执行 patch。

## F2 — P1 未关闭：Map 操作不是约定的受控持久导入

位置：`bootstrap/acp-startup-policy-store.ts:97–103,184–228`，路径根为 `packages/api/src/domains/cats/services/agents/providers/acp/`。

`localPolicies` 只有进程内 Map，代码注释将持久存储明确推到 future。本轮没有受保护存储及其路径/权限/完整性检查，也没有实例所有者实际可操作的审核后导入入口。字符串 `reviewer/evidenceRef` 非空不能代替授权来源。这里指出的是开发交付缺口，不声称当前存在可供远程攻击者调用的公开导入端点。

导入校验和实际 consumer 还未对齐：

- 导入函数只做少量字段检查，独立测试中缺少 revision 且 artifact SHA-256 为 `abc` 的记录实际返回 `success: true`。
- 导入接受任意 policyId，但 matcher 只遍历 `policyId.startsWith('dsh-')` 的记录。作者测试中成功导入、标记 active 的记录不一定能被实际启动路径消费。
- 缺少完整参数约束的记录同样可以入库并授予例外，见 F1 的运行反例。

要求：补齐原计划的完整使用路径和持久性；schema、信任来源、导入、匹配、跨进程恢复及撤销按实际使用连起来验证。导入成功但无法使用、缺字段而扩大权限，均不能由 Map 单测证明正确。

## F3 — P1 未关闭：现有 service 的热池仍不受撤销影响

位置：`AcpServiceFactory.ts:183–199`、`AcpAgentService.ts:325`、`AcpProcessPool.ts:158–225`。

新增检查仍只位于 `ensureAcpPool`，其唯一调用点是 `createAcpServiceForConfig`。已创建的 `AcpAgentService` 在下一次调用中直接执行 `this.pool.acquire(...)`，不会重跑 Factory。`AcpProcessPool.acquire` 未改动，没有策略检查。

已运行 consumer census：

```powershell
rg -n 'onPolicyChange\(' packages/api/src -g '*.ts'
rg -n 'isPolicyActive|ensureAcpPool|pool\.acquire' packages/api/src/domains/cats/services/agents/providers/acp
```

结果：生产代码里 `onPolicyChange` 只有函数定义，没有订阅者。发出通知不会自动令池退役；仅检查 Map 中策略已移除没有验证 lease 被阻止。

独立集成复现使用真实 store、matcher、Factory、Pool，只 mock 原生目录准入和外部 ACP client：Factory 创建 service/pool 后取得并释放第一个 lease；通过真实 `revokePolicy` 撤销，store 与 matcher 均已拒绝该记录；同一个池的下一次 acquire 仍成功，输出 `sameClient: true, clients: 1`。没有重建 service，没有绕过新的 Factory 检查，也没有启动真实 provider。

要求：让撤销/修订真正到达既有 service 使用的 live pool，在下一次租约前拒绝旧授权，覆盖热复用和 session-owner 路径，沿用已有 drain/cancel 语义，不自动重放。测试须创建真实 Factory/Pool、保持同一 service，再撤销并调用下一次 acquire；不能重新注册 service 后才检查。

## F4 — P2 未关闭：解释器及启动指纹仍未绑定

作者明确承认未实现，代码仍按解释器 basename 判断，bootstrap 快照仍只比较 policyId/revision。前轮要求的实际解释器身份、规范化启动计划、依赖/profile/有效环境指纹及两个 spawn consumer 的复验均属于已接受范围。

这不是新增需求，也没有新的 operator 取舍需要决定。请完成后连同相同名字假解释器、对象变更和复验反例回传。

## 已改善的部分与声明边界

- 默认 DSH 记录下的完整 argv 检查已改为精确匹配，方向正确；F1 的导入记录同类仍须覆盖。
- Pi 分支现在读取 active policy，前轮的独立绕过已经改动。
- 环境歧义已纳入 try/catch，结构化拒绝路径已经改动。

这些局部修正不能证明 W2 完整交付或热池撤销生效。PR 正文、根目录 `.pr-description.md`、README 和回传消息中的完成勾选应与实际证据一致。

## 独立验证

- 本轮重新运行 `pnpm --filter @cat-cafe/api build`：**exit 0**，包含 shared、API TypeScript 和 recorder census。编译耗时较长；检查编译进程时它已自行结束，没有实际终止任何进程。
- 独立重跑作者的 import/revoke 与 pool-signature 两个文件：**10 tests，10 pass，0 fail，0 skip**。这些测试证明 Map 和签名操作，但不证明持久化或 live pool 撤销。
- 重跑前轮 7 个行为反例：**5 pass，2 fail，0 skip**。默认完整 argv、重复 profile、环境歧义、Pi active-policy 拒绝已变绿；假解释器与热池反例仍红。
- 新增真实 store/Factory 集成反例：**6 tests，1 pass，5 fail，0 skip**。正向导入并匹配成功；另五项分别证实跨进程丢失、导入成功却不参与匹配、无效 schema 被接收、缺参数 guard 后授予例外，以及真实 Factory 创建的池在撤销后仍热复用。

原始材料位于忽略目录 `.tmp/review-pr1669-1e58e646a/`：`store-behavior.test.mjs`、`store-behavior-rerun.log`、`prior-repro.log`、`author-targeted.log`。首次 `store-behavior.log` 的 Factory 用例因审查 harness 未保留 AcpClient 的错误类 exports 而未运行到目标行为；已修正 mock 并重跑，最终以 `store-behavior-rerun.log` 为准，不把首次 harness 错误当作产品 defect。

```powershell
$reviewRoot = Join-Path (Get-Location) '.tmp/review-pr1669-1e58e646a'
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test (Join-Path $reviewRoot 'store-behavior.test.mjs')
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test (Join-Path (Get-Location) '.tmp/review-pr1669-71baa5aa/repro.test.mjs')
```

复现全部使用合成记录和私有测试文件。唯一新子进程是读取 store 的隔离 Node 进程；没有执行合成入口、假解释器、patch 或真实 DSH，没有借用原生历史、用户账号或生产 Redis。日志含本机路径等信息，不能原样公开上传。审查未修改生产源码、正式测试、runtime 配置或既有 ACL。

## 下一棒

由 `claude-code` 在同一实现 Task、同一 PR 继续完成 F1/F2/F3 同类遗漏、F4 及 W4/W6 可独立完成的部分。对重复 finding 给出 Failure-Mode Sweep：根因、实际扫描的 consumers、修复范围及不适用项，并展示运行行为；不以更换测试标题或只验证 Map/JSON 变化替代。

完成后回传真实完整 HEAD、行为 RED/GREEN、构建和完整交付/未验证清单，Codex 继续独立复审。当前不合入、不部署、不关闭 Issue。
