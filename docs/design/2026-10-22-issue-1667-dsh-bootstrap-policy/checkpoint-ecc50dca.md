---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: ecc50dca537a7fd38e87d3ca0de7a3a473333f88
status: incomplete
tips_exempt: 实施检查点诊断与续办指引，不构成整项验收或新的流程门禁
---

# 检查点 ecc50dca：继续方案 A，先修持久化边界

本地及远端起审时均确认上述 HEAD。继续已授权的同一 Task；代码保留为检查点，不先合入。步骤 2 尚未完成。本记录是中途存储安全诊断，不是要求作者暂停等待的新一轮完整复审，原未关闭事项与范围仍以 `implementation-review-76f09c25b.md` 为准。

## P1：存储写入失败，调用方却仍报告成功

`bootstrap/acp-startup-policy-storage.ts` 使用 ESM imports，却在重命名阶段调用 `require('fs')`。隔离 HOME 下直接执行该模块的 TypeScript 源码，`persistPolicies()` 实际返回：

```text
success: false
Failed to persist policies: ReferenceError: require is not defined
```

`acp-startup-policy-store.ts#syncToStorage` 吞掉这个失败，`importPolicy/revokePolicy` 已经修改 Map，最终仍返回 `success: true`。这既不是成功导入，也不能证明撤销已持久化；失败的撤销可能在重启后恢复旧授权。

先使用与本模块一致的 ESM API，并将写入结果纳入事务语义：不可在持久化失败后报告成功或留下无法解释的 RAM/磁盘分歧。先移走旧 manifest 再移动 tmp 的两步操作也不构成一个原子替换；应覆盖中断、失败与恢复，不能只在注释里称作原子写入。

## P1：摘要遗漏嵌套安全字段，读入又绕过 schema

`computePolicyHash` 的 `JSON.stringify(policy, Object.keys(policy).sort())` 使用了对所有层级生效的属性白名单；嵌套的 artifact.path/sha256、launchShape.requiredArgs、profileConstraints 等字段被丢弃。

独立测试使用真实 writer 生成的 `.tmp` manifest 和原摘要作为 fixture，未自行计算摘要。正常 manifest 的读取正向对照通过；随后改变 artifact SHA-256、`--profile` 与 noPatch，**不更新摘要**，loader 仍返回修改后的记录。

另一个反例让真实 writer 为 `schemaVersion: 99` 的记录生成摘要，再将该测试 manifest 交给 loader，也被接受。store 初始化随后直接将 loader 返回的对象加入 active Map，未执行导入时的 schema/启动约束。

所有读路径须使用共同的记录校验和规范化规则，摘要覆盖完整嵌套内容。普通自带 SHA-256 只可辅助发现内容变化，不提供授权来源；后者仍由受控入口与可信存储边界保证。

## P1：Windows 存储位置没有获得信任证明

当前仅固定 HOME 路径，并用 `mkdirSync(..., 0o700)` / `writeFileSync(..., 0o600)` 创建文件。没有 Windows owner、原始 DACL、reparse/物理身份、可替换祖先或已有文件的验证。原计划已经明确 HOME 祖先可能不可信，不能凭“位于用户目录”获得信任，也不能用 Unix mode 位代替 Windows DACL。

应复用合适的原生安全检查并在独立 fixture 验证创建、重开和替换边界，既有损坏/不可信存储失败关闭。普通权限主体不可修改或替换的证据仍需取得；本次测试没有修改既有 ACL，也没有用管理员结果冒充普通用户安全验收。

## P1：非空 named 对象仍不等于完整参数约束

`importPolicy` 目前只要求 `requiredArgs.named` 非空；matcher 仍仅在其中存在 `--profile` 时检查完整 argv。代码路径显示 `named: { '--ignored': 'x' }` 可通过导入条件，却不进入实际 argv 检查。

应由同一支持的启动形态驱动输入校验和实际匹配，完整消费所有允许字段；未支持的字段或缺失必要约束拒绝授予例外。不要继续用“对象非空”代替前两轮要求的启动 invariant。这一项是源码路径核对，未计入下述 3 个已运行用例。

## 独立运行证据

检查点用例：**3 tests，0 pass，3 fail，0 skip**，分别复现 ESM 写入失败、嵌套内容篡改未被发现、无效 schema 被载入。第二项包含真实有效 manifest 的正向读取对照。测试故意将安全预期写成断言，失败是上述反例的 RED，不能解释为“环境型 skip”。

```powershell
$testFile = Join-Path (Get-Location) '.tmp/review-pr1669-ecc50dca/storage-checkpoint.test.mjs'
node packages/api/scripts/with-test-home.mjs node --test $testFile
```

材料：忽略目录 `.tmp/review-pr1669-ecc50dca/storage-checkpoint.test.mjs` 与 `storage-checkpoint.log`。测试仅在 runner 新建的隔离 HOME 中放置合成策略文件，未访问真实策略库、原生历史、账号或生产 Redis。直接执行本提交模块源码，不构成本 HEAD 的 build/lint 或原机验收。本轮没有重跑全量构建，未修改作者的生产代码或正式测试。

## 续做动作

1. 先使持久写入、失败回滚/恢复、加载校验与 Windows 可信路径真正成立，再验证跨进程授权变更如何到达既有 host 的 canonical reader；只在模块初始化加载一次不足以证明独立维护命令的撤销会及时生效。
2. 沿原清单继续完成 F4、生命周期剩余边界、W4 和 W6 调查，集中补齐行为验证及必要构建。原计划不要求新建通用签名/MAC 平台，不把它作为开发前置阻塞。
3. 检查点正常提交保存后直接续做同一 Task；中途进度可以直接向人可见地更新，不必每两步重新唤醒 reviewer 询问是否继续。可独立完成的范围齐备、需要精确 HEAD 复审，或遇到带证据的具体外部阻塞时再回传。

Codex 仍负责原托付的独立审核验收。当前不进入 merge gate、不部署、不关闭 Issue。
