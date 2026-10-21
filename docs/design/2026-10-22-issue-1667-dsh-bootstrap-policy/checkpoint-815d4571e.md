---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: 815d4571ecb5d7fc92e8f08828d84454449ff646
status: incomplete
tips_exempt: 实施中途的精确提交诊断与续办，不新增审批或等待环节
---

# 检查点 815d4571e：ESM 恢复，安全与生命周期仍待完成

本地 HEAD 与 GitHub PR #1669 起审时均为 `815d4571ecb5d7fc92e8f08828d84454449ff646`，PR 为 OPEN。只对这一不可变提交下结论；作者正在继续修改的工作区不属于本检查点。原授权与交付范围不变，继续 F4、W4/W6 和最终验证，不需要询问是否同意续做。此前未关闭事项不会因检查点提交而自动关闭。

## 对本次三个问题的直接回答

1. `728c55052aba82426cb3d9a16373a293cedf33f0` 中改用 ESM `renameSync/unlinkSync` 正确，真实存储模块的有效记录写入和重读已通过独立正向用例。它只解决 `require` 未定义，未解决上一检查点其余存储问题。测试新增的 `named: { '--mode': 'test' }` 还直接暴露了输入约束与 matcher 消费不一致，不能作为 F1 已完成的证据。
2. `b472108c9e68a9beed693fe7c0fe3c163066b8e7` 的两个恢复点检查只覆盖部分路径。初始化期间关闭后，现在确实拒绝租约并关闭合成 client，但计数失衡；策略读取后的退役以及初始化期间的撤销仍能放出租约。
3. 继续原 Step 3 是既有授权内的工作，不是新的待批准选择。修复下面同根因路径后，继续全部可做范围，再集中回传精确 HEAD。

## P1：原存储与参数约束反例仍然成立

存储摘要仍使用 `JSON.stringify(policy, Object.keys(policy).sort())`，嵌套安全字段不在摘要里。实际 writer 生成有效 manifest 后，测试在不更新摘要的情况下修改 artifact SHA-256、`--profile` 和 noPatch，loader 仍返回该策略。用真实 writer 生成 `schemaVersion: 99` 的记录，loader 也仍接受它。

store 仍把 loader 返回对象直接加入 active Map；写入失败仍由 `syncToStorage()` 记录日志并吞掉，import/revoke 无法向调用者证明持久状态成功提交。两次 rename 之间的中断、恢复、跨进程变更到达既有 host 的路径，以及 Windows owner/DACL/reparse/可替换祖先校验，本提交都未修复。该部分延续 `checkpoint-ecc50dca.md` 的证据；没有把本次普通正向写盘通过扩大成受保护持久库验收。

本次另执行实际 store + matcher：导入 `requiredArgs.named = { '--mode': 'test' }` 后，以 `node entry --profile acp --patch unsafe.yml` 匹配。结果为 `imported.success: true`、`matched: true`。因此“所有非 Pi 策略的 named 非空”仍不等于完整参数约束。验证应按实际支持的启动形态检查必要字段、拒绝未支持字段，并让 matcher 消费同一份规则。

## P1：退役和撤销没有覆盖所有租约发布路径

### 策略读取后的热池复用

`AcpProcessPool.acquire()` 在动态导入 store 前检查 closed/retiring，导入后只复查 closed。独立用例先保留一份 multiplexed lease，再启动第二次 acquire，在它暂停于 import 时调用 `retireWhenIdle()`。恢复后第二次 acquire 仍取得同一 client 的热租约。原 lease 可以正常完成，但退役后必须停止接纳新工作。

### 初始化期间撤销

独立用例用真实 store 导入合成策略，让池在 `client.initialize()` 暂停，撤销该策略后再放行初始化。此时 `isPolicyActive(id, 1) === false`，acquire 仍返回新 lease。await 恢复点仅检查 closed/retiring，没有复查导致本次准入成立的策略状态。

应统一检查每个租约发布点所依赖的当前生命周期与授权状态，覆盖 warm、session owner、pending/coalesced 和 cold spawn。不要把更多分散的布尔检查或签名字符串测试当成完整路径证明。

## P2：关闭期间初始化的计数清理不平衡

`closeAll()` 在初始化尚未结束时将 metrics 清零；后续 `doSpawn()` 仍发布 entry 并计 active，新增的 `retireEntry()` 再减 live。独立用例的结果为拒绝租约、client 被关闭，但 `liveProcessCount: -1`。清理应让 reservation、发布和关闭由明确的单次生命周期归属处理，既不泄漏也不重复减计数。

## 独立行为证据

测试只在 `with-test-home.mjs` 创建的隔离 HOME 中执行；实际策略 store/storage/matcher/pool 来自上述 Git SHA。prepare 脚本通过 `git show <SHA>:<path>` 提取这四个模块，使用 Node 原生 TypeScript 去类型运行，只重写模块 URL；其他未变依赖链接已有 dist。池 client 为合成对象，不启动真实外部进程。

| 用例 | 结果 |
| --- | --- |
| ESM 有效记录写入与重读 | PASS |
| 嵌套 artifact/启动约束篡改应被拒绝 | FAIL，仍加载 1 条 |
| 无效 schema 重载应被拒绝 | FAIL，加载 schema 99 |
| 不受支持的 named 字段不能绕过额外 argv | FAIL，带 --patch 仍 matched |
| 初始化期间关闭后拒绝租约且计数归零 | FAIL，拒绝及关闭成立但 live=-1 |
| 策略 import 期间退役后拒绝热租约 | FAIL，仍复用同一 client |
| 初始化期间撤销后拒绝新租约 | FAIL，仍发出租约 |

终态：**7 tests，1 pass，6 fail，0 cancelled，0 skip，exit 1**。失败是安全预期的 RED，不是 Temp ACL 环境失败。

```powershell
node .tmp/review-pr1669-815d4571e/prepare-source.mjs
node packages/api/scripts/with-test-home.mjs node --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-815d4571e/checkpoint.test.mjs
```

材料位于忽略目录 `.tmp/review-pr1669-815d4571e/`。这不是本 SHA 的完整 TypeScript build/lint 或原机验收。本轮未重跑构建、未改作者实现/正式测试、未访问真实策略库/历史/账号/生产 Redis、未更改 Windows ACL。author 的 signature 测试不能验证 acquire 的这些执行顺序。

## 继续实施及交付记录

1. 沿正在进行的原任务一并关闭上述根因，再完成 F4 的实际解释器身份与完整 admission 快照、W4 unavailable 消费链、W6 源码调查和最终验证。给任意传入 exe 计算当前哈希并不自动产生信任；不要为了鉴别而运行未受信任的候选解释器。应将经过审核/可信解析得到的实际对象与启动闭包绑定，并贯穿池和两个 spawn consumer 的复验。
2. `progress-b472108c9.md` 的 “Steps 1-4 完成” 与正文剩余项不一致；`reviewed_head` 填入了不存在的 `b472108c9d1f4a8e8f5f5e5e5e5e5e5e5e5e5e5e`。修订为真实提交与已验证范围，不补造 SHA，不用作者单测或 commit 标题取代行为验收。
3. 中途保存恢复点后继续工作；不再等待 reviewer 批准同一范围。全部可做范围完成，或出现可复现的具体外部阻塞，再回传。真实内网机器/普通用户/连续性等原机缺口继续如实保留，不能以本地合成测试替代。

当前未通过整项验收，不进入合入/部署或 Issue 关闭。
