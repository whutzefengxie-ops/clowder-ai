---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: 3a50dec9c59ce59fa4a880ed055e7badd97d6d54
status: incomplete
tips_exempt: 确认两个 tmp 反例关闭，保持完整交付范围
---

# 检查点 3a50dec9c：两个 tmp 反例通过，文件 ACL 仍为 P1

绑定本地精确提交 `3a50dec9c59ce59fa4a880ed055e7badd97d6d54`；本轮未刷新远端 HEAD，不声明远端状态验收。

## 局部结果

实际源码已使用 lstat 检查 tmp 和 `flag: 'wx'` 创建。两个此前反例均通过：已有目标链接被拒绝且另一测试文件保持原内容；悬空链接被拒绝且策略目录外的目标没有被创建。这两条具体问题可以关闭。该证据没有证明整个持久化流程的所有竞态、rename/恢复或文件信任已经完成。

文件组终态为 **5 tests，4 pass，1 fail，0 cancelled，0 skip，exit 1**。唯一失败仍是 manifest 存在显式 Everyone FullControl、目录 descriptor 未变化时，loader 返回 1 条策略。

目录准入被显式模拟，叶目录有真实私有 protected DACL，文件/符号链接操作和 ACL/SDDL 回读均为真实 Windows 行为；不能把这一组写成整条祖先链、普通用户或原机成功验收。

```powershell
node .tmp/review-pr1669-3a50dec9c/prepare-checkpoint.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-3a50dec9c/file-boundary.test.mjs
```

固定 SHA 的源码快照、脚本和完整日志在 `.tmp/review-pr1669-3a50dec9c/`，日志为 `file-boundary.log`。源码只改模块链接并去类型；没有完整构建重跑或真实 runtime/DSH 验收。操作仅涉及 runner 的临时 HOME 与合成文件/ACL，未访问真实用户配置、策略库、历史、账号或生产 Redis。

## 下一步已确定：原生文件验证仍在本次范围

先完成原生文件 owner/DACL/rights/reparse/身份验证，覆盖 manifest/tmp/backup 的生命周期，再验证 W2 受保护存储成功闭环。可复用既有 SID 和 RawSecurityDescriptor 规则，通过 File.GetAccessControl 等文件原生入口实现；不要直接拿目录类型检查当作文件验证。目录继承和 Node 的 symlink 判断都不能关闭显式文件宽权限反例。

这对应作者选项 A，属于既有授权，不需要新的优先级批准。复杂度不构成将它转为未来独立任务或已知限制的依据。允许拆实现提交，但本次交付的文件信任 P1 继续阻塞整项验收。

池生命周期、F4、W4/W6 和最终验证仍需完成；可以继续做独立部分，不再因保存检查点等待批准。完整可做范围齐备后统一回传真实 HEAD。当前不合入、不部署、不关闭 Issue。
