---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: e9d2d4c1e9c4c3287243719099bb008fdffb0609
status: changes-requested
---

# 检查点 e9d2d4c1e：顺序写入与单点回滚修复，撤销准入和提交一致性仍为 P1

本地 HEAD 与 GitHub PR #1669 实时 HEAD 均为 `e9d2d4c1e9c4c3287243719099bb008fdffb0609`，PR OPEN。源码增量为变更入口 reload，以及最终 rename 失败时恢复 backup。没有改 getter / `isPolicyActive` 的读路径，没有提交版本比较或 writer 排他保护。

## 本轮通过的具体反例

- 另一进程先完成撤销，此后宿主再 import 不相关策略：不再把旧记录写回，该顺序反例通过。
- 最终 `tmp → manifest` rename 单次注入 EACCES，随后恢复操作可执行：原 manifest 被恢复，独立进程仍能读此前确认成功的策略，失败的新策略不活跃。该具体失败恢复反例通过。

以上分别关闭对应具体失败路径；没有因此证明所有故障恢复、进程中断或写入交错均已覆盖。

## P1-1：外部撤销后，下一次 warm acquire 仍成功

位置：`acp-startup-policy-store.ts:186-212`，与 pool 对 `isPolicyActive` 的消费。

`reloadFromStorage` 只被 import/revoke 调用。纯读取的 `getActivePolicies/getPolicy/isPolicyActive` 仍返回旧 Map；正常 warm acquire 不会先执行策略变更操作。因此前轮的同一反例仍失败：

```text
另一所有者进程 revoke.success=true
新进程确认 fresh.active=false
旧宿主 retainedInHost=true，warm=true（同一 client 再次获得租约）
```

必须保证撤销成功后，下一个准入读取观察权威状态并拒绝新租约；不要要求用户再执行一次 import/revoke 才刷新，也不要只在创建 service 的时候检查。

## P1-2：reload 与提交之间的外部撤销仍会被覆盖

位置：`acp-startup-policy-store.ts` 的 reload → 构建 Map → `syncToStorage`，以及 storage 的无版本替换提交。

用受控调度把另一个真实进程的撤销安排在导入方 reload 之后、其 native tmp 创建之前。两个操作均使用真实 store/受保护文件：

1. A 活跃，导入方开始导入不相关的 B，已 reload A 并构造待写集合 A+B。
2. 调度暂停导入方；另一进程撤销 A 返回成功。再开进程确认 A 不活跃。
3. 导入方继续，成功提交旧集合 A+B；再开进程确认 A 又活跃。

```text
externalRevocation.success=true
afterRevocation.active=false
imported.success=true
afterCommit.active=true
```

不存在权限校验失败或创建 API 故障；丢失撤销来自提交没有识别已变更的权威状态。`reload` 本身不构成“乐观并发控制”，因为没有版本比较和冲突拒绝，也没有强制单 writer 的边界。需要在完整读改写事务上保证一致性，使较旧提案不能覆盖已经确认的新状态。可以按本次功能选定一个受控 writer 和相应刷新/提交机制，不要求扩建通用多 writer 系统。

受控调度仅用于稳定复现合法跨进程时序，没有改写被测策略集合或产品源码。文件创建、原生安全验证、撤销、提交及独立进程回读均真实执行。

## 可重跑证据

源码快照来自完整 SHA，只改模块链接。脚本和日志在 `.tmp/review-pr1669-e9d2d4c1e/`。

```powershell
node .tmp/review-pr1669-e9d2d4c1e/prepare-checkpoint.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-e9d2d4c1e/policy-freshness.test.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-e9d2d4c1e/storage-recovery.test.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-e9d2d4c1e/write-interleaving.test.mjs
```

共 **4 tests / 2 pass / 2 fail**：freshness 1 pass/1 fail，recovery 1 pass，interleaving 1 fail。没有重跑无关全仓检查。

各 runner 使用独立临时 HOME 和合成策略；叶目录/文件 ACL 与 I/O 真实，Temp 祖先准入明确模拟，pool client 为合成对象，rename 失败和跨进程调度分别按上文注入。不是原机、普通用户或真实 DSH 成功验收。没有修改运行配置、真实用户策略库、历史或生产数据。

## 续办

仍为 changes requested。请同轮处理读取准入与完整读改写提交两个边界，先在当前源码/新构建上观察上述 RED→GREEN，再统一回传，不只增加另一个局部 reload 后留给 reviewer 首次验证。

继续已授权的 W2 实际受控入口/可信存储、池生命周期三项、F4、W4/W6 与正式验证；这些仍未关闭，不因本轮保存检查点停止实施或重新请求优先级批准。若拆提交可直接推进后续可做部分。当前不合入、不部署、不关闭 Issue；原机未测项仍保留。
