---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: c2c069819c8c2f9db4a8b9530dcfdfe5762a3f0a
status: incomplete
tips_exempt: 对实施检查点的有限复验，原任务继续，不新增批准或等待步骤
---

# 检查点 c2c069819：继续完整实现，Windows 信任不能由警告代替

本地与远端起审时确认 HEAD `c2c069819c8c2f9db4a8b9530dcfdfe5762a3f0a`，PR #1669 仍为 OPEN。作者可继续 F4、W4/W6 及剩余实现，无需再次询问是否继续；Windows 策略存储的 P1 必须在本次交付关闭，不能改成 TODO、警告或“后续工作”后获得验收。原机环境尚未取得的证据仍可如实列为未验证，代码中缺失安全机制属于未完成实现。

## 本轮确认改善的具体行为

在该 SHA 的真实 storage/store/matcher 源码上重新运行：有效记录能够持久写入并重读；篡改嵌套 artifact/启动约束但沿用原摘要时被拒绝；schemaVersion 99 被拒绝；含未知 named 键 `--mode` 的策略被拒绝导入。这四个正向/回归用例通过。

这些结果只关闭对应反例，不能证明“完整 schema”或“参数约束全部完成”。本轮仍发现下面相同根因的可执行反例。

## P1：参数键白名单未约束值与实际配置来源

1. 导入 `requiredArgs.named = { '--profile': '' }` 成功。matcher 使用 `if (namedArgs['--profile'])`，空值直接跳过完整 argv 检查。以 `node entry --profile acp --patch unsafe.yml` 匹配得到 `matched: true`。
2. 导入 `{ '--profile': 'unreviewed' }` 成功。实际命令选择 `--profile unreviewed`，而 matcher 仍固定检查 `DSH_HOME/profiles/acp`。在隔离 fixture 的 `profiles/unreviewed/cordis.patch.yml` 写入非空 patch 后，仍得到 `matched: true`。

这不是再补一个空值条件就结束的问题。导入、持久重载和 matcher 应共享受支持启动形态的完整校验，明确字段类型、取值与消费对象。当前实现真正支持的默认 ACP 形态应完整约束 `['--profile', 'acp']`；如要支持其他 profile，必须让实际选择的 profile 与审核/指纹/复验指向同一对象。未知或未消费的字段/形态不能获得启动例外。所有 reader 应使用同一规范化规则，避免继续复制并逐渐分叉的验证分支。

## P1：持久化失败仍授予内存授权并返回成功

隔离 HOME 中，在实际 writer 使用的 `policies.json.tmp` 位置放置一个测试创建的空目录，触发真实 `writeFileSync` 的 EISDIR。随后调用真实 `importPolicy()`，得到：

```text
imported.success = true
isPolicyActive(id, revision) = true
policy exists on disk = false
```

writer 虽然报告失败，`syncToStorage()` 仍吞掉错误，调用方观察到的结果不是一次持久授权变更。import/revoke 必须将持久提交和内存发布作为可解释的整体；失败不能被伪装成成功。撤销失败、两次 rename 间的中断/恢复、重启以及独立维护进程的变更如何到达既有 host，仍在原 W2 范围内。本用例只运行了导入失败反例，不冒充撤销故障验证。

## P1：Windows 策略库仍未建立信任边界

`persistPolicies()` 在 Windows 上仅 warning 后继续写入；`loadPersistedPolicies()` 也没有原生权限/路径检查。文件来自 HOME 不等于受保护，普通 SHA-256 不是授权证明。不能接受“assuming existing directory is secure”作为 active policy 的依据。

可复用的真实代码路径是 ACP 模块根下 `../acp-bootstrap-windows-directory.ts`，不是 bootstrap 子目录里的同名文件。其 `ensureWindowsAcpBootstrapDirectories(root, cwd, options)` 为同步接口，可参考原生 owner、protected DACL、reparse、祖先可替换性和安全创建逻辑。这个函数检查目录，不自动证明 manifest/tmp/backup 文件安全；应按策略库实际读写对象复用合适逻辑，覆盖首次创建、既有对象、重开与替换，不盲目套用临时 cwd 生命周期或启动例外选项。

信任验证失败或机制不可用时，本地策略不得成为 active。验证须先于授权读入/发布，并传播成可见拒绝；只有日志而仍继续授信不算失败关闭。既有损坏或不可信对象也不能靠自动修改真实权限来“修复”。本轮没有更改真实 HOME、ACL 或 runtime 配置。

## 上一检查点的开放项继续保留

本轮实质代码仅修改 storage/store 与导入测试，pool 生命周期没有修复。因此 `checkpoint-815d4571e.md` 中的“策略读取期间退役仍发热租约”“初始化期间撤销仍发新租约”和 P2 `liveProcessCount=-1` 继续开放；本轮未重复运行那些未变路径，不编造新的 GREEN。

F4 实际解释器与启动闭包绑定、W4 unavailable 全链传播、W6 源码调查及最终验证也仍需完成。未受信任的候选解释器不能为了识别自身而被执行；从实际解析到的可信对象取得身份，绑定审核依据和准入快照。

## 证据与边界

本轮终态：**7 tests，4 pass，3 fail，0 cancelled，0 skip，exit 1**。三项失败分别为空 profile 绕过、写盘失败仍授信、实际 profile 与检查路径不一致。

```powershell
node .tmp/review-pr1669-c2c069819/prepare-checkpoint.mjs
node packages/api/scripts/with-test-home.mjs node --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-c2c069819/checkpoint.test.mjs
```

脚本、源码快照和完整输出在 `.tmp/review-pr1669-c2c069819/`（`checkpoint.log`）。通过 git show 固定上述 SHA，采用与上一轮相同的 Node TypeScript 去类型执行方式，仅重写模块链接。真实 store/storage/matcher 在 runner 新建的隔离 HOME 下运行；没有启动真实 DSH、访问真实策略库/原生历史/账号/Redis，也没有做原生 ACL 验收或完整构建。本轮结果不能替代 build、原机或普通用户证据。

## 续办

沿原 Task 继续完成这些同根因问题及 F4/W4/W6；不要求中途提交再等待 reviewer 同意。完整可做范围齐备后带真实 SHA 和行为终态回传；若确有外部阻塞，提供具体调用、返回与受影响范围。复杂度与 TODO 本身不是外部阻塞。

`checkpoint-response-584259493.md` 的 reviewed_head 又使用了补造的完整 SHA。真实修复提交为 `58425949391f5ae4ad0b68945d3324aa19db6215`，当前检查点文档提交为 `c2c069819c8c2f9db4a8b9530dcfdfe5762a3f0a`。请更正为 Git 读回值，并同步真实已完成范围。

本检查点不批准合入，不部署，不关闭 Issue。
