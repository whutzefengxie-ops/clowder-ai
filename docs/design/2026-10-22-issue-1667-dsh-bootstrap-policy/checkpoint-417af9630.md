---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: 417af9630eb770c0ae79ce93ccda3c68b2077d3d
status: changes-requested
---

# 检查点 417af9630：文件创建通过，W2 的权威状态与恢复仍未闭环

本地和 GitHub PR #1669 实时 HEAD 均为 `417af9630eb770c0ae79ce93ccda3c68b2077d3d`；PR OPEN。本轮未修改产品代码或正式测试。

## 关闭此前文件创建 P1

真实源码中的七参数 FileStream 调用成功执行。原文件组 **5/5 pass**；原生 `import → 独立进程重载 → revoke → 独立进程再重载` **1/1 pass**，均 exit 0。显式 Everyone FullControl、manifest symlink、普通与悬空 tmp symlink 的对应拒绝仍通过。

因此，构造函数错误和 writer/reader 文件安全属性不一致的具体 P1 可以关闭。这证明文件契约和该顺序流程，不表示整个 W2、宿主刷新、失败恢复或原机验收已经通过。

## P1-1：已持久撤销的策略仍发热池租约，后续写入还能使其复活

位置：`acp-startup-policy-store.ts:104-117`、`:124-127`、`:186-212`。Pool 的调用点为 `AcpProcessPool.ts:181`。

store 仅在模块初始化时读盘。`getActivePolicies/isPolicyActive` 永远使用本进程 Map，`syncToStorage` 则直接把该快照整份覆盖回磁盘。两个同一实例所有者的进程按顺序操作即可复现，无需并发竞争：

1. 宿主进程导入 A，创建并释放一次池租约。
2. 另一个进程加载同一受保护存储，撤销 A，返回成功。
3. 再开独立进程确认 A 已不活跃；宿主仍认为 A 活跃，下一次 `acquire` 成功复用同一 client。
4. 宿主随后导入不相关的 B，返回成功。再开独立进程，A 又变成活跃，因旧 Map 将 A 写回。

实际回执：

```text
EXTERNALLY_REVOKED_POLICY_WARM_LEASE
  revoked.success=true, fresh.active=false, retainedInHost=true, warm=true
REVOKED_POLICY_RESURRECTION
  before.active=false, imported.success=true, after.active=true
```

对应组 **2 tests / 0 pass / 2 fail，exit 1**。本例复用真实 store、持久化和 pool，ACP client 是合成对象，没有启动 DSH 或调用模型。

修复应让离线受控操作与运行中宿主消费同一个权威策略状态：撤销成功后阻止下一租约，写入不能覆盖较新状态或复活已撤销记录。明确单一 writer/刷新/提交的一致性边界即可，不要求为此建设通用多 writer 平台。单纯增加池签名字段、同进程 listener，或只在新建 service 时检查都不能覆盖此反例。

## P1-2：发布失败后，重启丢失此前已确认成功的策略集

位置：`acp-startup-policy-storage.ts:672-676`，与 loader 的 `:389-390`。

writer 先把旧 manifest rename 为 backup，再把 tmp 发布为 manifest。第二步失败时只返回错误，不恢复旧 manifest；loader 在 manifest 缺失时直接返回空集，不尝试受验证的恢复。

故障注入仅拦截最终 `tmp → manifest` rename 并返回 EACCES；其余文件、ACL、备份和子进程读取均真实执行：

```text
先导入 A成功，独立进程确认 A活跃
导入 B时最终发布失败，返回 success:false
manifestExists=false, backupExists=true
原进程仍认为 A活跃，但独立进程读取 A=false
```

对应组 **1 test / 0 pass / 1 fail，exit 1**。这是确定性的提交失败注入，没有宣称已模拟断电。磁盘上 backup 仍保留数据，但当前读路径不会恢复它；失败更新不能让此前已确认成功的策略在重启后不可用。

应修复完整的提交/失败恢复契约，同时保留文件来源、完整性、权限与路径验证。不要用无条件加载任意 backup 的 fallback 掩盖损坏。新失败应返回明确原因；此前已确认的状态必须仍可安全读取或受控恢复。

## 证据与适用范围

脚本、固定源码与完整日志在 `.tmp/review-pr1669-417af9630/`。各组使用各自独立的 runner 临时 HOME；按完整 SHA 提取源码，只改模块链接，不把旧 dist 作为新实现证据。

```powershell
node .tmp/review-pr1669-417af9630/prepare-checkpoint.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-417af9630/file-boundary.test.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-417af9630/storage-lifecycle.test.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-417af9630/policy-freshness.test.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-417af9630/storage-recovery.test.mjs
```

组间合计 **9 tests / 6 pass / 3 fail**。Windows Temp 祖先准入显式模拟，叶目录和文件 ACL/读写、原生 FileStream、独立进程均真实；pool client 和最终 rename 故障分别按上文模拟。因此不能声明整条原生祖先链、普通用户、真实 DSH 或产品运行成功。没有接触真实用户策略库、历史、运行配置、生产 Redis，也没有重启服务。

## 下一实施轮

仍为 changes requested。既有授权无需续批，请在同一实施轮完成可做范围，再统一回传最终 HEAD 和实际证据：

1. 完成 W2 的权威状态/失败恢复，以及实际受控候选采集、审核后导入/撤销入口与可信存储位置。当前生产代码 census 中，`importPolicy/revokePolicy` 只有定义，没有实际入口调用者；模块函数和 reviewer 的临时 harness 不能代替操作入口。
2. 继续既有池生命周期三项（退役期间租约、初始化期间撤销、计数失衡）与 F4 实际解释器/启动闭包绑定。不要将这些再次转成未来任务。
3. 补齐 W4 错误传播、W6 真实能力调查和当前源码/新构建的正式测试与检查；原机及普通用户未测项明确保留。

可拆实现提交，不因存检查点再次等待 reviewer 批准继续。当前不合入、不部署、不关闭 Issue；不自动扩大运行权限或修改真实配置来完成原机测试。
