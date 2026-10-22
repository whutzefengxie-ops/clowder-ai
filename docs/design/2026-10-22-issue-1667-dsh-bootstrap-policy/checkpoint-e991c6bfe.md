---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: e991c6bfe5ddb651996a3dc39bc934fa3bd96f32
status: changes-requested
---

# 检查点 e991c6bfe：显式宽权限被拒绝，正常写入与重载契约不一致

本地 HEAD 与 GitHub PR #1669 的实时 `headRefOid` 均为 `e991c6bfe5ddb651996a3dc39bc934fa3bd96f32`；PR 为 OPEN。作者回传中同时提到 `80223b7d1`，本轮未将其当作当前提交。当前执行能力已恢复，真实 Git/文件/原生子进程操作成功；旧控制面中断不再代替本次代码验收状态。

## 已关闭的具体反例

以当前 SHA 的源码快照执行原文件组：**5 tests / 5 pass / 0 fail，exit 0**。叶目录 protected private DACL 保持不变时，manifest 的显式 Everyone FullControl 现在返回 `File has unsafe Allow ACL for: S-1-1-0`，loader 返回 0 条策略。该具体 P1 可以关闭。普通私有文件、manifest symlink、已有目标 tmp symlink、悬空 tmp symlink 的对应检查均通过。

另外构造真实 Windows 条件 ACE：SDDL 含 `(XA;;FA;;;WD;(1 == 1))`，原生回读确认 AccessAllowedCallback/Everyone；当前实现同样拒绝。此单例通过，不据此声明全部原始 ACE 类型均已覆盖。新脚本没有复用目录 helper 的 `RawSecurityDescriptor` 类型白名单；提交说明不应声称已经复用该逻辑。

## P1：导入成功后写出的文件无法重载，撤销也失败

关联源码：`acp-startup-policy-storage.ts:486-490`、`:549-552`，与文件 reader 的 owner/protected DACL 检查 `:58-64`。

在实际 private protected 叶目录中，通过真实 store 执行 `importPolicy`，保留其写出的文件原样，再启动独立 Node 进程执行真实 store 的加载。结果：

```text
importPolicy                 -> {success:true}
writer manifest DACL         -> D:AI(A;ID;FA;;;LA)
fresh process getPolicy      -> undefined / found:false
revokePolicy                 -> {success:false, error:...File has untrusted owner: S-1-5-32-544}
same process getPolicy       -> 仍存在
```

当前提升权限测试进程创建的文件 owner 为 Administrators，违反 reader 要求的当前用户 SID。作为根因对照，仅对该合成文件修正 owner 后，loader 仍以 `File must have a protected private DACL (no inheritance)` 拒绝；再将该合成文件设为 private protected DACL，原策略立刻可以加载。这证明问题也包括继承 DACL，不能只修正 owner。

根因是 writer 仍通过 Node `writeFileSync(..., mode:0o600, flag:'wx')` 创建 tmp，未建立 reader 所要求的 Windows 文件安全属性，也没有在 rename 前调用新原生文件校验，就直接返回成功。回传所说“tmp 写入后、rename 前验证”在实际源码中不存在。首次写入成功与重启可恢复、可撤销不是同一件事；本轮生命周期测试为 **1 test / 0 pass / 1 fail，exit 1**。

必须将新文件创建、准入、提交与后续加载/撤销使用同一个安全契约：新建 tmp 在创建时设置可信 owner/private DACL，保留独占创建，提交前验证文件信任并保证失败不会发布成功状态。不要自动修复已有不可信用户文件，也不要靠测试手动改 ACL 使产品成功路径变绿。修复应覆盖首次导入、后续覆盖、独立进程重载、撤销及再重载，检查 tmp/manifest/backup 的生命周期与失败恢复。

## 证据及适用范围

源码快照由 `git show <完整SHA>:<path>` 提取，只改模块链接；文件校验 PowerShell、store、writer、reader、Windows ACL/SDDL 和子进程重载均真实执行。固定脚本与日志在 `.tmp/review-pr1669-e991c6bfe/`。

```powershell
node .tmp/review-pr1669-e991c6bfe/prepare-checkpoint.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-e991c6bfe/file-boundary.test.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-e991c6bfe/storage-lifecycle.test.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-e991c6bfe/raw-acl.test.mjs
```

祖先目录准入被显式模拟，以隔离 Windows Temp 祖先已知不满足生产安全要求的问题；叶目录为真实私有目录，文件和 ACL 并未模拟。本轮结论是文件契约级结果，不是整条祖先链、普通用户、真实 runtime 或原机 DSH 的成功验收。所有操作仅涉及 runner 的临时 HOME/合成数据，未修改运行配置、真实策略库、历史或生产 Redis。

作者回传的 6 个测试读取 dist；本轮工位的 dist storage 不含新文件验证脚本。因此该旧产物的绿灯不能代替当前 SHA 的源代码证据。本轮未重跑全仓构建，不复用其作为新实现验收结论。

## 续办结论

当前仍为 changes requested，不合入、不部署、不关闭 Issue。先修复上述文件生命周期 P1，并直接完成既有范围：W2 真实受保护存储与受控导入闭环，池的退役/撤销/初始化计数边界，F4 实际解释器与启动闭包绑定，W4 完整错误传播，W6 调查及最终验证。合入 main 带来的新代码亦需绑定最终 HEAD 验证，旧结论不能自动覆盖变化。无需再等待 reviewer 批准继续，完整可做范围齐备后统一回传精确 HEAD 与实物证据；原机未测项继续明确保留。
