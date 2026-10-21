---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: 3fda6cedf60f1f3be8b24ab1ffccd9f41da23915
status: incomplete
tips_exempt: 同一文件信任根因的精确提交复验，原范围继续
---

# 检查点 3fda6cedf：已有目标链接被拒绝，悬空链接仍越界创建

审查绑定本地不可变提交 `3fda6cedf60f1f3be8b24ab1ffccd9f41da23915`。本轮没有重新读取远端 HEAD；不把本地结果写成远端状态验收。原 Task、范围和执行授权不变。

## 已确认改善

目标已存在的 `policies.json.tmp` 符号链接被实际 writer 拒绝，目标测试文件保持原内容。这条具体反例通过。正常私有 manifest 读取和 manifest symlink 拒绝两个正向/回归对照继续通过。

## P1：悬空 tmp 链接仍能在策略目录外创建文件

测试让 tmp 指向同一临时 HOME 中、策略目录外的一个尚不存在的合成文件。真实文件系统的状态是 `lstat(tmp).isSymbolicLink() === true`，但 `existsSync(tmp) === false`。当前实现因此跳过 tmp 验证，普通 writeFileSync 跟随链接创建目标，随后返回成功：

```text
DANGLING_TMP_SYMLINK: result.success=true, targetCreated=true
```

代码注释声称使用独占 wx，但实际调用仍是：

```typescript
writeFileSync(tempPath, JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 });
```

只有 mode，没有设置独占创建。检查、删除既有 tmp、再普通写入，也没有消除检查与使用之间的替换窗口。“清理 tmp”更不能代表原子提交。

应以真实独占创建（例如正确使用 wx，或安全的唯一临时对象方案）保证不会跟随既有对象；检测链接/文件身份不能依赖会跟随目标的 existsSync。安全预期是策略目录外的目标既不被修改也不被创建，无论实现选择拒绝还是使用另一安全临时对象。测试没有强制只有一种返回状态，也未使用并发碰运气制造反例。

## P1：manifest 文件 ACL 仍未验证

既有 manifest 加入显式 Everyone FullControl 后，原生 SDDL 确认宽权限，目录 descriptor 没有变化，loader 仍返回 1 条策略。本提交仍只有 symlink 判断，原生 file owner/DACL/rights/reparse 验证没有实现；这项继续开放，不能将路径检查标成 ACL 修复。

文件组模拟目录准入返回，真实目录叶节点设为当前 token 的私有 protected DACL；文件操作、SDDL 和目标创建都是真实 Windows 行为。该组隔离文件契约，不声称整条 Temp 祖先链已受信任，也不冒充普通用户/原机完整攻击验收。

## 验证终态

**5 tests，3 pass，2 fail，0 cancelled，0 skip，exit 1**。两项失败是 manifest 宽权限仍被加载、悬空 tmp 链接越界创建。

```powershell
node .tmp/review-pr1669-3fda6cedf/prepare-checkpoint.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-3fda6cedf/file-boundary.test.mjs
```

脚本、git show 固定源码快照和完整日志位于 `.tmp/review-pr1669-3fda6cedf/`，日志为 `file-boundary.log`。模块只重写链接并去 TypeScript 类型，不把旧 dist 当成本修改的行为证据。测试仅访问 runner 新建的临时 HOME、合成 manifest/ACL/符号链接，没有写真实用户文件、配置、策略库、历史、账号或生产 Redis；没有启动 DSH。本轮未重跑完整构建，也没有原生成功导入全流程证据。

## 续办

先落实实际的独占安全创建及 manifest/tmp/backup 全文件信任，直接继续 W2 操作闭环、池生命周期、F4、W4/W6。原生 file 验证可按 File.GetAccessControl/RawSecurityDescriptor 与既有 SID 规则复用共同逻辑；目录安全或 symlink 判断不能代替它。原范围未完成，保存中途提交后继续，无需等待逐项批准。完整可做范围齐备或有具体外部失败证据时回传。

整项验收仍未通过，不合入、不部署、不关闭 Issue。
