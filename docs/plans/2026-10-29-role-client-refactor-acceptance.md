---
feature_ids: []
topics: [角色身份, Agent接入, 会话契约, 实施, 验收, 迁移]
doc_kind: implementation-acceptance
created: 2026-10-29
---

# 角色配置与 Agent Client 接入重构：实施与验收闭环（20261029）

本文件是[综合重构方案](file:///C:/Users/Administrator/Desktop/猫猫咖啡馆/技术方案/综合重构方案-20261029/重构技术方案.md)（下称"方案"）在本仓库的实施记录与验收闭环。**结论先行**：W1/W2/W3 的契约核心已落地并有 Host 级确定性测试与门禁证据；W4–W7（存量客户端真实回归、CodeAgent 内网、真实工程质量样本、小范围启用与回退演练）**未执行**。`E`/`Q` 系列与需要真实客户端的 `C` 项一律标为 `BLOCKED`/`NOT_RUN`，不把"链路/类型通过"当成产品验收。

## 1. 基线与环境（W0）

| 项 | 值 |
|---|---|
| worktree | `G:\AIwork\clowder-ai\worktrees\feat-role-client-refactor-20261029-deepseek-flash` |
| 分支 | `feat/role-client-refactor-20261029-deepseek-flash` |
| 目标基线 | `6d8d4915bcd84edfeb42edf76466cf6318cecdbd`（upstream/main，`f79830a77` 的下一提交 daily sync #1738） |
| 方案声明的评审基线 | `f79830a77ee1b53c5eb630a555aa89d17d6ef53b`（方案 §1）；本实施先核对 `6d8d4915b` 相对 `f798` 的差异，核心配置/会话/成员/ACP 路径不变 |
| 本机 `main` | `44fb36e65`（2026-10-21，比评审基线旧 51 个 sync 提交）——**不作为实施基线** |
| 工具链 | node v24.16.0 / pnpm 9.15.4；`pnpm install --frozen-lockfile` 通过 |
| 环境限制 | Windows `core.autocrlf=true` 使工作树为 CRLF，`pnpm check` 的 biome `format` 规则会对**未修改文件**报错，因此本地门禁用 `biome lint` + tsc/build + 定向 node:test；格式权威留在 Linux CI。`bash` 是失效的 WSL，api 测试改用 `scripts/with-test-home.mjs`，L0 测试脚本类用例中调用 bash 的用例属环境失败 |

### 1.1 方案引用落点核对（W0 要求）

方案"实施与验收 §1.1"引用的文件在本基线全部存在且路径未变：`cat.ts`、`runtime-cat-catalog.ts`、`cat-config-loader.ts`、`compile-system-prompt-l0.mjs`、`SystemPromptBuilder.ts`、`useMemberEditor.ts`、`MemberCreationPage.tsx`、`execution-account-binding.ts`、`AcpAgentService.ts`、`AcpClient.ts`、`session-contract/{types,AgentSessionBridgeService,implementation-registry,registered-session-agent-service}.ts`、`SessionManager.ts`、`AcpServiceFactory.ts`、`plugin-agent-provider.ts`。唯一例外：`native-codeagent-discovery.ts` 只存在于内网分支 `feat/intranet-windows-codeagent`（`c2c1e9f4`），本分支没有 CodeAgent 接入代码，因此 W5 只做设计对齐、不做实现。

### 1.2 存量客户端矩阵（静态，未运行）

`cat-template.json`（基线）含 10 个 breed / 20 个 variant，`clientId` 覆盖 `anthropic`、`openai`、`google`、`opencode`、`antigravity`、`kimi`；均无 `acp` 段。ACP 成员（含 A2A/其他 carrier）来自用户运行时 catalog（`cat-catalog.json`，仓内无样本），因此**无法从仓库静态证明任何 ACP 绑定的版本、账号、状态根与能力**。矩阵中每个组合的真实回归属于 W4/W0 实测，本文件不宣称已覆盖（C14/E02 见 §3/§4）。

### 1.3 修改前基线证据

在**独立 pristine worktree**（`baseline-6d8d-refactor-w0` @ `6d8d4915b`，独立 node_modules + dist）运行同一组 56 个受影响测试文件：

- 结果：`tests 666 / pass 646 / fail 16 / skipped 4`
- 16 个失败全部为环境/平台既有问题：14 个 `client-library-home-capabilities`（Windows ACP bootstrap 临时目录 ACL 判定）+ 2 个 `l0-pipeline-equivalence`（CRLF 检出的 section 边界断言）。

修改后同组：`tests 671 / pass 651 / fail 16 / skipped 4`，**失败集合与基线逐条相同**（新增 5 个用例全部通过），无回归。

## 2. 工作包状态

| 包 | 状态 | 已落地 | 未落地/边界 |
|---|---|---|---|
| W0 基线与样本 | 部分完成 | 基线 SHA、落点核对、静态客户端矩阵、修改前测试基线、命令与环境记录 | 运行时版本/账号/状态根实测；C14 存量矩阵实测 |
| W1 角色与保存 | 部分完成 | RoleProfile/ExecutionProfile 纯投影与字段来源；身份权威（显式配置优先、dossier 冲突抑制与预览）；L0 identity block 应用同一权威；S1/S2/S3 服务端局部 CAS（428/409）+ 编辑器分步台账/超时读回/创建按 catId 查重 | 全局设置"影响范围"展示仍沿用旧 UI 文案；`available` 开关、遗留 `HubCatEditor` 等非正式写入方仍走过渡性盲写（无 header）；E01 未跑 |
| W2 冻结与权限 | 部分完成 | ACP 权限默认 fail-closed + 显式 `permissionPolicy: auto_allow`（含池签名失效）；AcpAgentService 在 `pool.acquire` 前冻结 configurationSource/model/effort；L0 **冻结输入模式成为真实调用默认**（`--frozen-input` v1，子进程不再重读 registry），缺失/版本不符/篡改在发送前失败；L0 依赖签名纳入成员配置内容哈希 | MCP 计划仍在租约后按 `capabilities.json` 解析（#712 invoke-time refresh）→ C05 的 MCP 子项为残余；实现 generation 未纳入统一冻结快照（仅 ACP 池签名）；C15 部分 |
| W3 会话语义 | 部分完成 | 兼容键（keyVersion=1，结构字段白名单）、片段决策矩阵、桥接 open 缓存按 digest 失效/新开片段、resume 按调用方 fail/start_new、取消阶段与"未确认不提前释放 busy"、不再编造原生 handle、continuity 回调、SessionRecord 可选 `compat/identityArtifact/fragmentSwitch` 及内存/Redis 追加字段 | `invoke-single-cat` 尚未读写这些字段（无生产消费者接线）；无客户端声明 `identityUpdate:'in_place_verified'`；事件投影未转发 execution/parent id；真实取消/续接未实测 |
| W4 存量适配 | 未开始 | 仅跑 Host 级既有 ACP/契约回归套件（见 §6） | 各客户端真实纵向切片、C14/E02 |
| W5 CodeAgent | 不适用（本分支） | 设计对齐：不把 CodeAgent 映射为 iCode；acp 声明用既有 schema | 无插件声明/发现/企业认证实现（需内网分支与真实环境） |
| W6 质量与恢复 | 部分完成 | 确定性契约用例、门禁、基线对比、残余风险清单 | Q01–Q04 工程任务样本未执行 |
| W7 启用与回退 | 未开始 | 回退方案见 §8 | 小范围启用、降级/回退演练 |

## 3. 契约用例验收矩阵

状态定义：`PASS`=Host 级确定性测试通过；`PARTIAL`=部分子项通过、存在明确未接线或未覆盖子项；`BLOCKED`=需要真实客户端/运行环境；`NOT_RUN`=本次未执行。

| ID | 状态 | 证据与说明 |
|---|---|---|
| C01 | PARTIAL | `fragment-decision`/`compatibility-key` 矩阵测试覆盖"换客户端/模型/账号 → 新片段、catId/Host 身份不变"的 Host 判定；真实二次调用未跑 |
| C02 | PASS（Host 级） | `member-identity-resolution` 单测：显式 roleDescription/personality 胜出、冲突 dossier 自述被抑制并可预览、无显式身份时保留 legacy dossier 来源标记；L0 冻结渲染 vs 旧路径字节等价（无冲突场景） |
| C03 | PASS（Host 级） | 投影来源（config/inherited/default）、variant 覆盖、null/undefined/空值语义单测；成员 catalog 写路径未改 |
| C04 | PARTIAL | web 保存编排测试覆盖 S1/S2/S3 成功/失败/409/428/超时读回/创建超时按 catId 查重（未重复 POST）；真实页面 E01 未跑 |
| C05 | PARTIAL | pre-lease 冻结单测：租约等待期间修改 model/effort/configurationSource 不污染已准入调用、下一调用取新值；MCP 暴露计划仍在租约后读取（残余） |
| C06 | PASS（Host 级） | 冻结输入缺失/版本不符/摘要篡改在 spawn 前失败；冻结渲染与 legacy 渲染字节一致；live catalog 变更不改变已冻结渲染；成员配置内容哈希进入 L0 依赖签名 |
| C07 | PARTIAL | 头像/无关字段复用、身份/模型/账号/工作区/权限变化的新片段矩阵单测；无真实客户端更新/恢复证据 |
| C08 | NOT_RUN | 未改 AGY 严格校验；`agy-acp-client` 回归 6/7（1 个 POSIX 路径用例在 Windows 基线同样失败）；delayed_done/resume/seal/取消的真实行为未验证 |
| C09 | PARTIAL | 无 handler/无显式 auto_allow → 拒绝或取消（不编造 allow）；非法/缺失策略 → deny；iCode 强制 reject；显式 `auto_allow` 保留 allow_always/once。无交互审批通道，真实 provider 等待行为未验证 |
| C10 | PARTIAL | 桥接不再复用"新指令 + 旧缓存 instructions"；无 adoption artifact 时 identity 变化 → 新片段（单测）；无客户端声明已验证原地更新，故全部按新片段处理 |
| C11 | PARTIAL | 既有 input/accepted/read/unknown 语义与"unknown 不自动重发"保持；桥接层新增单测；无真实客户端迟到回执 |
| C12 | PARTIAL | 取消请求立即停止接收输入，busy fence/dispatcher 在 provider 确认后释放；未确认 → `cancel_unconfirmed` 保持忙碌（单测）；真实进程终止未测 |
| C13 | PASS（Host 级） | 兼容键排除 callback token/deliveryId/临时路径/头像；临时值变化不触发重建（单测） |
| C14 | NOT_RUN | 需要逐客户端真实最小旅程；本文件不宣称存量回归通过 |
| C15 | PARTIAL | 权限策略进入 ACP 池签名（撤销 auto_allow 会重建池）；实现 generation 未统一进冻结快照；真实插件升级时序未测 |
| C16 | NOT_RUN | 崩溃恢复/未知旧会话需真实 Host+Redis+客户端 |
| C17 | PARTIAL | S1/S3 在进程内原子（成员 mutation lock / 同步 configStore）；S2 是 compare-then-write，并发正式写入存在窄丢失窗口（见 §7）；428/409、旧盲写过渡兼容有路由测试 |
| C18 | PARTIAL | `GET /api/cats?catId=` 查重与创建超时接管有服务端+web 测试；全局设置"影响使用该客户端的成员"仅保留旧文案 |
| C19 | PARTIAL | 片段切换原因类型与回调已就绪；上下文交接（继承必要摘要、不回放副作用）未接线 |
| C20 | NOT_RUN | MCP 直接/deferred、未声明能力、工具权限变化的真实面未验证 |
| C21 | NOT_RUN | CodeAgent 声明/发现/非法引用需内网分支与真实插件样本 |
| C22 | NOT_RUN | 企业代理/CA/认证轮换、无外网需真实环境 |
| C23 | NOT_RUN | PATH 双版本/Windows shim/macOS 启动未测 |
| C24 | NOT_RUN | 工具 execution/parent 关联投影未转发新字段（明确残余） |
| C25 | NOT_RUN | DSH persona 与 secret guard 多 patch 合成需真实版本 |
| C26 | PARTIAL | model/effort 分别保留请求事实（pre-lease 冻结）与原生观察值（adoption 路径未变）；空偏好/仅 effort/仅 model 的 UI 语义未新增测试 |

## 4. 真实旅程（E）与工程质量（Q）

全部 `BLOCKED`/`NOT_RUN`，原因统一为：本任务未启动 Host/服务、未驱动真实客户端、未进入企业网络；按方案要求不把模拟替代真实。

| ID | 状态 | 原因/下一步 |
|---|---|---|
| E01 成员完整配置旅程 | BLOCKED | 需要运行中的 GUI+API+真实成员；web 侧已有编排单测，缺真实保存/DOM 证据 |
| E02 多客户端协作 | BLOCKED | 需要至少一个 native 与一个 ACP 真实绑定及账号 |
| E03 CodeAgent 内网 | BLOCKED | 本分支无 CodeAgent 接入；需内网分支 + 企业 CA/代理/状态根 |
| E04 迁移与回退 | BLOCKED | 需旧配置实例 + 启用/禁用演练；本变更无数据迁移脚本，回退说明见 §8 |
| Q01–Q04 | NOT_RUN | 未建立固定任务仓库/隐藏验收；不得用链路测试代替 |

## 5. 交付内容清单

- **W1 身份与保存**
  - `packages/shared/src/types/member-profile.ts`：`RoleProfile`/`ExecutionProfile` 纯投影类型 + 字段来源 + 预览。
  - `packages/api/src/config/member-profile-projection.ts`：有效成员 + breed/variant → 投影（纯函数）。
  - `packages/api/src/config/member-identity-resolution.ts`：显式配置 > dossier；冲突抑制；legacy 兼容来源标记。
  - `scripts/compile-system-prompt-l0.mjs`：identity block 使用身份权威结果；`--frozen-input` v1 渲染路径（不 bootstrap registry，版本/catId/projection/digest 校验，失败退出码 3/4）。
  - `packages/api/src/config/config-write-revision.ts`、`routes/{cats,config,session-strategy-config}.ts`：S1/S2/S3 局部 CAS（428/409、`x-clowder-formal-edit: 1`、GET 写版本、`GET /api/cats?catId=`）。
  - `packages/web/src/components/settings/members/{useMemberEditor.ts,member-editor-state.ts,member-save-steps.ts,member-save-readback.ts,MemberSettingsPage.tsx}`：分步台账、部分成功文案、超时/428 读回、创建超时不重复 POST。
- **W2 冻结与权限**
  - `AcpClient.ts`/`AcpHttpStreamClient.ts`/`AcpServiceFactory.ts`/`acp-pool-signature.ts`：无 handler 默认拒绝或取消、显式 `auto_allow` 才允许、iCode 恒 reject、策略变化使池代际失效。
  - `cat-config-loader.ts`：`AcpVariantConfig.permissionPolicy?: 'auto_allow' | 'deny'` + 严格解析（非法值 → deny）。
  - `AcpAgentService.ts`：`freezeExecutionConfig()` 在 `pool.acquire` 前解析并在本次调用内只使用冻结值。
  - `l0-compiler.ts`/`l0-frozen-input.ts`/`l0-dependency-signature.ts`：冻结输入成为真实调用默认；payload 摘要、fail-closed、临时工件清理；成员配置内容哈希入缓存签名；legacy 仅诊断显式启用。
- **W3 会话契约**
  - `session-contract/compatibility-key.ts`：keyVersion=1、结构字段白名单、结构比较而非仅哈希。
  - `session-contract/fragment-decision.ts`：§7 变更矩阵 → `reuse/in_place_update/new_fragment`，in-place 需已验证更新能力 + adoption artifact。
  - `session-contract/{AgentSessionBridgeService.ts,session-open-cache.ts,active-run-dispatcher.ts,types.ts,registered-session-agent-service.ts}`：按兼容 digest 缓存/失效、透传 model/config、resume 调用方选择、取消阶段与延迟释放、不编造原生 id、continuity 回调。
  - `packages/shared/src/types/session.ts` + `SessionChainStore`/`RedisSessionChainStore`：可选 `compat/identityArtifact/fragmentSwitch`（缺失即不可验证 → 新片段）。

## 6. 门禁与命令证据

在 feature worktree（api dist 由 Lead 统一构建）执行：

| 命令 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm --filter @cat-cafe/api build`（含 shared + mcp-server） | exit 0，`F299 provider request recorder census OK` |
| `pnpm --filter @cat-cafe/api run lint`（tsc --noEmit） | exit 0（基线亦为 0） |
| `pnpm --filter @cat-cafe/shared run lint` | exit 0 |
| `pnpm --filter @cat-cafe/web exec tsc --noEmit` | exit 0 |
| `pnpm exec biome lint <changed files>` | 0 errors（仅既有/告警级 complexity 等） |
| 受影响 56 文件 node:test 套件（见 §1.3 命令） | 671 tests / 651 pass / 16 fail / 4 skip；失败与基线逐条相同 |
| 新增 W1+W2 身份/L0 测试 `w1-member-profile-projection` + `w2-l0-frozen-input` | 21 pass / 0 fail（含冻结-旧路径字节等价） |
| `test/l0-compiler.test.js`（改为显式 legacy seam 后） | 28 pass / 0 fail |
| L0 相关 `dossier-prompt-fixture`(5/5)、`staging-content`(4 pass/22 env skip)、`f203-opencode-l0`(14 pass/4 skip) | 通过（环境 skip 不计失败） |
| W3 新增 src 套件 `compatibility-fragment` + `bridge-w3` + `redis-session-compat` | 36 pass / 0 fail（含并发失败共享 open 的回归用例） |
| W3 完整 dist 契约套件 `agent-session-contract*`（3 个目录 glob） | 329 tests / 315 pass / 14 fail / 0 skip；14 个失败与 pristine `6d8d4915b` 逐条相同（Windows ACP bootstrap 临时目录 ACL），无本次引入失败；`agent-session-contract-smoke*` 全绿 |
| W2 新增 src 套件 `acp-permission-fail-closed` + `acp-permission-policy-factory` + `acp-pre-lease-freeze` | 16 pass / 0 fail |
| ACP dist 回归 `acp-client` + `acp-httpstream-client` + `acp-icode-adapter` | 85 pass / 0 fail |
| S1/S2/S3 新增 `config-write-revision/config-cas-route/session-strategy-cas/member-save-cas` | 30 pass / 0 fail（src 与 dist 各跑一次，均通过） |
| 既有路由 dist 回归 `native-runtime-routes/session-strategy-config-route/config-hotreload/member-create-receipt/cats-routes-runtime-crud` | 97 pass / 0 fail |
| Web 定向 `member*` / `hub-cat-editor` | 51/52 文件、348 pass / 1 skip / 7 fail：7 个失败全部来自既有 `member-alpha-continuation.test.tsx`（基线同样失败，与本次改动无关）；新增 save 用例 59/59 通过 |

**实施期发现并修复的回归**：Lead 独立跑全量时发现 `agent-session-contract-smoke/concurrency.test.js` 的 `[23] a shared open failure...` 由 1 次 open 变为 2 次（`attempts` 只在 microtask 内登记，并发失败未被共享）。session-contract 修复为在 `open()` 同步登记 in-flight attempt 后，定向用例 3/3、W3 src 36/36、dist 全量回到基线一致；该回归不是自证通过，是先被独立门禁抓到再修复。

## 7. 残余限制与未验证事实

1. **无真实客户端/真实环境验收**：C08/C14/C20–C26、E01–E04、Q01–Q04 未执行；不得据此宣布产品可上线。
2. **ACP 权限默认收紧需要迁移**：未显式配置 `acp.permissionPolicy: 'auto_allow'` 的成员现在对原生权限请求返回 reject/cancel（fail-closed 有意改变）。发布前需为依赖自动授权的绑定显式写入策略；仓库模板无 ACP 成员，无法替用户数据做迁移。
3. **无交互审批通道**：默认拒绝意味着需要审批的 provider 会等待/失败；这是方案明确的"无 handler 不得生成 allow"，但用户可执行性需后续审批通道（本任务按方案未新建审批系统）。
4. **S2 CAS 非原子**：`session-strategy` 采用 compare-then-await-Redis-write，两个真正并发的正式 PATCH 仍有窄丢失窗口；S1/S3 为进程内原子。要完全满足并发 C17，需在 `session-strategy-overrides.ts` 资源 owner 内做原子比较写入（本次未改该文件）。
5. **兼容元数据未接线**：类型/内存/Redis 字段已具备并测试，但 `SessionManager`/`invoke-single-cat` 尚未读写 `SessionRecord.compat/identityArtifact/fragmentSwitch`；因此"切换原因可查询、warm/cold 读回、旧记录迁移"仍为 BLOCKED。
6. **身份原地更新未实现**：没有任何客户端声明 `identityUpdate:'in_place_verified'` 或持久 adoption artifact；身份类变更一律走新原生片段（安全但更贵）。
7. **事件工具关联**：契约事件接受 `executionId/parentCallId`，但 `event-projection.ts` 未转发（C24 BLOCKED）。
8. **MCP 冻结**：ACP 的 `capabilities.json` 仍在租约后按 invoke-time 语义读取（#712），C05 的 MCP 子项未覆盖。
9. **L0 冻结输入的边界**：payload 冻结成员/名册/身份/治理/capsule 与 runtime model 事实；模板、section 模板与 workflow 触发文件仍是编译器资产（内容由依赖签名覆盖），不是逐字节冻结。
10. **布局/文档治理**：本改动新增模块，`docs/architecture/ownership` 的 `identity-session` cell 需要 `Map delta: update required`（新增 anchor：`member-profile-projection.ts`、`member-identity-resolution.ts`、`l0-frozen-input.ts`、`compatibility-key.ts`、`fragment-decision.ts`、`member-save-steps.ts` 等）并重新生成 README；本次未改 ownership 生成物与 F-doc（需维护者分配 F 号），已在此登记为合并前待办。
11. **本地门禁限制**：`pnpm check` 的 biome format 在 CRLF 检出上不可用；`deployment-prompt-edition` 因 WSL bash 失效失败；均为环境问题，Linux CI 为准。

## 8. 迁移与回退

- **配置**：不批量改写 CatConfig/breed/variant；旧字段读取保持（`null`/`undefined`/空值语义未改）。新增的 `permissionPolicy` 为可选字段，缺失即 deny。
- **会话**：新增 `SessionRecord` 字段为可选；旧记录缺失 → 不可验证 → 新片段（不删除历史，不强行 resume）。Redis CREATE_LUA 仅**追加** ARGV 15–17，不改变既有位置语义。
- **保存协议**：S1/S2/S3 以 `x-clowder-formal-edit: 1` 渐进启用；无 header 的旧写入方保持兼容。旧页面在新服务端仍可用，但并发保护只在正式写入路径生效。
- **回退**：程序回退即切回基线提交；不删除新增会话字段、不重置 Redis/SQLite、不覆盖用户新编辑。回退后权限 fail-closed 修复随代码回退需一并评估（方案要求回退包必须包含或禁用相关入口）；L0 可用 `frozenInputMode:'legacy'` 作为诊断逃生口，但**不作为生产默认**。

## 9. 复现命令（Windows PowerShell，仓库根）

```powershell
# 门禁
pnpm install --frozen-lockfile
pnpm --filter @cat-cafe/api build
pnpm --filter @cat-cafe/api run lint
pnpm --filter @cat-cafe/shared run lint
pnpm --filter @cat-cafe/web exec tsc --noEmit
pnpm exec biome lint packages/api/src packages/api/test packages/web/src scripts/compile-system-prompt-l0.mjs

# 定向 api 测试（dist 已构建）
cd packages/api
pnpm exec node ./scripts/with-test-home.mjs --env CAT_CAFE_DISABLE_SHARED_STATE_PREFLIGHT=1 `
  node --import ./test/helpers/setup-cat-registry.js --test --test-timeout=120000 `
  test/agent-session-contract-smoke/concurrency.test.js test/acp/acp-client.test.js test/acp/acp-httpstream-client.test.js

# Web 保存编排测试
pnpm --filter @cat-cafe/web exec vitest run src/components/__tests__/member-save-cas.test.tsx src/components/__tests__/member-save-steps.test.ts
```

## 10. 结论

本次交付把方案中风险最高、可确定性验证的契约落地为代码与测试：身份权威与投影、L0 冻结输入、ACP 权限 fail-closed、保存分步 CAS、会话兼容键与片段决策。**"实施完成"不等于"产品验收通过"**：真实客户端回归、企业 CodeAgent、工程质量样本与启用/回退演练仍未执行，按方案要求逐绑定给出"已验收/有限兼容/候选/不可用"的工作须在具备真实环境后进行。
