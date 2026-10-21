---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667]
doc_kind: technical-plan
created: 2026-10-22
status: proposed
owner: codex
base_commit: 1baaed2e9fadca8b550ae7041ef5a663994ab2d4
source_issue: https://github.com/zts212653/clowder-ai/issues/1667
tips_exempt: 待用户审核的故障修复方案，本文件不改变产品行为
---

# Issue #1667：内网 DSH 的 Windows ACP 启动恢复与版本解耦方案

> 状态：待用户审核，尚未批准实施。当前交付仅为新分支、worktree 和本方案文档。
> 分支：`feat/issue-1667-dsh-bootstrap-policy`。
> 工位：`G:\AIwork\clowder-ai\worktrees\feat-issue-1667-dsh-bootstrap-policy`。
> 基线：上游 main `1baaed2e9fadca8b550ae7041ef5a663994ab2d4`，已包含 PR #1658。

## 1. 要交付的结果与审核范围

让当前内网 DSH 在受影响的 Windows 机器上重新注册、接受 `@dsh` 调用并进入 `@all`；保留原生配置、认证和历史，不要求用户为适配 Clowder 修改系统盘 owner、放宽 ACL 或降级 DSH。

本方案分两阶段：第一阶段用可扩展且有来源证明的审计清单恢复当前安装；第二阶段拆开目录安全与启动行为，并研究 DSH 可验证的配置发现边界。第一阶段完成后仍须交付原机可用结果，不能用后续架构工作代替故障修复。

用户本次授权是“创建 worktree 并写方案供审核”。尚未授权代码实现、部署、重启服务、配置变更或对外发布。本方案中的接口与错误码均为设计提案，不代表现有产品已提供这些能力。

## 2. 已核实的事实与证据边界

| 结论 | 证据与限制 |
| --- | --- |
| 硬编码已进入上游 main | PR #1658 已合入；本方案固定到上述提交，不使用落后的本地 main 作为远端证据。 |
| DSH 准入同时固定版本、编译文件名和哈希 | `acp-bootstrap-startup-policy.ts:11–15,32,53–74,86,103`。只认 `0.2.0-rc.2` 及对应启动文件。 |
| 准入影响目录回退 | `acp-bootstrap-context.ts:43–48` 生成 `allowVolumeRootDelete`；`acp-bootstrap-windows-roots.ts:82–89` 以它决定是否枚举数据卷。 |
| 注册失败能解释群发缺席 | `AcpServiceFactory.ts:285` 在返回 service 前校验；`index.ts:2030–2036` 标记 unavailable；`AgentRouter.ts:1070–1088` 从已有 service 中选择群发目标。 |
| 原机系统盘候选失败、数据卷可通过 audited 检查 | 来源是 #1667 的脱敏日志和诊断报告，本轮未在内网机器复现。 |
| 内网实际安装版本、文件内容与 profile | 公开 Issue 已脱敏，精确值尚未获取；不能据此提前生成可信审计记录。 |
| 单独点名无可见输出 | Issue 报告了该现象；当前 `route-serial.ts:964–987` 已有 unavailable 错误输出和持久化路径，仍需补查原机入口、事件及 UI。 |

两个需要纠正的推断：

- `.CMD` 不等于最终使用 shell。`cli-spawn-win.ts:205–215,254–275,305–339` 已尝试将 npm shim 解析为系统 Node 和 JS 入口；应核实际 spawn plan。
- “系统环境异常，所以不是产品缺陷”不成立。拒绝危险目录有依据，但单构建准入、回退能力耦合和不充分的失败解释属于产品适配问题。

当前因果链是：`构建未被认领 → 未获卷根回退例外 → Temp / ProgramData 均失败后无后续候选 → service 未注册 → @all 缺席`。这不是 ACP 协议不兼容的证明；Pi 的失败也须独立分类，不能归因于 DSH 的版本号。

## 3. 方案取舍

