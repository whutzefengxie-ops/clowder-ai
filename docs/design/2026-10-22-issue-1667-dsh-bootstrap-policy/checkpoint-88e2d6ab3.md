---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: 88e2d6ab3f0eb560b7967180cdda82b904894ddf
status: incomplete
tips_exempt: 精确提交的局部复验与续办，原授权不变，不新增等待门禁
---

# 检查点 88e2d6ab3：原反例已绿，策略不可变性与撤销恢复未完成

本地和 GitHub PR #1669 均确认 HEAD `88e2d6ab3f0eb560b7967180cdda82b904894ddf`，PR 为 OPEN。继续同一实现任务，不需要询问是否续做。Windows 原生存储保护、策略记录 invariant、持久化恢复、池生命周期、F4、W4/W6 和最终验证均仍在原范围内。

## 本轮已确认的修复

`ca0fcc479933ae60e344d7d82660f461153ad1c6` 已使 import/load 拒绝空 profile 和非 acp profile；实际导入写盘失败也会返回失败并回滚新增内存记录。`checkpoint-c2c069819.md` 的全部 7 个原反例/正向对照，本 SHA 下都通过。该结果关闭这些具体反例，不等于整个“不可变记录”或“持久事务”已经完成。

## P1：导入结果不是固定的授权快照

store 仍将调用者提供的对象直接 `localPolicies.set(key, policy)`，读取 API 也返回其中的对象引用。测试先正常导入 `--profile: 'acp'` 的合成策略，成功后通过原输入对象将嵌套值改为空字符串；不再经过导入或持久化，matcher 就重新允许带额外 `--patch` 的启动。

```text
importPolicy(validPolicy).success = true
validPolicy.launchShape.requiredArgs.named['--profile'] = ''
matchStartupPolicy(node, [entry, '--profile', 'acp', '--patch', unsafeFile], env).matched = true
```

这验证的是原计划要求的记录不可变性与 canonical reader 边界，没有声称它是外部远程攻击。应保存独立、完整的已验证快照，避免输入及 `getPolicy/getActivePolicies` 输出的嵌套引用修改 active 记录；matcher 也必须对自身消费的启动形态失败关闭。只在 import/load 各补一个值条件，不能保证消费时依赖的 invariant 仍然成立。

## P1：撤销写盘失败后不可重试，重启恢复旧授权

测试在隔离 HOME 正常导入一个策略，再用测试创建的空目录阻挡实际 `policies.json.tmp` 写入。第一次 revoke 正确报告失败，但已经从内存 Map 删除记录，磁盘仍有授权。移除阻挡后，以同一参数重试：

```text
retry revoke: success=false, error='Policy not found: review-retry-revocation'
fresh Node process isPolicyActive(id, 1): true
```

因此“撤销失败时返回错误”是改善，但失败恢复尚未成立。应明确持久提交与内存发布的顺序/回滚/待提交状态，让真实故障消失后可重试，并验证最终成功撤销在独立进程/重启中继续有效。不得以新进程恢复的旧授权代表已完成撤销；也不要求在磁盘仍不可写时谎报撤销成功。

两次 rename 之间的中断和恢复、跨进程维护变更到达既有 host 的 canonical reader 等原 W2 缺口仍保留，未在本轮扩大宣称已验证。

## P1：Windows 校验仍为通过式占位

`validateWindowsStorageDirectory()` 实际只检查 `existsSync(path)` 然后 warning。把这个函数接入 persist/load 没有建立 owner、DACL、reparse、manifest/tmp/backup 文件及祖先不可替换的证明，不能验收为原生校验。

“测试失败，可能是 PowerShell 语法错误”尚无具体 stderr 支撑。下一步应保留并定位真实失败命令、结构化返回/脱敏 stderr 与最小隔离复现，不要先删除保护以恢复绿色。如果失败实际来自 PARENT_REPLACEMENT 等 ACL 拒绝，应处理受支持路径和隔离 fixture 的信任条件，不能当语法错误或把拒绝转成警告继续授信。

已有可复用入口为 `packages/api/src/domains/cats/services/agents/providers/acp/acp-bootstrap-windows-directory.ts` 的同步 `ensureWindowsAcpBootstrapDirectories`，采用 JSON stdin 和固定 PowerShell 源码，避免路径插值。按策略存储对象复用或抽取其检查逻辑；它只验证目录，不能替代文件身份/权限验证，也不能盲用启动特例或临时 cwd 生命周期。不要修改真实 HOME/ACL/runtime 配置来制造通过结果。

## 独立证据与未验边界

本轮：**9 tests，7 pass，2 fail，0 cancelled，0 skip，exit 1**。失败为导入后输入别名修改、撤销失败后重试/新进程恢复。此前 7 项通过，包含真正触发 writer 错误的回归测试。Windows 保护以源码检查明确未实现，不计入这 9 项的原生通过证据。

```powershell
node .tmp/review-pr1669-88e2d6ab3/prepare-checkpoint.mjs
node packages/api/scripts/with-test-home.mjs node --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-88e2d6ab3/checkpoint.test.mjs
```

完整输出和脚本在 `.tmp/review-pr1669-88e2d6ab3/`（`checkpoint.log`）。使用 git show 获取该 SHA 的 store/storage/matcher/pool 源码，仅改模块 URL 并去除 TypeScript 类型，未把旧 dist 作为这些改动的行为证据。真实 writer 与 store 在 runner 新建的临时 HOME 中运行，新进程继承同一隔离 HOME。仅使用合成策略/文件，未启动 DSH、访问真实历史/授权库/账号/生产 Redis，未执行或关闭实际候选解释器。

本轮未重跑完整构建和无改动的池生命周期用例；上一检查点的退役/初始化撤销/计数失衡继续开放。这里没有原机或普通用户 ACL 验收证据。

## 续办要求

继续完成上述同根因修复、原生保护、池生命周期及 F4/W4/W6，再集中给出完整结果和真实精确 HEAD。中途保存检查点后直接续做，不再以“是否继续”作为交接条件。若确有具体外部阻塞，带实际失败证据与受影响范围回传，reviewer 可协助定位；复杂度、猜测和 TODO 不是外部阻塞证据。

`progress-ca0fcc479.md` 的 reviewed_head `ca0fcc479c8c2f9db4a8b9530dcfdfe5762a3f0a` 不是 Git 中该提交的真实 SHA；应使用上面的 `ca0fcc479933ae60e344d7d82660f461153ad1c6`，并纠正“完整事务”等超出证据的完成标记。

整项验收仍未通过，不进入合入、部署或 Issue 关闭。
