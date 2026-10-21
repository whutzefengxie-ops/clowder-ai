---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: 00255a3b892f9854c0562a3cab40b625ea5c744a
status: incomplete
tips_exempt: 有界文件信任反例与续办，原范围继续，不新增等待门禁
---

# 检查点 00255a3b8：首次创建接线改善，文件信任仍开放

本地精确 HEAD 为 `00255a3b892f9854c0562a3cab40b625ea5c744a`。本轮 gh 远端读回因 GitHub API TCP 连接超时失败；不声称当前远端 HEAD 或 PR 状态已验证。以下证据绑定本地不可变 Git 提交。

原 Task 继续，无需等待局部复验才开始后续独立工作。父目录、reader、目录 ACL 等具体反例逐项关闭，并不代表整个 W2 已交付。

## 本轮确认改善

实际 Windows 首次使用 probe 不再解引用不存在的 `.clowder-ai` 父目录，而是进入祖先信任验证。本机 runner 的 Temp 祖先允许另一主体 Modify，得到真实 `PARENT_REPLACEMENT` 拒绝；这项是正确失败关闭，不是可导入的成功验收。既有 Everyone 授权和继承 DACL 两个拒绝用例也保持通过。

新增 manifest symlink 读取对照通过：实际 loader 检测到符号链接并拒绝加载。此前首次缺失父目录的接线错误可以关闭；不能据此关闭文件 owner/DACL、全部 reparse 或写入对象信任。

## 文件用例的明确假设和正向对照

为了单独检验文件边界，文件用例 mock 目录 helper 的准入返回，不宣称 Temp 整条祖先链受信任。与此同时，测试确实给隔离 HOME 的两个叶目录设置了当前 token SID 的 protected private DACL；文件读写、ACL 改动和 SDDL 回读都使用真实 Windows API/系统命令，未 mock 文件 guard 或 fs。

真实 writer 生成有效 manifest，正常私有文件的读取正向对照通过。之后只修改该文件 ACL，目录 descriptor 回读完全相同。该条件直接检验“父目录保护能代替文件本身检查”的假设，不是完整产品/普通用户授权验收。

## P1：manifest 的显式宽权限未被检查

测试为 manifest 加入显式 Everyone FullControl，系统 icacls 保存的原生 SDDL 确认 WD/FA ACE；`lstat().isSymbolicLink()` 为 false，目录 descriptor 未变。实际 loader 仍返回策略：

```text
manifestWorldFullControl=true
directoryUnchanged=true
loaded=1
```

目录 `(OI)(CI)` 的继承规则不能证明既有文件没有其他显式 ACL，也不能证明其 owner、物理对象或 reparse 状态可信。该反例没有改动策略摘要或内容，单纯的 symlink 检查无法识别。应对 manifest 的实际文件对象执行原生 owner/DACL/rights/reparse 等验证，而非将其记录成已知限制后继续授信。

## P1：已有 tmp 符号链接导致越过策略目录写入

测试在同一临时 HOME 中创建策略目录外的另一份合成文件，写入固定 marker，再让 `policies.json.tmp` 成为指向它的 Windows 文件符号链接。实际 writer 的 `writeFileSync(tempPath, ...)` 跟随该链接：

```text
persistPolicies().success=true
targetUnchanged=false
```

另一份合成文件已被 manifest JSON 覆盖。新加的 manifest 读取检查发生得太晚，既有 tmp/backup 和写入/替换路径还未获验证。此测试只覆盖 runner 创建的数据，没有覆盖真实配置或用户文件。

应按同一文件信任规则覆盖 manifest/tmp/backup 的创建、读取、重开、替换和恢复。新建临时文件须采用独占、不会跟随既有不可信对象的创建方式；权限/身份/reparse 检查必须早于会改变数据的操作。不要先写入或修改 ACL 再补验证，也不要只给 loader 增加一个 lstat 判断来代表整个持久边界。

## 运行证据

- 原生目录 probe：**3 tests，3 pass，exit 0**。首次 probe 的 PASS 表示已到达真实祖先拒绝，不能写成原生成功导入。
- 文件边界测试：**4 tests，2 pass，2 fail，exit 1**。两项 PASS 为私有普通 manifest 的正向对照和 manifest symlink 拒绝；两项 FAIL 为文件显式 ACL 与 tmp 链接写入。
- 两组共 **7 项，5 通过、2 失败，0 cancelled，0 skip**。只有文件组模拟了目录准入，二者不能合并宣称完整原生验收。

```powershell
node .tmp/review-pr1669-00255a3b8/prepare-checkpoint.mjs
node packages/api/scripts/with-test-home.mjs node --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-00255a3b8/native-storage.test.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-00255a3b8/file-boundary.test.mjs
```

脚本、源码快照和日志在 `.tmp/review-pr1669-00255a3b8/`，分别为 `native-storage.log`、`file-boundary.log`。真实模块从 git show 固定 SHA，重写链接并去 TypeScript 类型，未把旧 dist 当成本修改的行为证据。本轮没有完整 build/lint 重跑、原机或普通用户成功使用证据。

全部文件和 ACL 改动仅涉及 runner 新建的临时 HOME、合成策略和测试目标；没有访问/改动实际策略库、历史、账号、runtime 配置、生产 Redis，未运行真实 DSH。

## 继续原完整范围

文件信任是前几轮已明确的同一 W2 边界，并非新增产品要求。继续补齐它与 W2 受保护存储中的导入→独立进程重载→撤销→再重载，以及维护变更到达既有 host 的真实路径；池生命周期、F4、W4/W6 继续按原范围推进。审查进行期间可以做这些独立工作，不能把“等 reviewer 再开始下一项”设成新前置条件。

当前仍未通过整项验收，不进入合入、部署或 Issue 关闭。
