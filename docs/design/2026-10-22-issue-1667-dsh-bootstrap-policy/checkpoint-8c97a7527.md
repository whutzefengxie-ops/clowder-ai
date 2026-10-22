---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: 8c97a75279dfa47a85b1742dfe6760b6175ca623
status: changes-requested
---

# 检查点 8c97a7527：并发检测把本次合法变更当成外部冲突

本地 HEAD 与 GitHub PR #1669 实时 HEAD 均为 `8c97a75279dfa47a85b1742dfe6760b6175ca623`，PR OPEN。

## P1：正常导入与撤销均被拒绝

位置：`acp-startup-policy-store.ts` 的 `syncToStorage`（磁盘 keys 与 `localPolicies` keys 双向比较），以及 import/revoke 修改 Map 后调用它的顺序。

比较时 `localPolicies` 已是本次操作的提案集合，不是未修改的基线。单进程、无任何并发操作时也必然出现：

| 操作 | 当前磁盘 | 修改后的 Map | 实际错误 |
| --- | --- | --- | --- |
| 首次导入 A | 空 | A | A was removed from disk since last reload |
| 撤销已有 A | A | 空 | A was added on disk since last reload |

对精确 SHA 的源码和真实 Windows private 文件执行，两个接口均返回 `success:false`。撤销 fixture 通过 storage writer 预置可信有效记录，代表已有版本留下的合法策略；不存在竞争进程或人为并发注入。

第三个对照通过：先写入有效策略，再经可信 storage writer 清空磁盘，getter 已能看到失效。该读路径进展不等于正常写入或整个池撤销契约通过。

必须保留修改前的不可变基线，与提交时权威状态比较；本次意图变更应单独作为提案。与此同时，检查与发布之间仍须有有效的排他/原子事务边界，否则前轮“检查完成后另一进程撤销，再被旧提案覆盖”的时序仍存在。仅移动第二次 read 或比较 keys 无法证明 CAS。这里要求的是既定的提交一致性，不是再扩建一个并发平台。

## 实测与可重跑入口

**3 tests / 1 pass / 2 fail，exit 1**：正常 import 失败，已有有效记录 revoke 失败，getter 刷新对照通过。

```powershell
node .tmp/review-pr1669-8c97a7527/prepare-checkpoint.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-8c97a7527/normal-mutations.test.mjs
```

固定源码与完整日志在该 `.tmp/review-pr1669-8c97a7527/` 目录。源码由完整 SHA 提取，只改模块链接；store、native 文件安全创建/验证、读写均真实。Temp 祖先准入明确模拟，叶目录有真实 private protected DACL，全部在 runner 临时 HOME 与合成数据中运行。没有接触真实策略库、运行配置、历史或生产 Redis，没有原机或普通用户验收。

本轮 dist 仍没有新文件安全脚本和新冲突检测代码，因此旧 dist 的 6/6 不覆盖本次实现。TypeScript 编译也不验证提交算法行为。

## 续办

仍为 changes requested。请先在当前源码/新构建上把本轮正常变更测试及前轮顺序跨进程生命周期、外部撤销热租约、提交交错、失败恢复的 RED→GREEN 跑实，再回传真实结果；不要把尚未执行的验证写成“已修复”或“强一致性保证”。

同轮继续已授权 W2 实际入口/可信存储、既有池生命周期、F4、W4/W6 和最终正式验证；无需等待 reviewer 批准续做。当前不合入、不部署、不关闭 Issue。此前安全约束与原机未测项继续保留。
