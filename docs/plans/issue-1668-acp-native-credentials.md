---
feature_ids: []
topics: [acp, native-tool, credentials, readiness, issue-1668]
doc_kind: plan
created: 2026-10-22
community_issue: 1668
status: proposed
---

# Issue #1668：DSH / Pi 原生 ACP 凭据与可用状态分析及解决方案

## 1. 结论与推荐方向

建议保留 `native_tool` 的配置归属，优先解决两件事：**让原生工具获得它实际选中 provider 所需的凭据；让 Clowder 准确表达凭据缺失、认证未知和调用失败，并提供修复入口。** 显式绑定 Clowder 账号时，复用现有账号解析与环境模板，不另建隐式兜底。

#1668 报告的 DSH 缺 key 错误具有明确定位价值，但其解释有四处需要修正：

1. `account: null` 表示不生成应用账号覆盖，不表示删除父进程环境。API 启动环境已有 `DEEPSEEK_API_KEY` 时，ACP 子进程仍会继承。
2. `native_tool` **带显式 `accountRef`** 时不会走该提前返回；现有路径已经支持解析账号。通用 `clientId=acp` 还必须有明确的账号 `envVars` 模板，不能靠 provider 名字推测环境变量。
3. DSH 的 `client-connection/browser-session` 是浏览器访问本地服务的认证记录，不能当作 `deepseek-official` 的模型 API key，也不能单凭它解释 Web 推理为何成功。需要核实两种启动实际采用的 provider、凭据引用和 HOME。
4. Pi 的空 `auth.json` 不能单独证明没有凭据，Pi 还支持环境变量等来源；其静默现象需要独立追踪 RPC → ACP → 消息持久化 → UI。当前源码已经有若干错误传播保护，不能把所有静默都归因于未注入 key。

本轮是**分析与方案交付**；方案尚未实施，真实 dsh/Pi 调用与 UI 恢复尚未验收。

## 2. 调查对象、版本和边界

