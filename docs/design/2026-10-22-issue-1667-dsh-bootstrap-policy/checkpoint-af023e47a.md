---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: af023e47a2bdace1b2d7c1f1ff9cabf3b1ff9922
status: incomplete
tips_exempt: 不可变提交的局部安全复验，原授权继续，不新增等待门禁
---

# 检查点 af023e47a：输入复制和撤销恢复已通过，原生存储与 reader 仍失败

本地和 GitHub PR #1669 起审时均确认 `af023e47a2bdace1b2d7c1f1ff9cabf3b1ff9922`。原范围与执行授权不变。顺序为：关闭策略库/不可变记录剩余根因，修复池生命周期，再完成 F4、W4/W6 和最终验证；不需要再询问做哪项或是否继续。

## 已确认改善

此前的 9 项行为用例本提交全部通过，包括输入对象导入后修改不再改变 active policy、撤销写盘故障消失后能够重试，且独立新进程不恢复已成功撤销的策略。这两条具体反例已关闭。Windows 安全不能由那 6 条导入/撤销常规单测证明，需看下面原生 fixture 的结果。

## P1：canonical reader 仍暴露可变 active 对象

`getPolicy()` 返回 store 内部对象；`getActivePolicies()` 虽返回新数组，其中元素仍是内部对象。测试导入合法策略后，通过 `getPolicy(id, 1)` 得到的对象把嵌套 `--profile` 值改为空；实际 matcher 再次允许带额外 `--patch` 的启动。

```text
READER_ALIAS_MUTATION: matched=true
```

导入时复制只修复输入引用。所有 reader 也必须避免将内部可变引用交给 caller，builtin/local/load 三个来源均应维持同一不可变记录 invariant；matcher 对自身支持形态的消费也应失败关闭。此要求已在上一检查点提出，不是增加新产品范围。

## P1：显式 Everyone FullControl 原生 ACL 被接受

在 runner 新建的临时 HOME 里，实际 writer 创建一份合成策略库；测试只对该目录用系统绝对路径 icacls 添加显式 `*S-1-1-0:(OI)(CI)F`。再通过 icacls `/save` 读取原生 SDDL，断言存在 `WD` 的显式 FullControl ACE，确认不是仅凭显示字符串推断权限。

此时实际 loader 仍返回一条策略：

```text
EXPLICIT_EVERYONE_POLICY_LOAD: worldFullControl=true, loaded=1
```

当前 validator 只搜索 `(I)`、`BUILTIN`、`NT AUTHORITY\\Authenticated Users` 等文本，未解析 SID、rights、owner、raw/protected DACL，也不验证 reparse 或可替换祖先。没有这些字符串不能推出目录安全。显式其他主体授权、显示语言变化以及不支持的 ACL 形态，都必须按原生权限语义验证，不能继续补显示名字黑名单。

## P1：既有目录被静默修改 ACL，再继续写入

另一原生 fixture 先为测试目录启用继承，确认 icacls 的真实输出出现 `(I)`；保存完整原生 descriptor 后调用 writer，再次保存 descriptor。结果：

```text
AUTOMATIC_ACL_REPAIR: result.success=true, descriptorChanged=true
```

这证明 `persistPolicies()` 验证失败后确实调用 `protectWindowsDirectory()` 改写既有对象并继续写入。原计划与已有 bootstrap 边界要求对既有不可信对象拒绝授信，不能自动修权限。先 mkdir 后改 ACL 也不能替代带私有 DACL 的安全创建。这个自动修复分支应移除，既有对象失败关闭；新建受控对象的创建与验证要按实际路径/身份保证。

原生创建和加载还需覆盖 manifest/tmp/backup 文件自身、reparse 和祖先替换边界，目录输出正常不自动证明文件安全。`/grant:r` 给当前用户名授权也不等于清除其他主体已有显式授权。

## 可执行的修复方向

仓内 `acp-bootstrap-windows-directory.ts` 已使用固定绝对路径的 Windows PowerShell、JSON stdin、.NET `Directory.GetAccessControl` / `RawSecurityDescriptor` 与 SID/rights 检查，并清理子进程的 `PSMODULEPATH`。它不依赖 `Get-Acl` cmdlet。先复用或按策略库对象抽取这条已有路径，而不是用 Get-Acl 模块失败证明原生验证不可做，再退化成本地化 CLI 文本匹配。

目录 helper 不能盲目充当完整策略库验证器：补齐文件与持久存储语义，不套用临时 cwd 生命周期或扩大 root 例外。实际拒绝时保留准确错误，在隔离 fixture 定位；不修真实 HOME/ACL/runtime 配置，不以关闭校验取得绿色。

`execFileSync('icacls', ...)` 当前还是裸命令搜索；若保留任何外部系统工具调用，应固定可信系统路径并核对真实 caller/environment，不能给工作目录或 PATH 提供替换验证器的机会。

## 证据与边界

本轮终态：**12 tests，9 pass，3 fail，0 cancelled，0 skip，exit 1**。3 项失败为 reader 可变引用、显式 Everyone FullControl 仍被加载、既有失败 ACL 自动修复后成功写入。

```powershell
node .tmp/review-pr1669-af023e47a/prepare-checkpoint.mjs
node packages/api/scripts/with-test-home.mjs node --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-af023e47a/checkpoint.test.mjs
```

源码快照、测试与完整输出位于 `.tmp/review-pr1669-af023e47a/`，输出为 `checkpoint.log`。来自 git show 固定 SHA 的真实 store/storage/matcher/pool，运行仅重写模块链接并去类型，未用旧 dist 替代这些改动。Windows ACL 用例调用真实系统 icacls，只有 runner 创建的临时 HOME 及合成策略数据参与改权；没有更改真实用户或 runtime 目录的权限，没有访问真实授权库/历史/账号/生产 Redis，没有启动 DSH。

这是真实 Windows 原生 ACL fixture 的反例，不是普通用户完整验收：未以其他用户 token 执行攻击或覆盖 owner/reparse/全部祖先形态。它也不是完整构建/原机/完整产品验收。本轮没有重跑完整 build 或无改动的池生命周期测试；此前池退役、初始化撤销与计数失衡继续开放，F4/W4/W6 也未完成。

## 续办

按开头顺序继续同一 Task，原生保护和不可变记录均不可标完成。保存检查点后直接续做，完整可做范围齐备后带真实精确 HEAD 与终态证据回传。若有具体外部阻塞，提供实际命令、脱敏 stderr、最小隔离复现和受影响范围；不要把进度再次转成“是否继续”的审批。

本检查点不批准合入，不部署，不关闭 Issue。
