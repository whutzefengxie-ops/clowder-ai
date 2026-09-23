---
feature_ids: [F171, F155, F229]
topics: [onboarding, cli-auth, desktop-installer, handoff]
doc_kind: implementation-progress
created: 2026-09-23
---

# Issue #1466 首启旅程：当前进展与后续实施交接

记录日期：2026-09-23。本文是当前 feature worktree 的工作稿，尚未提交、合入或发布；正式文档随分支合入后进入 main 的 `docs/`。

## 1. 当前结论

**功能尚未完成，PR 尚不能合入，Windows 安装器尚未交付。** 已有旅程状态机和组件实现，本轮修复了部分客户端认证判定问题，并获得定向测试证据。但“脚本示范 → 我的真实伙伴 → 第一条真实消息”的完整体验还没有端到端证明，且独立检查确认了恢复、创建重试、角色交接等缺口。

用户最新要求是整理进展文档。本轮已停止继续修改功能；后续从本文实施队列恢复，不应根据先前 PR 标题中的 “complete” 认定工作已完成。

| 项目 | 本次核实状态 |
| --- | --- |
| Issue | [#1466](https://github.com/zts212653/clowder-ai/issues/1466)，OPEN |
| 正确实现 PR | [#1519](https://github.com/zts212653/clowder-ai/pull/1519)，OPEN |
| PR 合并状态 | `CONFLICTING` |
| PR CI | `statusCheckRollup: []`，没有检查结果，不是通过 |
| 当前本地与远端 feature HEAD | `ec0e573887fd60bb87eed05e415ed7019c37cb3d` |
| 未提交修改 | 12 个 tracked 文件修改、3 个新增代码/测试文件；另加本文 |
| 本轮前端定向测试 | 4 个文件、20 项通过 |
| 本轮凭证探测测试 | 4 项通过 |
| 本轮 Web 类型检查 | 单独执行通过，退出码 0 |
| 本轮 API 类型检查 | 失败：`local-trace-exporter.ts:44:30`，TS7006 |
| 浏览器完整旅程 | 未获得通过证据；当前测试本身仍需修正 |
| 正式独立 review | 尚无覆盖最终 HEAD 的批准 |
| Windows 安装器 | `dist/` 未发现 `.exe` 安装器；只核实到旧 Electron unpacked 可执行文件 |

## 2. 目标与验收边界

核心目标：新用户双击安装包后，理解猫如何分工协作；复用本机已安装、已登录的 CLI，不必再填写 key，尽快与自己的真实伙伴开始对话。

完整交付必须包含：

1. 三猫脚本示范不调用真实模型，使用产品界面呈现协作；看见初稿、同伴反馈和改进后的结果。
2. 示范能够暂停、继续和恢复；安装或登录中途离开后，不必重新看完示范。
3. 复用现有 CLI 探测层，检测安装与登录状态；只向前端投影状态，不传凭证内容。
4. 0 个客户端提供安装入口；1 个客户端生成一个真实伙伴；多个客户端按选择生成真实成员。
5. 登录复用 CLI 自身流程；点击登录只能进入等待，真实探测成功后才能放行。
6. 示范猫与真实成员之间有明确身份交接；解说猫成为第一位伙伴，并衔接 F229。
7. 新安装默认钉选 `members`、`accounts`；保留用户主动取消的选择。
8. 在真实主窗口用 F155 轻提示这两个入口，不遮挡或锁住首次输入与发送。
9. 首条真实消息成功发送后才完成 onboarding；配置完成不等于旅程完成。
10. 补齐可复现测试、处理上游冲突、更新原 PR，交付经过验证的 Windows 安装器。

Issue 还包含应用/Web/主站图标统一、DMG 品牌视觉等内容。本轮没有实施或验收这些要求；如果最终 PR 仍保留 `Closes #1466`，必须逐项核实它们是否已有上游实现，或取得明确的范围裁定，不能静默略过。

## 3. 工作区、分支与提交

| 坐标 | 值 |
| --- | --- |
| 项目根 | `G:\AIwork\clowder-ai` |
| 当前开发 worktree | `G:\AIwork\clowder-ai\worktrees\feat-onboarding-first-run` |
| 分支 | `feat/onboarding-first-run` |
| `origin` | `https://github.com/whutzefengxie-ops/clowder-ai.git`，个人 fork |
| `upstream` | `https://github.com/zts212653/clowder-ai.git`，PR 目标仓库 |
| 当前 `origin/main` | `2374ca5c77721276dd813c19603f7eb63d700a48` |
| 查询时 PR 目标 main SHA | `5968c19ad8b334ba8497fbb722b3e908b0e135e1`；继续前重新获取 |

**重要纠正：此前执行 `git fetch origin main` 只更新了 fork。解决 #1519 的冲突应针对最新 `upstream/main`，不能把 `origin/main` 当成 PR 目标基线。**

已有提交：

- `361a57ccd`：`feat(web): complete first-run onboarding journey`。
- `ec0e57388`：`test(web): add first-run onboarding browser coverage`。

PR #1452 是另一条桌面安装加固 PR，不承载本首启实现。继续维护 #1519，不新开平行实现。

## 4. 已有实现与本轮变更

### 4.1 已提交的基础实现

- `FirstRunQuestWizard.tsx`：演示、模板、客户端、配置、创建和完成页面。
- `onboarding-journey.ts`：旅程阶段、演示场景、暂停标记、配置草稿、真实成员投影、首消息完成函数。
- `demo-script.ts`：`opening → draft → review → improved → handoff` 脚本文案。
- `ChatContainer.tsx`、`ThreadChatSurface.tsx`：创建后导航及首消息完成回调。
- `usePinnedSections.ts`：localStorage 未设置时默认 `members/accounts`，已保存的空数组仍保持空。
- `guides/flows/first-run-entry.yaml` 与 registry：已注册首次协作引导。
- 开发测试页面与 Playwright 测试文件：已存在，但不能据此声称 E2E 通过。

这些是代码存在性说明，不等于完整验收。下面列出的缺口仍成立。

### 4.2 本轮新增的认证探测

新增 `packages/api/src/domains/cats/services/first-run-quest/client-auth.ts`，由已有 `client-detection.ts` 调用；API 客户端响应增加 `authenticated` 布尔字段。

| 客户端 | 当前实现读取来源 | 尚需确认的边界 |
| --- | --- | --- |
| Claude | `CLAUDE_CONFIG_DIR/.credentials.json` 或 `~/.claude/.credentials.json` 中的 `claudeAiOauth` | macOS Keychain、其他存储形态尚未覆盖 |
| Codex | `CODEX_HOME/auth.json` 或 `~/.codex/auth.json` 中的 `tokens` | keyring 与原生 API-key 文件形态尚未覆盖 |
| Gemini | `~/.gemini/oauth_creds.json`；支持 `GOOGLE_API_KEY/GEMINI_API_KEY` | 文件登录路径只有实现，尚无专项通过证据 |
| OpenCode/Kimi | 现有环境变量 key 判断 | 尚无其原生登录存储探测 |

实现只判断必要字段为非空字符串，不发网络请求、不启动 Agent、不返回 token。**字段存在仅代表检测到本地凭证，不证明凭证仍有效或模型调用成功。** 后续仍须通过连接验证/真实调用证明可用性。

本轮没有提取 quota 的凭证函数，而是新增了同类只读判断。未沿用 `CLAUDE_CREDENTIALS_PATH/CODEX_CREDENTIALS_PATH`：这些是额度面板可选账号覆盖，未证明与 CLI 执行账户一致。继续时应核对实际运行身份，不能混用不同账户的探测结果。

### 4.3 本轮前端修正

- `ClientStep.tsx` 不再仅因账号记录 `authType: oauth` 就认为已登录。
- 优先消费 API 的 `authenticated`；已配置的 API-key 账号保留兼容路径。
- `not_installed` 与等待外部登录的 `pending` 分离。
- `pending` 显示“等待登录”；重新探测到 ready 时覆盖保存的 pending，并通知父级持久化。
- 检测请求失败显示错误与重新检测入口，不再伪装成“未安装”。
- 账号列表请求失败不再让整个客户端探测失败。
- 当前“去登录”仍只设置 pending 并显示终端操作提示，**没有真正拉起 CLI**。
- `authenticated` 在旧草稿中允许缺省，避免旧缓存仅因新增字段被全部废弃。
- `ConfigStep.tsx` 修正默认账号选择：内置 ID 不存在时改选实际存在的账号。
- `ProfileCard.tsx/ConfigStep.tsx` 将浏览器定位标记放回“测试连接”“创建猫猫”按钮；此前标记误放在编辑/新建账号按钮上。

### 4.4 未提交文件清单

| 路径 | 状态与用途 |
| --- | --- |
| `desktop/package-lock.json` | 构建遗留：仅两处版本 `0.2.0 → 0.10.1`，待清理无关变化 |
| `packages/api/src/domains/cats/services/first-run-quest/client-detection.ts` | 接入认证状态投影 |
| `packages/api/src/domains/cats/services/first-run-quest/client-auth.ts` | 新增，只读认证探测 |
| `packages/api/test/first-run-auth.test.ts` | 新增，4 项凭证回归 |
| `packages/web/package.json`、`pnpm-lock.yaml` | 上轮加入直接 Playwright 依赖，待统一测试依赖方案 |
| `packages/web/src/app/dev/first-run-onboarding/page.tsx` | 上轮改为动态导入、关闭 SSR |
| `packages/web/src/components/FirstRunQuestWizard.tsx` | 上轮局部修改，恢复/幂等问题尚未解决 |
| `packages/web/src/components/__tests__/first-run-quest-wizard.test.tsx` | 补真实登录探测字段 fixture |
| `packages/web/src/components/first-run-quest/ClientStep.tsx` | 状态推导、重新检测、错误提示 |
| `packages/web/src/components/first-run-quest/ConfigStep.tsx` | 配置恢复、默认账号、按钮定位 |
| `packages/web/src/components/first-run-quest/ProfileCard.tsx` | 连接测试按钮定位 |
| `packages/web/src/components/first-run-quest/onboarding-journey.ts` | 新状态与旧草稿兼容 |
| `packages/web/src/components/first-run-quest/__tests__/client-step.test.tsx` | 新增，3 项客户端回归 |
| `packages/web/test/browser/first-run-onboarding.test.mjs` | 上轮未完成修改，仍有明确测试逻辑问题 |

## 5. 测试与构建证据

### 5.1 本轮实际执行

| 检查 | 结果 | 证据边界 |
| --- | --- | --- |
| 新 ClientStep 3 项回归，修复前 | 3 项按预期失败 | OAuth 误判、pending 文案、失败冒充未安装 |
| 前端定向 Vitest | 4 文件、20 项通过 | ClientStep 3、journey 7、wizard 5、pins 5；不是浏览器 E2E |
| 新凭证回归，注入边界补齐前 | 3 失败、1 通过 | 未实现依赖注入导致 fixture 无法进入判断，不能单凭这一 RED 证明全部生产问题 |
| 新凭证回归，补齐后 | 4 项通过 | 原生 OAuth、CODEX_HOME 隔离、损坏/缺字段、环境 key；不含真实账号联网 |
| `pnpm --filter @cat-cafe/web exec tsc --noEmit` | 通过 | 已单独复跑，退出码 0 |
| `pnpm --filter @cat-cafe/api exec tsc` | 失败 | `src/infrastructure/telemetry/local-trace-exporter.ts(44,30): TS7006 Parameter 'e' implicitly has an 'any' type` |
| Web 测试包装脚本 | 环境/仓库文件缺失 | 找不到 `scripts/lib/process-resource-lease.mjs`；随后显式设置 NODE_ENV 直接跑 Vitest |

API 报错位于本轮未修改文件，但尚未对最新 upstream 基线复验，**不能直接宣称是上游既有错误或忽略**。先同步正确基线，再定位。

前端测试伴随 `act(...)` 环境警告和 Browserslist 过期提示；断言通过，但不等于运行无告警。

### 5.2 当前没有的证据

- 没有修正后浏览器测试全部通过的结果。
- 没有真实 API + 真实浏览器 + 首次消息持久化的完整链路证明。
- 没有本轮 API route 测试、guide loader 测试的重新通过结果。
- 没有本轮修改后的 production build、完整格式检查与相关门禁通过结果。
- 没有最终安装器大小、SHA256、安装/启动验收结果。
- 没有处理 main 冲突后的 CI 与 final HEAD 独立 review。

交接摘要曾记录旧 HEAD 的 Web production build、guide loader 15 项通过；本轮没有复跑，不能用于批准当前未提交变更。

### 5.3 安装产物现状

本次只核实到 `desktop/dist/win-unpacked/Clowder AI.exe`，大小 **201,481,728 bytes**，文件时间显示 **2026-09-22 13:35:41**。这是 Electron unpacked 主程序，**不是一键安装器，也不能证明包含本轮代码**。

已有构建入口：`desktop/scripts/build-desktop.ps1`；Inno 脚本：`desktop/installer/cat-cafe.iss`。历史交接记录的 Inno 工具位置为 `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`，继续时应重新确认。

## 6. 必须处理的缺口

| 优先级 | 缺口与影响 | 当前证据/处理方向 |
| --- | --- | --- |
| 高 | PR 基线仍冲突，CI 未运行 | 获取 `upstream/main`，保全未提交工作后合并/变基，不能只 fetch fork |
| 高 | 已登录 CLI 是否能在空账号库直接完成配置尚未证明 | `ConfigStep` 仍依赖 `/api/accounts`，需验证内置账号解析/创建与实际执行环境 |
| 高 | 配置阶段刷新回到客户端清单 | `stepForJourneyStage('setup')` 固定返回 client；保存的 configIndex 未恢复 UI 子步骤 |
| 高 | 创建中断可能重复创建成员 | 已创建缓存仅在 ref；重开清空，catId 使用新时间戳。独立静态检查确认风险，尚未运行复现 |
| 高 | F155 non-blocking 只有注释 | Flow 类型没有该属性；`GuideOverlay` 仍聚焦 HUD、限制 Tab，Spotlight 生成点击遮罩 |
| 高 | 登录按钮没有拉起 CLI，0 客户端没有安装链接 | 当前仅 pending + 终端提示；不满足 issue 约定入口 |
| 高 | Playwright 测试无法正确验证恢复与完整路径 | 初始化脚本每次刷新清空 localStorage；步数多点一次；漏选模板；fixture 字段/文案存在问题 |
| 高 | 演示与原始分镜差距明显 | 当前静态文字卡、手动推进；缺真实消息组件、自动输入、猫动画和角色交接 |
| 高 | F229/真实成员映射未实现 | 多客户端复用同模板形象；nickname/mentionPatterns 可能歧义，路由影响待查 |
| 中 | 首消息成功/失败/跨线程门禁未完成验证 | 已有回调接线，但需证明失败不完成、成功才完成、正确线程归属与刷新恢复 |
| 中 | `members/accounts` 提醒未解释入口用途 | flow 目前只有发送第一句话；rail 尚无对应引导标签 |
| 中 | 多平台认证覆盖不足 | 明确检测范围，不把未知存储方式说成已登录/未登录的确定事实 |
| 中 | 测试未接入自动执行契约 | 新 `first-run-auth.test.ts` 不在默认 `test/*.test.js` 范围内，需调整发现/命令 |
| 中 | 格式与文件行数、依赖变更未收口 | 仅整理本次改动；不要对全仓自动修复或提交构建副产物 |

独立只读扫描来自本线程子代理 `onboarding_review`，对象是 `ec0e573` 加当时工作区变更，没有执行 E2E，没有批准最终代码。其确认的恢复、重复创建、演示、身份交接、入口及测试缺口均已纳入上表。

## 7. 后续实施顺序

### 阶段 A：保全现场并同步正确基线

1. 回读本文、issue 原文及 #1519 最新评论，确认本地改动没有被他人继续修改。
2. 检查 tracked/untracked 文件；保全本轮改动。不要 `reset --hard`，不要一键清理工作树或 `stash -u`。
3. 检查桌面锁文件 diff，只还原确认无关的版本改动；必要时先留独立副本。
4. 获取 `upstream/main` 并记录 SHA。工作区干净或安全保存后再合并；已推送 feature 优先考虑 merge，避免不必要重写历史。
5. 逐文件解决冲突，保留上游已有功能，重新检查 API 报错与缺失测试包装依赖。

完成标准：明确最新目标基线、工作没有丢失、无冲突；有可重放的测试入口。

### 阶段 B：完成真实客户端到账号绑定路径

1. 以空 Clowder 账号库 + 已登录 Claude/Codex 为首要 fixture，验证检测到配置到调用使用同一身份。
2. 补 API route 契约测试：必须认证才能访问，只返回状态，凭证值绝不出现在 JSON/日志。
3. 核对 CLI 的各平台凭证位置与运行 home，补已有环境 key、缺文件、损坏文件、独立 home、未知存储等分支。
4. 让“去登录”复用可交互的 CLI 自身登录入口；固定命令白名单，不接受前端任意 shell 字符串。完成后重新探测。
5. 为未安装客户端提供官方安装入口；准备好的单客户端不受其他未安装项阻塞。
6. 配置屏应复用已有登录身份和合理默认模型，核实无需用户再造一份 API-key 账号；连接失败保留可恢复路径。

完成标准：0/1/多客户端都能走通；点击登录不伪造成功；真实重新探测可解除 pending。

### 阶段 C：修复恢复与创建幂等

1. 状态中显式保存配置子步骤、已选择客户端、当前 configIndex 与配置草稿；重新探测结果与用户选择分开保存。
2. 持久化每个待创建成员的稳定 ID/请求标识及服务端确认结果，重试先对账，不重新生成同一成员。
3. 线程创建也具备稳定重试语义，处理“服务端成功、浏览器未收到响应”的窗口。
4. 先补失败测试：第二个客户端配置时刷新、第一个成员创建成功后失败、创建后关闭重开、线程响应丢失。
5. 校验老版本 localStorage、禁用 localStorage、撤销登录等情况，不把缓存 ready 当作永久授权。

完成标准：任意节点刷新可继续；重复提交不会新增重复猫或线程；完成阶段单独保存。

### 阶段 D：完成分镜与 F229 交接

1. 对照 issue 中的参考原型与资源，复用已有素材及真实消息组件，不另建一套与产品脱节的聊天界面。
2. 实现脚本输入、@ 同伴、初稿/审查/改稿及可暂停播放；示范明确标识为脚本，不调用模型。
3. 落实示范角色到真实成员的动态映射；优先让解说猫成为首位伙伴，未加入的角色明确退场。
4. 一客户端明确提示以后可邀请更多伙伴；多成员身份、昵称和提及规则保持可区分。
5. 核对 F229 的既有入口和默认伙伴持久化，完成交接；同步核对图标/DMG 要求的处理范围。

完成标准：用户可从动作和结果理解协作，且演示承诺与实际得到的成员一致。

### 阶段 E：落实非阻塞 F155 与首条消息

1. 使用 `guide-authoring` 流程补充成员/账号入口说明及标签注册；先确定当前仓库实际标签清单机制，不能照搬不存在的文件。
2. 为 F155 补明确可消费的非阻塞契约：后端 flow loader、前端 flow 类型和 Overlay 同步支持。
3. 非阻塞模式不抢焦点、不限制 Tab、不生成拦截点击的遮罩；退出或发送消息后正常结束，不抢占正在运行的其他引导。
4. 保留第一句话输入，提供可编辑建议；覆盖发送失败、成功、跨线程、刷新后的 completed 状态。

完成标准：提示显示时可直接点击输入与发送，入口可找到；仅真实发送成功完成 onboarding。

### 阶段 F：测试、打包、提交与 review

1. 修正 Playwright：新 context 自然隔离，只在首次初始化清状态；补 cli 字段、合法模板结构、正确中文文案、模板选择及准确步数。
2. 测试失败输出 URL、DOM、console/page errors，必要时截图。保留确定性 mock 测试，明确其只证明 UI 契约。
3. 增加真实 API 的隔离 E2E：实际建成员与线程、发送唯一文本、确认服务端接收与刷新保留；按计划增加至少一次真实 CLI 调用验收。
4. 将新测试接入仓库自动执行；运行定向单测、API route、guide、类型、增量格式检查和 production build。
5. 按 `quality-gate` 汇总原始需求覆盖及风险证据，清理无关构建 diff，提交推送原 feature 分支。
6. 在新 HEAD 上构建 Windows 安装器。不要用旧 `.next`/dist/unpacked 冒充新产物；记录源码 SHA 与构建日志。
7. 构建前审查脚本删除/重建目录的绝对路径，确认只涉及此 worktree 的生成物；使用隔离安装目录验收，保护现有数据。
8. 输出安装器绝对路径、文件大小、SHA256，验证启动、首启界面和必要依赖；打包失败与代码测试结果分开报告。
9. 更新 #1519 描述和证据，等待实际 CI；按最终 HEAD 安排独立 review，修复 findings 后再走合入门禁。

## 8. 可复用命令

以下为继续实施时的命令参考，**不代表本轮已经全部执行或通过**。

```powershell
Set-Location 'G:\AIwork\clowder-ai\worktrees\feat-onboarding-first-run'
git status --short --branch
git remote -v
git fetch upstream main
git log -1 --format='%H %s' upstream/main
gh pr view 1519 --repo zts212653/clowder-ai --json headRefOid,baseRefOid,mergeable,statusCheckRollup

# 直接运行本轮通过的前端定向测试；仓库包装脚本缺文件的问题仍需处理
$env:NODE_ENV = 'test'
pnpm --filter @cat-cafe/web exec vitest run src/components/first-run-quest/__tests__/client-step.test.tsx src/components/first-run-quest/__tests__/onboarding-journey.test.ts src/components/__tests__/first-run-quest-wizard.test.tsx src/hooks/__tests__/usePinnedSections.test.tsx
node --import tsx --test packages/api/test/first-run-auth.test.ts
pnpm --filter @cat-cafe/web exec tsc --noEmit
pnpm --filter @cat-cafe/api exec tsc

# 修正测试并准备依赖后再执行；所有服务使用本 worktree 独立端口
pnpm --filter @cat-cafe/web exec node --test test/browser/first-run-onboarding.test.mjs

# 构建前恢复适合构建的进程环境，并确认 Inno Setup/Git tar 可用
$env:NODE_ENV = $null
$env:Path += ';C:\Program Files (x86)\Inno Setup 6;C:\Program Files\Git\usr\bin'
# 经路径/数据边界检查后运行 desktop/scripts/build-desktop.ps1
# 对最终安装器执行 Get-Item 与 Get-FileHash -Algorithm SHA256
```

## 9. 继续工作的硬约束

- 不在 main/master 或 `clowder-ai-main` 开发；所有代码继续放在 feature worktree。
- 不访问生产 Redis 6399；开发/测试使用 6398；不删除、清空任何用户持久数据。
- 不用 3003/3004 验证当前未合入代码，不以线上实例替代开发实例证据。
- 不输出、写入报告或提交真实 token/key；不在日志中回显构建用 GitHub token。
- 不把 mock 创建的线程叫作真实服务端 E2E；不把凭证文件存在叫作联网认证成功。
- 不把旧 unpacked 主程序叫作安装器；不把空 CI 列表叫作通过。
- 不自审、不冒充其他代理；独立 finding scan 不能代替最终 HEAD 批准。
- 当前没有执行合并、推送新代码、发布安装器或关闭 issue。

## 10. 下一次启动的第一项任务

**先保全未提交改动，拉取并对齐 `upstream/main`，解决 #1519 冲突；随后用“空账号库 + 已登录 CLI”实证绑定路径。** 这两步决定后续修复能否基于正确代码和真实用户场景推进。不要直接进入打包，也不要先更新 PR 宣称完成。
