---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667]
doc_kind: plan-review
created: 2026-10-22
reviewer: codex
reviewed_base: 1baaed2e9fadca8b550ae7041ef5a663994ab2d4
reviewed_plan_sha256: b7369dc8c042707addea51faceb921fc59a461310bb9c25cddcc17b6560a4794
verdict: approved-for-implementation
tips_exempt: 方案审查及实施交接记录，不新增产品能力
---

# Issue #1667 方案审查与实施约束

## 结论与授权

**方案通过；未发现需要退回重设计的 P1/P2 问题。**本结论批准进入实施，不代表代码安全审查、运行验收或原机恢复已经完成。

审查对象为同目录 `technical-plan.md`，内容指纹见 frontmatter。已核对实际代码、既有安全审查、Issue 原文及相关 PR 当前状态。

2026-10-22 当前对话中的用户指令明确委托：方案通过后交 Claude 实施并提交 PR，随后 Codex 审核验收。这条新授权覆盖计划中“尚未授权实施”的旧状态；计划正文保留为被审版本。实施范围为第一阶段 W0–W5，以及 W6 所述的第二阶段调查，不提前承诺尚未证明的 DSH 配置发现契约。部署、重启、修改运行配置、导入真实实例策略与关闭 Issue 仍不在本次开发授权内。

实施者为 `claude-code`，PR 审查与验收由 `codex` 负责。实现完成后提交 PR 并回传本 thread，不自行合入或关闭 Issue。

## 核实结果

1. 当前 HEAD 为 `1baaed2e9fadca8b550ae7041ef5a663994ab2d4`，确为 PR #1658 的 merge commit。
2. `auditedWindowsAcpStartup` 硬编码版本、编译变体及哈希，`verifyAcpBootstrap` 将其结果转换为 `allowVolumeRootDelete`；候选数据卷枚举也受此布尔值控制。故计划提出的构建准入与回退耦合有代码依据。
3. `resolveWindowsSpawnPlan` 能把可解析 npm CMD shim 转为 Node + 入口；不能依据 `.CMD` 后缀断定最终存在 shell。
4. Factory 在返回 service 前验证 bootstrap；注册失败会进入 AgentRegistry 的 unavailable 通路。`route-serial.ts` 已有可见 error 事件和消息持久化分支，因此原机“点名无输出”的具体丢失点仍需取证，不能认定该分支不存在。
5. 两个真实 spawn consumer 是 `AcpClient.ts` 和 `AcpHttpStreamClient.ts`。当前 pool signature 已含 cwd / bootstrapIsolation，但尚无新策略清单的修订与撤销机制。
6. Microsoft 的 FILE_RENAME_INFORMATION 文档明确真实卷根不能重命名；代码仍须通过原生卷身份核验限定例外，不能将字符串盘符、junction 或 SUBST 当作真实卷根。

第 6 项一手依据：<https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information>。另一篇计划引用的 File Security and Access Rights 页面本轮抓取失败，未将其视为新取得的证据。

## 必须落到实现和测试的边界

以下是原计划安全承诺的具体化，不是另开功能范围。实现偏离时应作为 PR finding 处理。

- **采集与授信分开。**候选生成器只输出待审材料；`provenance` 字符串、哈希扫描成功、项目文件和安装包声明都不能成为权限凭据。真实策略仅由实例所有者明确受控导入，开发猫本次不替用户执行。导入入口、存储定位、重复 policyId、损坏记录和撤销规则须在实现文档中具体说明，避免项目 cwd / 环境搜索自动捡到策略。系统权限保护的威胁模型应明确：不声称仅凭当前用户 DACL 能隔离同一 SID 的恶意进程。
- **绑定真正会执行的对象。**准入、池指纹和两个 spawn consumer 使用同一规范化计划，覆盖实际解释器身份、入口、加载依赖、profile、参数与有效环境。只记录原始 CMD 路径或仅比较 Node 文件名不构成该绑定；不能悄悄解析到 PATH 上另一安装。复用现有 resolver，避免另建一套发现顺序。
- **撤销必须覆盖热池。**仅将 policyId/revision 加入签名或只在冷启动前重验，不足以兑现原计划。清单撤销/修改后，已有存活池的下一次 acquire 也必须受控失效；复用既有退役与取消语义处理在途请求，不自动重放。须有“已有进程存活、无需新 spawn 时撤销策略”的回归故事。
- **严格路径与例外分开。**未知构建可在严格检查合格的路径运行；它不能获得共享卷根例外。已有私有目录损坏、未知 ACE、null DACL、reparse 或校验器失败，不得转成“换个盘继续”的成功。不要扩大可信 SID 或修改现有 owner/ACL。
- **用户旅程与错误链共用真相源。**AgentRegistry 继续负责 available；先追踪点名和群发的实际事件/持久化/UI consumer，再补缺口。不要为解决提示问题重写会话、取消或 ACP 协议。

