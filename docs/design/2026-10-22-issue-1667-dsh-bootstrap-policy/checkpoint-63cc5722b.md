---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: 63cc5722b868dba0c663f1a70d52de5fd44ee059
status: changes-requested
---

# 检查点 63cc5722b：原生文件创建调用的构造函数不匹配

本地 HEAD 与 GitHub PR #1669 实时 `headRefOid` 均为 `63cc5722b868dba0c663f1a70d52de5fd44ee059`，PR OPEN。本轮只审此增量，没有以旧 SHA 的绿灯覆盖新实现。

## P1：首次导入即失败，未进入重载阶段

位置：`acp-startup-policy-storage.ts:63`。

新增脚本调用：

```powershell
$fs = [System.IO.FileStream]::new($filePath, $mode, $security, $access, $share, 4096)
```

Windows PowerShell 5.1 / 实际 .NET Framework 中没有匹配该参数顺序/类型的构造函数。按完整 SHA 提取的真实源码执行 store 的完整生命周期测试，首次 `importPolicy` 就返回 `success:false`，子进程 exit 1；原始 stderr 按本机编码解码为：

```text
找不到“new”的重载，参数计数为:“6”。
```

测试结果为 **1 test / 0 pass / 1 fail，exit 1**，后续独立进程重载、撤销、再次重载尚未执行，不能声称此闭环已通过。失败发生在 FileStream 参数绑定，当前并无新文件 owner/protected DACL 成功证据。

本机 `[System.IO.FileStream].GetConstructors()` 确认带文件安全描述符的可用签名为：

```text
(String, FileMode, FileSystemRights, FileShare, Int32, FileOptions, FileSecurity)
```

另做隔离诊断对照，仅在独立诊断脚本内将构造调用改为：

```powershell
[System.IO.FileStream]::new($filePath, $mode, $full, $share, 4096, [System.IO.FileOptions]::None, $security)
```

创建合成文件成功，原生回读 `ownerMatches=true / protected=true / contentMatches=true`。这是定位 API 调用错误和说明存在可用路径的诊断证据；没有修改产品源码，不将它当成当前提交修复成功或生命周期通过。实施方需修复产品调用，并在实际源码/新构建上完成闭环与负例。

## 验证方式和边界

脚本、固定源码和日志：`.tmp/review-pr1669-63cc5722b/`。`constructor-stderr.bin` 保留原始错误字节，`constructor-diagnostic.log` 含正确解码的错误、构造函数反射与独立对照结果。

```powershell
node .tmp/review-pr1669-63cc5722b/prepare-checkpoint.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-63cc5722b/storage-lifecycle.test.mjs
node packages/api/scripts/with-test-home.mjs node G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-63cc5722b/constructor-diagnostic.mjs
```

源码快照来自 `git show <完整SHA>:<path>`，只改模块链接，未更改被测逻辑。祖先目录准入显式模拟；叶目录真实 private protected，store/文件创建/原生脚本真实执行。所有实验使用 runner 的临时 HOME/合成文件，不触碰运行配置、真实用户策略、历史或生产 Redis。本轮没有原机或普通用户成功验收。

当前工位 dist storage 仍不含 `CREATE_SECURE_FILE_SCRIPT` 和 `VALIDATE_FILE_SCRIPT`。现有 6 个导入测试使用 dist，不能以该旧产物的绿灯证明嵌入 PowerShell 正确；TypeScript 类型检查本身也不验证脚本运行时 API。请将真实新建文件和跨进程重载纳入自验，不在 reviewer 再跑后才首次发现创建 API 不能执行。

## 续办

仍为 changes requested。先修复此次 P1，保留 CreateNew 与创建时私有 owner/DACL，不通过关闭验证或事后修复不可信既有文件换取通过。随后在同一轮直接完成 W2 全闭环、池生命周期、F4、W4/W6 及最终验证，不等待 reviewer 再批准续做；当前不合入、不部署、不关闭 Issue。
