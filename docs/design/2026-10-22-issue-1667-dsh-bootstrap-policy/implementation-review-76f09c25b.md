---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-review
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
author: claude-code
reviewed_head: 76f09c25bf9dcc87a1dc055ab3fb7edbdfa77464
reviewed_base: 1e58e646ab5b7d5a6ce004a5b63c00ccf9e55753
verdict: changes_requested
tips_exempt: 独立复审与实施续办记录，不新增产品能力
---

# PR #1669 第三轮复审及续办记录

**REQUEST_CHANGES；继续原范围，不先合入增量。**起审时本地 Git 与 GitHub API 均确认本轮精确 HEAD 为上述提交。F2、F4、W4 与 W6 所述调查仍在用户已接受范围内，没有新的范围决策需要 operator 重答。当前改动作为进度检查点保留，不能标作第一阶段交付完成。

## F1 — P1 仍可通过 policyId 绕过完整参数检查

位置：`bootstrap/acp-startup-policy-store.ts:215–222` 与 `bootstrap/acp-startup-policy-matcher.ts:297–301`，路径根为 `packages/api/src/domains/cats/services/agents/providers/acp/`。

导入器只对 `policyId.startsWith('dsh-')` 的记录要求参数约束，匹配器却已扩大到所有非 Pi 记录。独立反例使用有效文件/哈希、同一安装和相同的缺参数约束记录，将 ID 换成 `review-without-prefix-and-argv-guard`，真实 store 返回 `success: true`；真实 matcher 对额外 `--patch` 返回 `matched: true`。

这是前两轮同一失败模式的再次出现：校验与实际 consumer 集合不一致。要求按照被消费的启动形态建立共同 invariant，不再凭 policyId 前缀选择是否执行安全检查。必须展示“只改 ID 不会扩大权限”的反例和正常准入对照。

## F2 — P1 持久导入与授权使用路径仍未实现

当前仍为进程内 Map；独立新进程读取成功导入的记录，结果依然为 `false`。受保护存储、明确的 owner 维护入口、加载/完整性验证和跨进程恢复均未交付。作者已承认未完成，不用重复的增删 Map 测试证明该结果。

导入 schema 另有 P2 缺口：`acp-startup-policy-store.ts:209` 接受长度至少 32 的十六进制值，独立测试中的 32 字符摘要实际返回 `success: true`。SHA-256 是 32 字节、64 个十六进制字符，应检查准确格式及相关字段，不能把修改 fixture 成“当前实现接受的值”当作格式验证。

原计划没有要求本轮建设通用证书平台，亦未将签名/MAC 规定为所有本地记录的必要前置。可沿受保护私有目录、严格数据记录、原子替换、受控维护命令和明确的重新加载/撤销机制实现；仍须验证目录与文件替换边界、来源与缓存失效。不得自动扫描后授信，不得在本轮替用户导入真实策略。

## F3 的正常撤销场景通过；新增 P2 生命周期竞态待修

本轮使用真实 Factory 创建真实 Pool，仅 mock 原生目录准入与外部 ACP client。导入并取得第一个 lease，释放后通过真实 store 撤销，再对同一池 acquire：已经正确拒绝，原正常热复用缺口的这个场景变绿。

新问题位置：`AcpProcessPool.ts:163–182`。`closed/retiring` 只在 `await import(...)` 之前检查。独立测试先调用 `acquire`，在该 await 暂停期间执行 `closeAll`，恢复后仍创建 client 并成功返回 lease，输出 `leased: true, initialized: 1`。

要求：关闭/退役边界不能被新的异步检查穿透。检查必须在实际准入前仍有效；可消除不必要的异步间隙，或在恢复后重新验证相应状态。覆盖同一类 close/retire、普通热复用和 session-owner 路径。测试中的 client 为假对象，没有启动真实进程。

## F4 — P2 解释器及启动指纹仍未实现

本轮源码复现中，普通文本文件命名为 `node.exe` 后依然获得 `matched: true`，未实际执行该文件。实际解释器、规范化启动计划、依赖/profile/有效环境的快照及指纹、池绑定与两个真实 spawn consumer 的复验仍需完成。此项沿用原计划，不改成后续 PR。

## 定向验证及证据限制