| 路径 | 判断 |
| --- | --- |
| 修改 `C:\` / `C:\Users` owner 或全局 ACL | 不作为默认修法。owner 与 ACL 独立，改 owner 不保证恢复，影响范围也超出本故障。 |
| 仅把硬编码换成当前内网版本 | 只能短暂恢复一个构建，下次升级重现，不作为最终交付。 |
| 删除版本/哈希判断，所有 DSH 一律 audited | 拒绝。原哈希审核承担了启动行为保证，不能在删除后凭包名或握手成功补上信任。 |
| 仅改 TEMP/TMP 或 `.CMD` 配置 | 不足。不能解决构建准入；普通祖先仍有危险权限时也无法通过。 |
| 可扩展审计清单＋受保护的内网记录＋现有目录校验 | 第一阶段推荐。保留已审构建，新增内网构建无需修改业务源码；真实可用仍依赖原机验收。 |
| 目录与启动保证分离，采用可验证的配置发现契约 | 第二阶段方向。不能假设 DSH 已有某个开关，也不把它设为当前恢复的前置条件。 |

关键限制：审计清单解除的是“适配必须改 TypeScript 并重发主程序”的耦合，不代表任意未来构建自动可信。真正减少逐构建审核，需要后续证明启动行为契约稳定且可以强制执行。

## 4. 第一阶段：恢复当前内网安装

### 4.1 先固定真实启动对象

复用现有 command / shim 解析链，不另建一个按 `dsh` 名称猜安装位置的解析器。收集实际可执行路径、JS 入口、参数、shell 模式、包根、依赖解析结果和有效子进程环境；所有判断绑定同一份有效启动计划。

- 可安全解析的 `.CMD` 与直接 Node 启动应归一到同一实际入口，不因扩展名拒绝。
- 不能完整解析的自定义 shell wrapper 返回明确原因；不得执行 wrapper 来猜测其安全性，或静默改选另一份 PATH 安装。
- 不以 catId、成员显示名称、包名或版本字符串单独授予例外。
- 环境检查沿用 Windows 大小写无关、Node hooks、DSH_HOME 和 USERPROFILE 一致性规则；诊断不得输出密钥和完整环境。

### 4.2 将单构建常量替换为可扩展审计清单

生产代码只实现规则与校验；已审核启动链作为数据记录维护。公开默认记录保留当前已审 DSH 构建，内网记录经本地受控导入后补充，不能由项目目录里的任意文件覆盖默认策略。

一条记录至少包含：

| 字段组 | 用途 |
| --- | --- |
| schemaVersion / policyId / revision | 规则演进、撤销、日志和池失效的稳定身份。 |
| provenance / evidenceRef | 谁审核、依据什么源码与初始化证据、授权来源；不是扫描后自动“可信”。 |
| launch shape | 允许的入口解析方式、精确参数形态、环境约束。 |
| artifacts | 已审核启动闭包的文件及 SHA-256；编译变体名来自记录，不写入业务函数。 |
| profile constraints | bundles、patch、配置与自定义模块的适用边界；需要纳入审核的内容须绑定指纹。 |
| assurance | 本记录证明的启动行为，例如不读取共享祖先配置；不能仅写“ACP 可用”。 |

版本号保留为诊断元数据；匹配依赖被审核的内容与约束。启动闭包需追到实际加载的依赖，不能把现有五个文件当作所有新构建都充分的固定清单。

内网导入的信任边界：

1. 采集文件和哈希只产生“待审核候选”，不会自动授予权限。
2. 由获授权的审核者确认源码/依赖/profile 与初始化行为，记录明确证据，再由实例所有者受控导入。
3. 策略存储须有原生权限与路径完整性验证；若默认 HOME 祖先不可信，不能仅凭“写在 HOME 下”视为可信。应选择验证通过的私有存储位置，校验失败则拒绝导入。
4. 项目文件、agent 输出、安装包的自我声明均不能自签信任。批量企业分发如有需要再设计离线签名，不为本次恢复先建设通用证书平台。
5. 内网精确路径、版本、哈希及内部模块信息留在受保护的本地记录；公开 PR 只含规则、合成 fixture 和脱敏证据。

### 4.3 保留原生配置语义

不得删除 patch、重建 HOME、替换认证或强制使用空 profile 来获得通过。默认 bundles / 无操作 patch 可复用既有约束；当前内网 profile 若有扩展，须审核其真实加载内容，不能把未覆盖的安装宣称修复。

清单准入通过后，使用现有自动回退：用户 Temp → ProgramData → 已验证的非系统 NTFS 固定卷。数据卷候选采用卷根直属私有目录，不把全局 TEMP/TMP 重定向作为交付前提。

目录检查继续要求：私有 root/cwd 的当前用户 owner、protected DACL、非 reparse；真实卷身份由原生句柄核验；普通祖先仍检查完整危险权限；卷根仅排除自身 DELETE，保留 DELETE_CHILD、WRITE_DAC、WRITE_OWNER 与 owner 校验。

已有私有目录损坏或校验器不可用时不得迁移掩盖问题。显式 root 保持明确位置、失败即返回原因；不自动接管 owner、修复既有 ACL 或扩大可信主体集合。

### 4.4 失效、池与冷启动契约

| 事件 | 必须发生的状态变化 |
| --- | --- |
| 清单或安装未变化 | 允许复用匹配启动计划、cwd 与策略指纹的池。 |
| 入口、依赖、profile 或有效环境变化 | 旧准入结果失效；实际 spawn 前复验失败，不能沿用旧布尔值。 |
| 策略修订、撤销或安装升级 | 池签名包含 policyId / revision / 指纹；阻止新租约进入失效池，按现有取消/退役机制收敛旧池，不自动重放用户消息。 |
| bootstrap cwd 被移除 | 在冻结的原 root 下重新校验/创建；不得在冷启动时静默换盘。 |
| 策略缺失、损坏或来源不可验证 | 返回结构化诊断；仅在严格目录路径可用时按严格模式运行，不降低安全要求。 |

保留两个 client 在真实 spawn 前的复验。文件哈希检查不等于完全消除检查与使用间竞态；还须核安装目录可写边界，并在安全审查中说明剩余风险。

### 4.5 诊断与可见性

将现有 `undefined` 改为可区分的判定，例如 `strict`、`audited` 或带原因的拒绝结果。建议原因包括 `LAUNCH_UNRESOLVED`、`SHELL_WRAPPER_UNSUPPORTED`、`BUILD_NOT_AUDITED`、`ARTIFACT_CHANGED`、`PROFILE_UNSUPPORTED`、`STARTUP_ENV_UNSAFE`。

诊断同时保留“启动链为什么未获例外”和“各候选目录为什么失败”。仅显示 `No trusted ... root` 无法解释新版 DSH 的真实阻塞点。

可用状态继续由 AgentRegistry 管理，不新建第二份 available 状态。复用已有 unavailable 错误通路，核对点名发送、公共会话、队列恢复与 UI 展示；`@all` 不向失败 service 派发，但应说明跳过的成员和原因。Pi 的 built-in bridge 与外部 adapter 分别给出判定。

## 5. 第二阶段：分离目录安全和启动行为

Architecture cell：Windows ACP bootstrap 的候选目录、启动策略和进程池边界。

Map delta：目录层只证明文件系统位置安全，启动层证明 CLI 对配置的发现边界；由 bootstrap 编排层组合两者。Why：当前单个 `allowVolumeRootDelete` 同时表达构建可信、物理卷规则和候选枚举，职责耦合。

建议流程：`解析有效启动计划 → 枚举候选 → 校验目录物理安全 → 核该候选需要的启动保证 → 冻结策略/cwd/指纹 → 注册和 spawn 前复验`。

- 枚举非系统卷与 DSH 版本无关；未获启动保证的进程可以尝试严格规则合格的候选。
- 若某候选需要共享卷根例外，则必须有有效的启动保证；不能因目录物理安全就跳过配置发现检查。
- generic ACP 无匹配保证时仍拒绝该例外，但应返回 `STARTUP_ASSURANCE_REQUIRED`，而不是误报为所有磁盘均不可用。
- 为 DSH 调查显式配置根、禁止祖先发现或受控初始化模式的真实支持；不虚构 CLI 参数，不信任外部进程自报一个 capability 就自动放行。
- 在契约获得源码、攻击 fixture 和真实初始化证据前，继续使用第一阶段审计记录。通用 launcher 自己设置 cwd，不能阻止子进程主动向上读取配置。

这个阶段可以改善其他 ACP provider，但本 Issue 不扩大为统一 Agent 会话或 ACP 协议迁移。

## 6. 实施工作单元与并行变更

| 单元 | 改动位置 | 可观察结果 |
| --- | --- | --- |
| W0：原机取证与 RED | 实际 spawn plan、本地安装/profile 证据、回归 fixture | 区分 shim、构建准入与目录错误；重现当前安装不能注册。 |
| W1：结构化策略与清单 | `acp/bootstrap/acp-bootstrap-startup-policy.ts` 及按职责拆分的 helper | 保留旧构建；两个不同构建可各自凭有效记录准入，未审核安装不会自动变可信。 |
| W2：内网受控导入 | 经审核确定的本地策略存储与导入入口 | 离线完成当前安装的审核、导入和撤销；项目文件不能自授权。 |
| W3：池与回退集成 | `acp-bootstrap-context.ts`、`acp-bootstrap-windows-roots.ts`、`acp-pool-signature.ts`、Factory / 两个 client | 指纹参与池复用；原机合格数据卷可被选择；变化在真实 spawn 前失效。 |
| W4：错误展示与路由 | registry、既有路由错误链及相关 UI consumer | 点名失败有可见原因，群发可解释跳过对象，不创建假 service。 |
| W5：原机验收与交付 | 当前 worktree 的测试/构建、隔离实例、证据与回退记录 | 完成第 7 节后才声明恢复；不以本地合成测试代替内网结果。 |
| W6：第二阶段 | 目录层/启动层分离与 DSH 契约调查 | 明确可验证接口与安全证据，再决定后续落地范围。 |

2026-10-22 已读取在飞 PR 的 changed files：#1665 涉及 `index.ts`、ACP service/pool 与会话契约；#1596 涉及 Factory、两个 client、pool signature 与路由错误链。以上是文件重叠线索，不是审核或合入结论。实施前须重新确认状态和 exact HEAD，以窄改动接入，避免重做其会话/取消逻辑。本轮仅写新文档路径，未联系其他任务、修改这些 PR 或发布评论。

## 7. 验证与关闭条件

| 层级 | 必须覆盖 | 能证明什么 |
| --- | --- | --- |
| 单元/fixture | 旧构建、另一构建、未审核构建；可解析 shim、直接 Node、自定义 shell；策略来源与撤销；profile/env/依赖变化 | 判定与失效行为；不能证明真实内网 DSH 可用。 |
| Windows 原生目录 | 真实固定 NTFS 卷正向；普通祖先危险权限、未知 ACE、null DACL、junction、SUBST、损坏私有目录反向；既有 ACL 前后比对 | 私有目录和回退边界；管理员结果不能代替普通用户/第二账户验证。 |
| 真实初始化 | 当前内网安装；共享祖先 `.env`、指令、skills 攻击 fixture；有效 profile 和实际入口 | 审计记录覆盖该安装的初始化行为；不以 ACP 握手代替发现边界验证。 |
| 产品路径 | service 注册；`@dsh`、`@all`；失败提示；Pi 与其他 provider 回归 | 用户旅程和失败可见性。 |
| 连续性 | 一次最小模型往返、工具事件、取消、进程重连、历史回读 | 本次安装的运行与续接结果；不自动外推未来版本。 |

先观察精准 RED，再做最小 GREEN；不得修改测试把“当前内网构建被拒绝”改写为期望成功。清单单元测试用合成安装覆盖多构建，不依赖机器预装 DSH；Windows CI 的环境型测试可跳过，但原机必需项不能以 skip 验收。

实施时按已确认脚本执行 `pnpm --filter @cat-cafe/api build`、受影响文件的 `pnpm biome check <文件>`、`pnpm lint` 和项目要求的 `pnpm check`。定向测试沿用：

```powershell
node --import ./packages/api/test/helpers/setup-cat-registry.js --test --test-concurrency=2 --test-timeout=90000 packages/api/test/acp/acp-bootstrap-startup-policy.test.js packages/api/test/acp/acp-bootstrap-relocation.test.js packages/api/test/acp/acp-bootstrap-spawn-recheck.test.js packages/api/test/acp/acp-bootstrap-ancestor-security.test.js packages/api/test/acp/acp-bootstrap-volume-root.test.js packages/api/test/acp/acp-registration-availability.test.js packages/api/test/acp/acp-pool-signature.test.js packages/api/test/cli-spawn-win.test.js
```

新策略来源、撤销、变更失效及路由/UI 用例另补对应测试。命令运行在独立工位、私有 fixture 和开发环境中；未具备依赖或原生 fixture 时记录阻塞，不借用生产数据凑通过。

Issue 关闭要求：原机当前安装、普通用户条件下注册成功；点名与群发成功；失效/拒绝提示可见；初始化安全与连续性证据齐全；交付包源码 SHA、包哈希、最终运行目录、实例身份和回退方案均可回读。

## 8. 运行、数据与回退边界

- 本轮没有安装依赖、构建产品、启动服务、调用模型、修改配置、创建测试会话或触碰 Redis。
- 后续开发实例使用 Redis 6398 及独立 API/Web 端口；3003/3004 和生产 Redis 6399 不作为未合入改动的验证环境。启动前查重，登记源码 SHA、包哈希、目录、数据根、端口、PID、用途和保留状态。
- 真实调用前核对 DSH 原生 HOME 与历史根；Clowder Redis 隔离不代表 DSH 会话隔离。复用认证的同时若共享原生历史，先确认测试清单和可恢复归档方案。
- 回退撤销新增策略、停止新租约并按既有池机制收敛，部署回退另按实际交付包执行。不得 flush/reset 数据、删除 HOME/SQLite/会话或按通用进程名结束服务。
- 禁止为恢复而自动修改系统 owner/ACL、扩大可信 SID、重写原生 profile、覆盖 runtime、降级 DSH 或删除历史。遇到无法满足的原机条件，给出具体阻塞及替代方案，不把测试成功包装成原机已恢复。
- 当前工位保留供用户审核，负责人 codex；计划于 2026-10-29 复查，保留/释放以工位生命周期回执为准，不自动清理用户资料。

## 9. 请审核的四项决定

- [ ] 同意第一阶段采用“有来源证明的可扩展清单＋受控内网导入”，恢复当前安装并保留既有安全检查。
- [ ] 同意目录与启动保证分离作为第二阶段；不把自动信任未来所有版本作为第一阶段承诺。
- [ ] 同意将失败可见性纳入交付；原机点名无输出的具体丢失点仍需取证。
- [ ] 同意以当前内网安装的真实验收为完成边界，未覆盖时保持 Issue 开放。

## 10. 证据入口

- [Issue #1667：故障、原机脱敏日志和现有修复建议](https://github.com/zts212653/clowder-ai/issues/1667)
- [PR #1658：已合入的 Windows bootstrap 修复](https://github.com/zts212653/clowder-ai/pull/1658)
- [固定基线：启动策略](https://github.com/zts212653/clowder-ai/blob/1baaed2e9fadca8b550ae7041ef5a663994ab2d4/packages/api/src/domains/cats/services/agents/providers/acp/bootstrap/acp-bootstrap-startup-policy.ts)
- [固定基线：启动上下文](https://github.com/zts212653/clowder-ai/blob/1baaed2e9fadca8b550ae7041ef5a663994ab2d4/packages/api/src/domains/cats/services/agents/providers/acp/bootstrap/acp-bootstrap-context.ts)
- [固定基线：候选目录](https://github.com/zts212653/clowder-ai/blob/1baaed2e9fadca8b550ae7041ef5a663994ab2d4/packages/api/src/domains/cats/services/agents/providers/acp/bootstrap/acp-bootstrap-windows-roots.ts)
- [固定基线：Windows 原生目录校验](https://github.com/zts212653/clowder-ai/blob/1baaed2e9fadca8b550ae7041ef5a663994ab2d4/packages/api/src/domains/cats/services/agents/providers/acp/acp-bootstrap-windows-directory.ts)
- [固定基线：原独立安全审查及原机未验证项](https://github.com/zts212653/clowder-ai/blob/1baaed2e9fadca8b550ae7041ef5a663994ab2d4/docs/bug-report/issue1653-independent-security-review.md)
- [Microsoft：真实卷根不能重命名](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information)
- [Microsoft：文件与目录访问权限](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)
