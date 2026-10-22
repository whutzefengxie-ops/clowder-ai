---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: 12270f95530c39f8f6ea123d1385baa471b8cf72
status: changes-requested
---

# 检查点 12270f955：健康写者互斥通过，首次创建与退出恢复缺失

本地及 GitHub PR #1669 实时 HEAD 为 `12270f95530c39f8f6ea123d1385baa471b8cf72`，PR OPEN。

## 已关闭的具体竞态

在已有可信目录中，正常导入、撤销、getter 刷新 **3/3 pass**。前轮同一提交交错反例 **1/1 pass**：导入方持锁时，竞争撤销明确返回 `Storage lock held by another process`，没有撤销成功的确认，导入方随后正常提交。允许拒绝竞争操作，该具体“已确认撤销被旧提交覆盖”P1 可以关闭；不据此声明所有读取和失败路径都具备严格可串行化语义。

## P1：首次导入在准备目录前就申请锁

位置：`acp-startup-policy-store.ts:148` 与 `acp-startup-policy-storage.ts:512`，目录创建却在之后的 `persistPolicies` 中。

新的 runner HOME 中 `.clowder-ai/acp-policies` 不存在，合法第一次 import 返回：

```text
success=false
Failed to acquire lock: ENOENT .../acp-policies/policies.lock
nativeDirectoryPreparationCalls=0
storageExists=false
```

这不是 Temp 祖先拒绝：原生目录准备根本没有执行。测试中的目录 helper 替身会在调用时创建真实 private protected 叶目录，以验证调用顺序；本例实际没有到达它。已有目录的绿灯无法证明首次使用成功。

应在申请锁前，通过现有原生安全机制准备并验证可信存储位置；既有目录亦应先验证。不要用裸 recursive mkdir、Unix mode 或自动修复既有不可信 ACL 替代该安全边界。避免 store/storage 两处各自拼出独立的权威存储路径。

## P2：持锁进程已退出，残留文件持续阻止策略管理

位置：`acp-startup-policy-storage.ts:507-535`。

当前锁是独占创建的存在性标记，不是随 OS 句柄关闭而解除的持有状态。合成子进程成功 acquire 后自然退出，未执行应用 release；`execFileSync` 返回时可确认子进程已结束、描述符由 OS 回收。但下一次 acquire/revoke 仍失败：

```text
childExited=true
lockFileRemains=true
reacquired.success=false
revoked.success=false: Storage lock held by another process
```

这代表进程在 finally 前退出后的恢复缺口；没有终止任何 runtime 或父进程来测试。当前没有锁所有者/实例身份信息或受控恢复入口，重试不能解决。需选择随所有者退出释放的持锁机制，或能安全确认所有权和存活状态的恢复方式。不能无条件删除任意 EEXIST 锁，也不能用时间到期直接抢走仍在执行的锁。

## 证据

固定源码、脚本与完整日志：`.tmp/review-pr1669-12270f955/`。本轮合计 **6 tests / 4 pass / 2 fail**：normal-mutations 3 pass，write-interleaving 1 pass，lock-lifecycle 2 fail。

```powershell
node .tmp/review-pr1669-12270f955/prepare-checkpoint.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-12270f955/normal-mutations.test.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-12270f955/write-interleaving.test.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-12270f955/lock-lifecycle.test.mjs
```

完整 SHA 的源码仅改模块链接，store/锁/I/O/ACL/原生文件创建与子进程真实执行。Temp 祖先准入明确模拟，叶目录为真实私有目录；首次使用测试中仅模拟安全目录准备职责，记录其是否实际调用。各组均使用独立 runner HOME/合成数据，不接触真实策略、运行配置、历史、生产 Redis 或已有服务；没有原机/普通用户/真实 DSH 成功验收。

## 续办

仍为 changes requested。请把可信目录准备、锁获取/竞争、正常释放、退出恢复与提交失败收敛为一个完整生命周期并自验；新 W2 操作入口必须消费同一受保护 writer，不绕过它直接写清单。

同轮继续既有 W2 受控入口/可信位置、池生命周期、F4、W4/W6 和最终正式验证，完成可做范围再统一回传真实 HEAD。无需等待 reviewer 批准续做；当前不合入、不部署、不关闭 Issue。