本轮直接从 `git show <reviewed_head>:<path>` 导出修改的四个模块（Store、Matcher、Factory、Pool），仅重写模块链接与 import.meta URL 以接入已有未变化的 dist 依赖，使用 Node 24 的原生 TypeScript 类型擦除执行。它验证本提交的运行逻辑，**不替代本 HEAD 的 TypeScript build、lint、原机或安装包验收**。本轮没有重跑全量构建，不把作者尚未结束的构建算作成功。

最终用例 **10 tests，5 pass，5 fail，0 skip，exit 1**：

| 行为 | 结果 |
| --- | --- |
| 正常合成记录导入后被真实 matcher 使用 | PASS |
| 非前缀 ID 的有效记录可被使用 | PASS |
| 缺失 revision 被拒绝 | PASS |
| dsh- ID 缺参数约束被拒绝 | PASS |
| 真实 Factory/Pool 在撤销后拒绝下一租约 | PASS |
| 成功导入跨进程保留 | FAIL：记录丢失 |
| 仅更换 ID 不能绕过完整参数校验 | FAIL：额外 patch 获准 |
| 32 字符摘要应被拒绝 | FAIL：入库成功 |
| 同名假解释器应被拒绝 | FAIL：匹配成功 |
| await 期间关闭池后不得再创建 client/lease | FAIL：仍创建并发出租约 |

材料位于忽略目录 `.tmp/review-pr1669-76f09c25b/`：`prepare-source.mjs`、`delta-cases.mjs`、`source-modules.json`、`source/`、`source-behavior.test.mjs`、`source-behavior-final.log`。首个 9 用例日志 `source-behavior.log` 是加入本轮解释器反例前的结果，最终以 10 用例日志为准。日志含本机路径等信息，不原样公开上传。

```powershell
node .tmp/review-pr1669-76f09c25b/prepare-source.mjs
$testFile = Join-Path (Get-Location) '.tmp/review-pr1669-76f09c25b/source-behavior.test.mjs'
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test $testFile
```

只有隔离 Node 子进程和假 ACP client；没有模型调用、真实 DSH/profile/历史访问、真实策略导入、生产 Redis、现有 ACL 修改或 runtime 操作。审查未修改生产代码或正式测试。

## 给 Claude 的续办顺序

1. **先收敛记录与消费 invariant。**所有被 matcher 消费的记录共用同一完整 schema/启动形态边界；检查准确摘要格式、revision 与来源字段、未知/缺失约束、冲突和记录不可变性。复跑本轮换 ID 反例，给出 Failure-Mode Sweep（pattern / scanned / fixed / N/A）。
2. **完成 W2 实物路径。**候选采集仍只生成待审数据；实现 owner 明确操作的维护入口、受保护持久 JSON、原子更新及撤销/恢复，使用独立 fixture 展示两个合成构建、跨进程读回、损坏/不可信路径拒绝。持久记录不可在项目 cwd 或任意环境搜索中自动取得授信。
3. **完成 F4 的单一 admission 快照。**由现有有效 spawn plan 形成实际解释器/内容、入口与依赖、profile、有效环境的指纹，贯穿池签名及两个 spawn 前复验；不另建一套安装发现顺序，不在诊断中暴露 secret。
4. **补齐生命周期边界。**保留本轮正常撤销的绿色用例，修复关闭/退役跨 await 竞态；覆盖更新、撤销、热复用、session-owner 及冷启动，沿用 drain/cancel，不重放用户消息。
5. **完成 W4 与 W6 调查。**W4 让具体拒绝原因到达已有 AgentRegistry/unavailable/点名/群发消费链，已能工作的路径给实际证据，不造第二份 available 状态。W6 交付基于源码的支持/不支持/未知结论；不要求本 PR 实现尚未证明存在的 DSH CLI 开关或整套协议迁移。
6. **再统一验证与回传。**可独立完成的范围齐备后，集中运行受影响测试与一次所需构建/检查，等待命令 terminal，回传真实 HEAD、行为 RED/GREEN 和真实未验证项。现有内网原机/普通用户/连续性缺口必须保留，不能据此关闭 Issue。

上下文有限时，以本文件、原 technical-plan.md、plan-review.md 和当前实现 Task 作为恢复锚点，保留已验证/未验证及下一条可执行动作后继续原任务。无需重建 Task、另开 feature 或再次询问是否后移已接受范围。真正的外部阻塞给出具体缺失材料、证据与仍可继续的部分；“复杂度/本轮上下文不足”本身不改变交付范围。

下一棒仍是 `claude-code` 完成实现；Codex 保留原托付及后续独立验收责任。当前不进入 merge gate、不部署、不关闭 Issue。
