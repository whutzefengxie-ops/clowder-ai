---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: 8086627a24099527da2eeea3a137264a0eb3aa10
status: changes-requested
---

# 检查点 8086627a2：正常变更恢复，提交竞态仍未关闭

本地及 GitHub PR #1669 实时 HEAD 为 `8086627a24099527da2eeea3a137264a0eb3aa10`，PR OPEN。本轮仅提取固定源码和执行隔离测试，没有修改产品代码或正式测试。

## 已通过

正常首次导入、已有策略撤销、getter 刷新对照 **3/3 pass**；外部撤销后下一 warm acquire 拒绝、撤销完成后再 import 不相关策略不复活旧记录 **2/2 pass**。此前正常变更回归和这条外部撤销读取反例可以关闭。

## P1：同一检查后提交反例仍复活已撤销策略

位置：`acp-startup-policy-store.ts:syncToStorage` 的磁盘/基线比较与随后 `persistPolicies` 调用之间的事务边界。

不可变基线修正了比较对象，却没有让比较与发布成为一个不可被其他 writer 插入的事务。本轮沿用前轮同一受控交错：

1. 导入方 reload 并通过磁盘/基线比较，开始提交 A+B。
2. 在实际 native tmp 创建前暂停导入方，另一真实进程撤销 A，返回成功。独立进程确认 A 不活跃。
3. 导入方继续创建、验证和发布旧提案 A+B，返回成功。再开独立进程，A 又活跃。

```text
externalRevocation.success=true
afterRevocation.active=false
imported.success=true
afterCommit.active=true
```

**同一测试仍为 1 test / 0 pass / 1 fail，exit 1**。基线比较和提交之间仍有时间窗口，不能声明 CAS、无丢失更新或跨进程强一致性。应使用覆盖完整读改写/发布周期的单 writer 或有效原子事务机制；再增加一次不受保护的读取仍会留下同类窗口。

验收允许竞争操作被序列化，或其中一个明确返回冲突；不要求两个竞争操作都成功。若实施改为持锁等待，调度测试也应改成不会在持锁期间同步等待被阻塞子进程的协调方式。当前同步注入用于证明无提交保护版本的真实可达时序，不应被当作强制保持的实现形态。

## 证据

固定源码、脚本与日志：`.tmp/review-pr1669-8086627a2/`。共 **6 tests / 5 pass / 1 fail**。

```powershell
node .tmp/review-pr1669-8086627a2/prepare-checkpoint.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-8086627a2/normal-mutations.test.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-8086627a2/policy-freshness.test.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-8086627a2/write-interleaving.test.mjs
```

源码只改模块链接，业务逻辑不改；文件、ACL、原生脚本、store 和跨进程操作真实。Temp 祖先准入模拟、叶目录真实 private protected；pool client 为合成对象，交错仅控制调度。每组使用独立 runner HOME，没有访问真实策略库、历史、运行配置或生产数据，也没有原机/普通用户/真实 DSH 成功验收。

## 续办

仍为 changes requested，阻塞项是同一提交一致性 P1，没有扩大范围。请先按完整事务边界修复并在当前源码/新构建上验证正常、顺序及交错行为，再同轮完成 W2 受控入口/可信存储、池生命周期、F4、W4/W6 和最终正式验证。不要把这些留到下一次批准；无需续批，不合入、不部署、不关闭 Issue。