## Architecture admission 与 consumer evidence

Architecture cell: Windows ACP bootstrap policy、目录选择和池生命周期。

Map delta: 第一阶段将固定启动策略数据提取为清单，并增加受控导入及失效输入；第二阶段的目录/启动职责分离保持计划所述调查边界。

Why: 解除单构建硬编码，同时保留唯一授信判定和唯一 available 状态。

Canonical source: 当前 `bootstrap/acp-bootstrap-startup-policy.ts#auditedWindowsAcpStartup`；编排者为 `bootstrap/acp-bootstrap-context.ts#verifyAcpBootstrap`。实施时一个 canonical reader 消费清单，受控导入是唯一新增 writer，不让 Factory、client 和 UI 分别决定信任。

Consumer evidence（已运行的 census，路径根为 `packages/api/src/domains/cats/services/agents/providers/acp`）：

```powershell
rg -n 'auditedWindowsAcpStartup|verifyAcpBootstrap|verifyBootstrapCwd|createAcpPoolSpawnSignature' packages/api/src/domains/cats/services/agents/providers/acp
rg -n 'acquire\(|retiring|retireWhenIdle' packages/api/src/domains/cats/services/agents/providers/acp/AcpProcessPool.ts
```

关键输出：`acp-bootstrap-context.ts:43,63` 为初审/复验；`AcpServiceFactory.ts:182,219,285` 为签名、校验注入及注册；`AcpClient.ts:282`、`AcpHttpStreamClient.ts:152` 为实际 spawn 前复验；`AcpProcessPool.ts:158–160,345–347` 为 acquire / retiring 边界。实施改符号后重新跑 census，覆盖新 reader / writer 的调用点。

Characterization/contract tests: 计划第 7 节的现有 startup-policy、spawn-recheck、relocation、ancestor-security、volume-root、registration-availability、pool-signature 与 cli-spawn-win 测试。当前 worktree 没有 `node_modules` 和 API dist，本轮未执行这些测试，也未把静态审查报成通过。

Claim guard（以下是实现者先观察 RED、再交付 GREEN 的要求，本轮尚无执行结果）：

| 承诺 | 有检测力的反例 |
| --- | --- |
| 授信有来源且不能自动产生 | 相同文件和哈希，只有项目内候选或伪造 provenance 时仍拒绝例外；不可信存储/重复冲突记录不能取得授信。 |
| 真实启动对象一致 | 审核后替换解释器、入口、已加载依赖、profile 或有效环境，两个真实 spawn 入口均拒绝旧准入。 |
| 清单撤销及时生效 | 已有热进程时修订或撤销清单，下一租约不能继续复用原授信；在途消息不被重放。 |
| 未审核构建仍失败关闭 | 未审核构建不能获得卷根例外；严格候选存在时仅使用严格规则。 |
| 注册失败可见 | 点名失败能在实际消费链被展示和回读；群发能解释跳过对象，且没有假 service。 |

## 并行工作与交付

本轮实时读取上游：#1658 已合入；#1665 OPEN，HEAD `549d0addccf56eaaf235493d662213a89186976b`；#1596 OPEN，HEAD `d2d7f5e2c087a1b8501ca9f2bebaf9175c3613fc`。实施接触共享文件前重查，禁止据此推断审核通过或未来合入结果。

GitHub 目标为 `zts212653/clowder-ai`，本地 origin 为 `whutzefengxie-ops/clowder-ai`、upstream 为目标仓。当前认证账号 `whutzefengxie-ops` 对目标有 WRITE 权限，且为 Issue 作者；这是用户授权的本地猫修复链，不是接管陌生贡献者的 PR。使用 `C:\Program Files\GitHub CLI\gh.exe`，实现分支推 fork 后向上游 main 提 PR。中文正文用 UTF-8 无 BOM 文件提交并远端回读。

内网精确安装、profile、哈希和普通用户验收尚缺。本地实现与合成安全回归可以继续；不能扫描一份本机安装后宣称其代表内网当前安装。PR 交付带精确 HEAD、RED/GREEN 证据、未验证项、包来源与回退说明，回传 Codex 审核。原机缺项未补齐前保持 Issue 开放，不在 PR 写自动关闭关键字。

本轮只新增此审查记录；没有安装依赖、构建、启动服务、调用模型、修改 runtime/config、导入策略或触碰 Redis/原生历史。