| 项目 | 本次核验结果 |
| --- | --- |
| 原始问题 | [zts212653/clowder-ai#1668](https://github.com/zts212653/clowder-ai/issues/1668)，OPEN，回读时无评论 |
| 作者 / 本次连接账号 | 均为 `whutzefengxie-ops`；连接账号在上游为 `write` 权限。本次只作本地方案分析 |
| 分支 | `docs/issue-1668-acp-credentials` |
| worktree | `G:/AIwork/clowder-ai/worktrees/analysis-issue-1668-acp-credentials` |
| 分析基线 | 已 fetch 的 `upstream/main`：`1baaed2e9fadca8b550ae7041ef5a663994ab2d4` |
| fork / 本地 main | `44fb36e65b3a9ea4ebb9a9a875e0605c06f80289`，两者相同；创建 worktree 没有移动 main |
| Issue 报告版本 | runtime `1590a5cc92fcc3edc57fa5eec18d7673308de7a2`，DSH `0.2.1-rc.2`；属于报告现场，未冒充本次运行结果 |
| 补充源码 | 本机 `G:/AIwork/deepseek-harness` 的 DSH 源码快照，包版本 `0.2.1-rc.2`；未证明与报告中的 npx 安装字节相同 |
| Pi 安装元数据 | 本机官方启动 shim 指向 `@earendil-works/pi-coding-agent` `1.3.0`；未证明报告当时使用相同版本或 bridge |

本次读取了 Issue、相关源码、现有测试与官方文档；没有读取用户凭据正文，没有修改运行配置、原生 HOME、Redis 或 SQLite，没有重启 runtime，也没有发起真实模型请求。

托管 worktree 工具在外层容器目录返回 `Not a git repository`，随后从实际 Git 主仓执行 `git branch` / `git worktree add`，并用仓库 `worktree:new --declare-only` 登记 owner=`codex`。目录按用户指定的 `worktrees/` 布局保留。

## 3. 证据链与问题判定

以下 Clowder 源码证据统一绑定分析基线；文件内函数名比 Issue 中的旧行号更适合后续检索。

| 证据 | 当前行为 | 判定 |
| --- | --- | --- |
| `AcpServiceFactory.ts` / `resolveAcpAccount`，约 87–98 行 | 仅 `native_tool && !accountRef` 返回空账号；其余继续解析、校验绑定 | “显式账号也被跳过”不成立 |
| `acp-spawn-env.ts` / `prepareAcpProcessEnv`，约 22–65 行 | 空账号不生成覆盖；API key 账号经过模板解析及保留键过滤 | 这是配置归属边界，不是凭据删除 |
| `env-map.ts` 与 `acp-spawn-env.ts` | 通用 ACP 忽略 provider 内置映射，消费账号模板 | 仅填账号 key、缺模板，仍可能没有目标变量 |
| `AcpClient.ts:230`、`AcpHttpStreamClient.ts:114` | 两种 transport 均调用 `buildChildEnv` | 修复和验证必须覆盖两种 transport |
| `cli-spawn.ts` / `buildChildEnv`，约 320–354 行 | 默认克隆 `process.env`，再应用覆盖和剔除规则；DeepSeek key 不在剔除集合 | 启动环境传递已存在；终端后来设置变量不会改变已运行 API |
| `native-dsh-discovery.ts:52–65`、`native-dsh-profile.ts` | `configured` 只核启动器/profile 结构 | 不是认证或推理成功证据 |
| `native-pi-discovery.ts:35–55` | `configured` 只核 Pi 与适配器存在，并读模型标识 | 不是 Pi 凭据可用证明 |
| `native-runtime-readiness.ts:78–90` | DSH/Pi 不在安全登录探针覆盖范围，返回 `unknown` | 缺少这两种运行工具的凭据诊断能力 |
| `native-onboarding.ts:27–43`、`NativePartnerCard.tsx` | 未知就绪状态可以被选择；已有登录失败与实际连接待验证的部分文案 | 需要补缺 key 的专门状态，保留“未知”语义 |
| `PiAcpEvents.final` / `PiAcpSession.prompt` | 已处理 assistant error、RPC 拒绝、退出、handled；按 `agent_settled` 判终态 | 必须核实际事件，不能另造“所有错误未处理”的根因 |

固定版本源码入口：[Factory](https://github.com/zts212653/clowder-ai/blob/1baaed2e9fadca8b550ae7041ef5a663994ab2d4/packages/api/src/domains/cats/services/agents/providers/acp/AcpServiceFactory.ts)、[环境映射](https://github.com/zts212653/clowder-ai/blob/1baaed2e9fadca8b550ae7041ef5a663994ab2d4/packages/api/src/domains/cats/services/agents/providers/acp/acp-spawn-env.ts)、[父环境继承](https://github.com/zts212653/clowder-ai/blob/1baaed2e9fadca8b550ae7041ef5a663994ab2d4/packages/api/src/utils/cli-spawn.ts)、[认证就绪检查](https://github.com/zts212653/clowder-ai/blob/1baaed2e9fadca8b550ae7041ef5a663994ab2d4/packages/api/src/routes/native-runtime-readiness.ts)、[Pi 终态处理](https://github.com/zts212653/clowder-ai/blob/1baaed2e9fadca8b550ae7041ef5a663994ab2d4/packages/api/src/domains/cats/services/agents/providers/pi/pi-acp-session.ts)。

### 3.1 DSH：可确认的直接原因与仍待核实的部分

报告中的错误明确指出：该次调用选择了 `deepseek-official`，其所需凭据引用没有解析到 key。DSH 本地源码 `packages/llm/llm-deepseek-api-key/src/index.ts` 的 `resolveApiKey` 会通过 credentials service 解析引用，缺失时抛出 `MISSING_CREDENTIAL`；这与报告错误一致。

DSH 本地源码还有两条重要反证：

- `packages/credentials/credentials-local/src/index.ts` 的 `resolveSpec` 默认使用 `<DSH_HOME>/.credentials.yaml`，`resolve` 支持持久凭据与启动环境；该默认位置不包含 profile 名。`packages/boot/app-boot/src/profile.ts:178–185` 中，官方 Web/ACP 模板都包含 `dsh-base`。因此“必须新建跨 profile 凭据服务”没有现有证据支持；用户自定义 composition 仍需单独核实。
- `packages/client/connection/src/browser-auth.ts:14,202–203` 将 `client-connection/browser-session` 用于启动令牌交换、签名 cookie 验证。它说明浏览器可以访问本地服务，不能证明模型提供方已认证。

官方说明也将持久文件、启动环境及 `.env` 列为独立凭据来源，并说明启动环境是启动时快照。应先核对实际 `DSH_HOME`、凭据服务是否加载、有效 provider 和 `apiKeyEnv`，再判断配置缺失或来源错配。[DSH 本地凭据说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/credentials/credentials-local/README.md)

**已确认：**错误指向被选 provider 的凭据缺失；Clowder 没有为原生无绑定成员制造额外 key。**未确认：**Web 推理实际采用的模型认证、报告进程实际 HOME/启动环境，以及补充 key 后能否成功推理。

### 3.2 Pi：凭据问题与静默现象分开取证

Pi 官方文档说明 `/login` 可以保存认证，环境变量也可提供 API key；因此 `auth.json={}` 只能证明该文件没有条目，不能排除其他凭据来源。本机 `1.3.0` 随包 `docs/providers.md` 与此一致。[Pi 认证说明](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md)

当前 Clowder bridge 在收到 `message_end` 的 `error/aborted` 后记录失败，在 `agent_settled` 时拒绝该回合；RPC `success:false` 和子进程退出也会报错。本机 Pi 随包 `docs/rpc.md:67–69` 明确要求按 `agent_settled` 判断整体结束，不能为了消除静默而改为 `agent_end` 成功。

仍可能需要查证：报告实际选的是外部 `pi-acp` 还是内置 bridge、原生事件是否只有 stderr、是否产生空成功 assistant、终态错误是否已到 API 但 UI 未显示、实际 Pi 版本是否支持当前终态。当前 `PiAcpEvents` 对任意 assistant `message_end` 都设置 `completedAssistant=true`，空内容且无错误标记仍可能走成功分支；这是可验证的候选缺口，尚未证明是报告的唯一原因。

## 4. 目标契约与方案选择

目标：用户添加 dsh/Pi 后，能理解当前连接为何不可用，在正确配置源完成修复，再用同一成员成功对话；已有身份、历史和配置归属持续有效。

| 方案 | 收益 / 风险 | 建议 |
| --- | --- | --- |
| 原生配置保留，补凭据诊断、状态与引导 | 保持 #1654 契约；依赖工具可提供的安全证据 | **默认路径** |
| 用户显式绑定账号并配置变量模板 | 可复用已有账号设施；须验证 provider/endpoint/model 匹配与覆盖优先级 | **高级可选路径** |
| 无绑定时自动取应用默认账号或猜测 key 变量 | 可能把其他账号、provider 或 HOME 注入原生连接 | 不采用 |
| 复制 browser-session grant 给模型 provider | 本地 UI 认证与模型认证用途不同 | 不采用 |
| 新建跨 profile key 同步存储 | 默认 DSH_HOME 已有共享来源；增加重复状态和失配机会 | 本问题暂不需要 |

Architecture cell：现有 native runtime discovery/readiness、ACP invocation 与成员配置界面。Map delta：不新增凭据存储或独立账号权威；新增安全状态投影与明确错误归因。

### 4.1 三层信息不可互相替代

```mermaid
flowchart LR
  A[发现启动器和适配器] --> B[核对该连接的凭据来源]
  B --> C[实际请求及终态]
  B --> D[缺凭据或证据不足：提示修复或未知]
  C --> E[成功、认证拒绝、网络失败或协议异常]
```

`discoveryStatus=configured` 继续只表达发现结果。认证状态与最近调用结果分别表达，禁止把 initialize/session-new、key 存在或列表有模型标为真实推理成功。

### 4.2 状态和恢复规则

| 观察 | 展示 / 派发行为 | 恢复方式 |
| --- | --- | --- |
| 无启动器 / 缺适配器 | 沿用安装、适配器缺失状态 | 安装后重新检测 |
| 连接对应凭据已明确缺失 | 建议扩展 readiness 为 `credential_required`，带安全原因码；保留成员，阻止该连接被自动选入 `@all` | 在原生工具或显式账号处补配置，再检测 |
| 没有可靠只读证据 | `unknown`；显示“认证状态未检查”，允许用户主动验证 | 用户发起一次验证或正常对话 |
| 发现凭据配置 | `configured`；显示“凭据已配置，实际连接待验证” | 正常调用，不自动探测配额或制造推理 |
| 实际认证拒绝 | 展示认证失败及修复入口；不能标为成功或永久禁用成员 | 修复后重试；保留此前失败记录 |
| 网络、限流、协议或空响应异常 | 按具体错误分类，不归并为缺 key | 对应处理；不自动改账号、模型或 HOME |

投影归属于**当前连接身份**：成员修订、启动描述、HOME、显式账号、有效 provider/model 与相关工作目录。检测结果带 `checkedAt`；配置变更使旧证据失效，未知和超时不能写成缺凭据。复用现有 readiness 缓存机制并补正确失效键，避免新建持久状态表。

实际回合错误仍由现有 invocation/message 链持久化。若需要向成员列表投影最近认证失败，应增加按当前连接身份匹配的最小投影接口；不得只用 catId 混用旧账号失败，不把迟到错误覆盖新配置的成功状态。API 重启后无可匹配证据就回到 `unknown`，不凭缓存永久封禁。

`AgentRegistry` 的 unavailable map 当前服务于注册失败；不应因一次可修复的 turn 凭据错误直接注销 service。`@all` 的阻断依赖同一份明确失败证据，并逐成员反馈跳过原因；显式 `@dsh` / `@pi` 返回可操作提示，其他正常成员继续运行。

## 5. 实施工作单元

### W0：固定实际连接和失败证据

只收集安全元数据：源码及构建标识、dsh/Pi/bridge 版本、command/args/profile、有效 HOME、provider/model、凭据引用是否配置，以及同一次 invocation 的事件类型、终态与 UI 消息。不要输出 key、token、cookie 或完整认证文件。

DSH 对照 Web/ACP 是否同一 `DSH_HOME`、是否均加载 credentials service，以及两者选中的 provider；浏览器访问本地服务成功单独记录。Pi 先区分外部适配器与内置 bridge，再追踪失败事件，确认是否需要兼容分支。

交付：两条独立故障链及版本清单；无法证明的部分保留未知。本轮 Issue 描述可作为历史失败证据，不能替代修复后的实际验收。

### W1：恢复正确的凭据来源

**DSH 原生路径：**用户通过实际 DSH 的 Models 页面/credentials service 为当前 provider 所用引用配置凭据，或在启动 API 前提供该变量；保持实际 `DSH_HOME`。仅在用户授权的测试实例中执行重启，不能把新终端变量视为已注入旧 API。已有持久值可能优先于环境，必须检查实际命中的来源。

**Pi 原生路径：**在同一原生 agent 目录内使用 `pi` 的 `/login` 配置目标 provider，或按该 provider 约定提供启动环境；确认实际 provider/model。不可只把任意 key 写入 `auth.json`，也不以空文件判死。

**显式托管账号路径：**保留现有 `accountRef` 解析、兼容性校验和 `envVars` 模板，例如账号模板 `DEEPSEEK_API_KEY: '${api_key}'`。此处是字段映射示例，不包含凭据；通用 ACP 不推断 provider，base URL 仅按工具该版本确认支持的机制配置。绑定 API key 却缺目标模板时，应提供明确配置诊断，而非无覆盖后继续产生不明失败。

改动位置：`AcpServiceFactory.ts`、`acp-spawn-env.ts`、`env-map.ts` 的必要诊断及已有账号设置入口；不为“支持注入”重写已有可用路径。

验收：原生无绑定继续忽略无关应用默认账号；显式模板正确映射；缺 key/缺必要模板可解释；model/provider/endpoint 不被静默改写。显式 env 覆盖也不保证压过 DSH 的原生持久凭据，必须核实际采用。

### W2：凭据状态、成员页面与派发统一

改动位置：`native-runtime-readiness.ts`、`native-runtimes.ts` 及其共享/Web 类型，`native-dsh-discovery.ts`、`native-pi-discovery.ts`，`first-run-quest/native-onboarding.ts`、`NativePartnerCard.tsx`，以及现有成员状态/路由消费入口。

已识别的工具和版本才使用安全、有限时的只读检查；若无稳定 describe/status 接口，返回 `unknown` 并提供引导。不得为检测执行 Pi 认证文件中的 `!command`、刷新 OAuth、初始化未知 profile 或发送隐藏 prompt。不要手写覆盖 DSH/Pi 全部凭据优先级的第二套解析器。

DSH 已确认选择官方 key route 且无可解析凭据时提示：“ACP 连接缺少 DeepSeek 凭据，请在 DSH 中配置后重新检测。”Pi 无足够证据时提示：“Pi 已安装，认证状态尚未检查；请在 Pi 中确认 provider 登录。”若本轮错误已明确为认证失败，则显示对应失败。

显式账号连接不能借用默认原生连接的检测结论。`credential_required` 的创建、编辑、重新检测、单成员调用与 `@all` 必须消费同一身份对应的状态；历史成员和历史消息保留。

验收：配置不足、未知、实际调用失败各自有准确 UI；修复配置后同一成员恢复；无关成员不受失败影响。

### W3：错误分类和 Pi 静默闭环

改动位置：`AcpAgentService.ts` 的分类与用户提示、`pi-acp-events.ts`、`pi-acp-session.ts`、`pi-rpc-process.ts`，以及现有错误消息的持久化/UI 消费链。

优先识别工具结构化 `MISSING_CREDENTIAL`；DSH 若只在 ACP 文本里保留固定缺 key 描述，用有 provider/版本边界的窄匹配转换安全原因码。401/403 不一概等于缺 key，未知文本继续保留一般调用错误。错误摘要进入日志/UI 前脱敏。

Pi 补上实际缺失的事件分支。对于“完成但没有可交付输出”的回合，先区分正常取消、handled、工具输出、thinking 与异常空完成；需要拒绝时返回独立空响应/协议错误，不能推定缺凭据。保留官方 `agent_settled` 栅栏、错误优先级和同 session 重试行为，不通过提前成功或盲目重发 prompt 消除等待。

验收：RPC 拒绝、assistant error、退出、空终态和 stall 都能形成一次明确终态，并进入持久历史；刷新后错误仍可见，重试不会重复提交原请求。

## 6. 验证矩阵与命令

| 场景 | 必须观察的结果 |
| --- | --- |
| native_tool、无绑定、有无关应用默认账号 | 不注入其 provider/key/HOME；原生配置继续拥有决策权 |
| API 启动时已有 DeepSeek key | STDIO/HTTP 子进程继承；不能因空 account 丢失 |
| 显式 API key 账号和正确模板 | spawn 目标变量正确、保留键不能注入；实际 provider 采用另验 |
| 显式账号缺 key / 缺必要模板 | 提前报可解释诊断；不变成 OAuth，也不静默回退 |
| DSH 同 HOME、持久 key 与环境分别配置 | 符合该版本优先级；Web/ACP 的 provider 来源可区分 |
| DSH 只有 browser-session 记录 | 不当作模型认证成功；route 缺凭据时给准确提示 |
| Pi 空 auth 文件但环境 key 有效 | 不误判缺凭据；模型、provider 对应正确 |
| Pi provider error / RPC 拒绝 / 退出 / 空完成 | 不记正常空成功；错误从 wire 到 UI 并持久回读 |
| Pi agent_end 后仍有自动工作 | 等到 agent_settled；取消和 handled 分支保持原契约 |
| @all 一位认证失败、其他正常 | 失败原因可见，其他成员执行，修复后可重新加入 |
| 修改账号/HOME、并发迟到失败、API 重启 | 旧证据不污染新连接；未检查状态保持 unknown |
| 首次成功、同会话续聊、刷新/API 重启 | 历史、身份及会话关系保留；不靠另建成员冒充恢复 |

实施后按风险先观察 RED，再修至 GREEN。当前仓库已存在下列定向测试；使用各自 worktree 的依赖与构建，先安装本分支锁文件，不链接其他 worktree 的整个 `node_modules`。

```powershell
pnpm --filter @cat-cafe/shared build
pnpm --filter @cat-cafe/api build
Push-Location packages/api
node scripts/with-test-home.mjs node --test test/acp/acp-spawn-env.test.js test/pi-acp-bridge.test.js
node scripts/with-test-home.mjs node --import tsx --test test/native-runtime-readiness.test.ts test/native-dsh-discovery.test.ts
Pop-Location
pnpm --filter @cat-cafe/web exec vitest run src/components/first-run-quest/__tests__/native-onboarding.test.ts src/components/first-run-quest/__tests__/native-partner-login-scope.test.tsx
pnpm lint
```

新增凭据状态、路由和错误分类的测试应加入该组合；上述既有文件不自动证明覆盖所有新契约。对实际改动的 TS/TSX/测试文件运行 `pnpm exec biome check --diagnostic-level=error <逐个列出的改动文件>`。全仓门禁按最终改动面决定，不把现有文档或探针结果记作产品测试通过。

真实验收只使用一套归属明确、独立端口和资料根的作者环境，Redis 使用 `6398` 或已核准隔离 offset；保留原生 HOME/会话隔离与实例台账。先回读已有有效证据，仅对未覆盖场景执行必要真实调用；结束后受控停止作者临时进程，保留数据并回读历史。

## 7. 本轮已完成的验证与证据缺口

对**本 worktree 的实际 `env-map.ts` / `acp-spawn-env.ts`** 去除 TypeScript 类型，仅将本地导入改为内存 URL 后执行了 5 项合成断言，Node `v24.16.0`，全部通过：

- 空账号不生成覆盖。
- 通用 ACP 仅有 provider 名不产生映射。
- 显式账号模板可映射 DeepSeek key。
- 显式 API key 账号缺 key 被拒绝。
- `CAT_CAFE_` 保留前缀不能通过模板注入。

探针只使用固定合成值，未 spawn 原生工具、读取真实认证或访问网络；**不等价于 ACP 握手、真实 provider 请求、完整回归或 UI 验收**。本地回执及两个源码 SHA-256 位于 worktree 的 `artifacts/issue-1668/source-probe.json`。

文档增量 frontmatter 检查通过（`node scripts/check-frontmatter.mjs --strict-delta --base upstream/main`，changed=1），UTF-8、尾部空白与代码围栏检查通过；方案中列出的既有测试文件和 Windows HOME 包装脚本均已核实存在。

尚缺：报告实际运行构建/启动环境、Web 成功推理的真正认证链、Pi 失败原始事件、真实补配置后的推理/续接/重启恢复与界面证据。本轮未运行产品构建或完整测试，不据此关闭 #1668。

## 8. 关联改动、交付与回退边界

- #1654 的配置归属修复已存在本基线，提交 `2701db822`；本方案必须保护其“无显式绑定不借用应用默认账号”的结果。[既有修复文档](../bug-report/issue-1654-native-tool-config.md)
- #1653/#1658 的 Windows bootstrap 修复已经在基线；启动器安全、profile 初始化与模型凭据是不同阶段，不用重做 bootstrap 绕过本问题。
- 在飞 [PR #1596](https://github.com/zts212653/clowder-ai/pull/1596) 的远端 changed-files 已核到 `AcpServiceFactory.ts`、`AcpClient.ts`、`AcpAgentService.ts` 等重叠路径；实施前按其最新 HEAD 复核冲突。本轮未修改这些源文件。
- 本机 `feat/issue-1667-dsh-bootstrap-policy` 相对当前上游没有独有文件差异；`feat/issue-1666-codex-proxy` 的独有改动在 Codex 网络环境及其测试/计划。本次不合入或改动这些工位；实施前仍须重新核验。
- 本方案建议采纳“原生凭据修复 + 明确状态/错误闭环”，显式账号作为已有高级能力；代码作者、非作者审查者、合并及部署负责人在实施时明确，本轮没有代替维护者作合并决定。
- 回退仅涉及未来 feature 代码及投影；不回滚/删除凭据、成员、历史或数据库，不迁移 HOME，不全局注销成员，不静默换 provider。真实配置变更由用户明确选择。

**停止条件：**若当前工具版本无法安全探测，保留 `unknown`；若 Pi 没有失败事件证据，先补最小复现；若需要浏览器令牌转作模型认证、隐式账号覆盖或破坏历史才能“通过”，该方案不进入实施。

本 worktree 保留用于用户审阅方案与后续实施，普通项目文档以此分支 `docs/` 作为待合入版本；正式 main 文档仍经合入进入主仓，不向 `clowder-ai-main` 直接复制。当前没有新增服务或安装实例，程序/数据清理项为零。

worktree 收尾工具与 `--check` 均回读 `state=retained`，owner=`codex`，复查期限为北京时间 **2026-11-05 23:59**；这是保留登记，不是清理或定时删除。本轮文档与探针回执尚未 Git 提交或推送。
