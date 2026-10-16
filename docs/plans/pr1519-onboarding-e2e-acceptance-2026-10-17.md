---
feature_ids: [F155, F229, F320]
topics: [onboarding, desktop, native-client, testing, compatibility]
doc_kind: validation-report
created: 2026-10-17
tips_exempt: 验收用例和已存在能力的缺陷修复，不新增用户功能入口
---

# PR #1519 从零配置伙伴：端到端验收与异常矩阵

## 当前判定：未通过整体交付验收

用户要求的完整路径是：安装 → 首次启动 → 自动协作演示与渐进预览 → 检测本机客户端 → 任意选择伙伴 → 一键创建 → 正常聊天真实回复 → 刷新与重启后继续使用。干净环境隔离的是 Clowder 角色、历史和数据库，客户端应复用本机已经有效的认证及连接配置。

当前已完成 50 项浏览器故障注入用例、真实零角色引导和五角色创建。Codex、DSH、Kimi、Pi 的中文指令真调用通过；Claude 尚有“收到完整任务但仅回复就绪/问候”的阻塞，因此不得将该包称为整体通过。

以下四种证据分开记录：

1. **组件/服务测试**：验证纯逻辑、配置边界和状态分支。
2. **浏览器故障注入**：真实生产页面、组件、状态和 HTTP 客户端，注入检测/创建接口响应；不证明模型登录、外部额度或真实回复。
3. **安装版真实流程**：使用实际 Electron 程序启动的 Web/API/Redis，无接口替换，正常聊天输入后检查客户端回复和持久化消息。
4. **安装器/原生窗口**：单独记录安装方式、解压、服务及 renderer ready，不用浏览器截图冒充原生窗口证据。

## 构建、数据与授权边界

- 工作树：`worktrees/feat-onboarding-first-run`，分支 `feat/onboarding-first-run`，目标 PR #1519。
- 已运行候选壳：`e39d5ca1edfdd89a7f6376db8f074467665a02e5`；其 Web/API 功能构建来源为 `e93934a60357b02815dc2eaea0439d6a33b98758`，两者运行源码差异仅在安装脚本/测试。
- 本文随附的新 Claude API 检测修复尚不在上述旧候选二进制内，不能用旧包证明新代码已部署。
- 作者程序目录复用 `clean-version-b/app`；仅顺序切换至全新的 `first-run-instance` 数据目录。旧数据目录保留，不清库，也没有再安装一套程序。
- 作者端口：Web 5362、API 3362、Redis 6362；生产 3003/3004/6399 不参与本次验证。
- 本轮所有本机证据位于项目根 `artifacts/pr1519-verified-build-20261016/e2e-20261017/`，原始失败也保留。
- 显式 `client-homes.json` 只允许五种客户端目录和 npm cache 目录；不能改变 Clowder HOME、Redis 或持久化根。Kimi/Codex OAuth 共用原登录位置，避免复制会旋转的 refresh grant。
- Claude 为 API token 配置。发现其新版 CLI 探测可能迁移模型别名后，后续诊断使用作者隔离 HOME 内的 API 配置副本；不写回本机原设置。副本不包含源会话或历史。
- 用户交付实例没有被写入本轮测试角色或消息；未将未通过的候选当成新验收包交付。

## 浏览器异常矩阵：50/50 通过

运行源码位于 `packages/web/test/browser/`：

| 用例 | 数量 | 触发与操作 | 必须满足的断言 |
|---|---:|---|---|
| SEL-00…31 | 32 | 五工具全部 32 种勾选组合，包括全不选和每个单选 | POST 只含选中工具；零选择不创建且可离开 |
| HTTP-400/403/409/429/500/503 | 6 | 第一位成功、第二位报对应 HTTP 错误，再重试 | 显示失败伙伴及工具；成功伙伴保留；失败请求使用相同 key/body；不重复 |
| AUTH-401 | 1 | 创建遇到会话过期，前端自动恢复会话 | 自动且仅按原 key/body 重试，不要求用户误点第二次 |
| DISCOVERY | 1 | 检测失败 → 无工具 → 重新检测出现 DSH 等工具 | 失败与无安装状态不同；有手动入口；刷新可恢复；图片实际加载成功 |
| MANUAL | 1 | 从一键配置进入手动创建 | 自动面板退出；URL 保留手动入口；无意外创建 |
| DESELECT-LOGOUT | 1 | Claude 提示未登录，取消 Claude，创建其余伙伴 | 不提交 Claude，不阻塞其余四位 |
| ADAPTER-MISSING | 1 | Pi 已安装但 ACP adapter 缺失 | Pi 禁选，其他四位仍可创建 |
| DRAFT-RELOAD | 1 | 取消部分工具后刷新页面并重新检测 | 用户选择保留；只创建剩余选择 |
| PARTIAL-RELOAD | 1 | 第三位失败，刷新后继续 | 原两位不重复，失败项原 key/body 重放 |
| DOUBLE-CLICK | 1 | 双击创建 | 只有一批 POST，五个唯一请求标识 |
| DESELECT-AFTER-ERROR | 1 | Claude 创建失败后取消 Claude，再继续 | 不再次提交 Claude，其余四位全部创建 |
| NETWORK-BEFORE-COMMIT | 1 | 创建请求在服务端提交前断线，刷新重试 | 使用相同 key/body，最终恰好五位 |
| NETWORK-AFTER-COMMIT | 1 | 服务端已创建但响应丢失，刷新重试 | 服务端按 key 回放原结果，最终仍恰好五位 |
| TIMEOUT | 1 | 第二位请求不返回 | 约 31 秒恢复按钮并报错；重试保留 key/body；前一位不重复 |

结果：`browser-matrix-50.log`，50 pass、0 fail、0 cancelled、0 skipped，约 95.8 秒。

这条测试通道仅把 Service Worker 替换成无 fetch 拦截的最小注册脚本，以便 HTTP 故障注入准确到达边界；真实安装流程使用未改动的生产 Service Worker。没有忽略 `pageerror`，无未捕获页面异常才算通过。

## 真实安装版旅程

| 步骤 | 结果 | 证据与边界 |
|---|---|---|
| 新 Clowder 数据目录零角色、默认对话零消息 | 通过 | `first-run-profile-receipt.json`、`live-flow.json`；没有清空既有实例 |
| 首次进入自动弹出且开始演示 | 通过 | 无需再次点开始 |
| A2A 演示与右侧 HTML 渐进构建 | 通过 | 六个阶段全部观察到；演示不创建真实角色 |
| 演示成果可交互 | 通过 | 在 iframe 添加一条任务后能看到新条目 |
| 跳转真实设置检测五工具 | 通过 | `five-native-clients-real.png`；Claude API 模式未误报未登录 |
| 一键创建全部五角色 | 通过 | 五次真实 POST；五条实际角色配置；非默认头像 |
| Codex 正常聊天真实回复、刷新回读 | 通过 | 独特随机任务标记，响应来自 assistant，保存 message ID |
| DSH 正常聊天真实回复、刷新回读 | 通过 | 同上 |
| Kimi 正常聊天真实回复、刷新回读 | 通过 | 使用原有效登录，不复制旋转 grant |
| Pi 正常聊天真实回复、刷新回读 | 通过 | 使用本机 Pi 配置及认证 |
| Claude 正常聊天执行实际指令 | **失败** | 问候/就绪不包含本次随机任务标记；保留失败断言 |
| 已有角色后不再推荐首配 | 通过 | `view=setup` 被带回成员列表，推荐面板不出现 |
| 协调退出，Redis 保存，应用重启 | 通过 | 按实例身份退出；确认三个端口释放后重启 |
| 重启后角色、历史不丢 | 通过 | `restart-persistence-receipt.json`：五角色、七对话、12 条原消息 ID 全部回读；API warm restart 约 7.3 秒，**不是冷启动指标** |
| 重启后再次对五客户端发送新任务 | **整体失败** | `live-revalidation.log`、`revalidated-live/live-journey.json`；Codex/DSH/Kimi/Pi 再次通过，Claude 再次失败，整条 Node 测试 exit 1 |

真调用判定必须同时满足：正常 UI 提交得到 202、目标客户端返回本次独特任务标记、assistant 消息存在、页面刷新仍能读回。进程存在、HTTP 200、登录文件存在、“收到”或创建成功都不能替代这一判定。

## Claude 阻塞的证据与处理边界

已证实：

1. 生成请求记录中的 `message` 正文约 889 字符，包含完整中文任务和随机标记。不是前端漏发或只提交了句号。
2. 原始 CLI stdout 的确返回了问候/就绪，平台未自行伪造成功响应。
3. 当前本机客户端为 Claude Code 2.1.301，API 网关使用本机原配置。脱离 Clowder、使用 API 配置副本直接启动该客户端，也能出现同类“看到句号/等待任务”的输出。
4. 本机临时透明诊断代理只转发到原网关，不记录认证头；观察到用户任务后存在 `role: system` 的环境消息。把该环境消息并入顶层 system 或移除的四次对照均执行了任务，而未变换的配对请求失败。
5. 更短指令有时也成功，单次成功不足以证明修复；禁用实验 beta、能力环境变量、改用 append prompt 或 stream-json 输入等尝试尚未得到稳定通过，因此不作为产品修复提交。

当前有力线索是新版 CLI 请求格式与本机网关之间的兼容性，尚不能把范围扩为“所有 Claude 不可用”，也不能在没有新证据时修改公共 L0、伪造 provider 回答或静默更换模型让测试变绿。

另一个已落实到源代码的修复：API key/token 在本机配置文件或进程环境存在时，检测先做只读配置检查，不再为了这个场景启动可能迁移设置的 `claude auth status`。这只表示已配置，**不保证额度、网络或任务成功**。无 API 配置时保留原生登录探测。相关 RED 为四个 API 继承用例失败，GREEN 为 9/9 通过；OAuth fixture 清除宿主 API 环境，并断言假客户端确实收到了 `auth status --json`，防止意外继承让测试虚假通过。

配置保护的已知事实必须保留：早期调用原 CLI 探测后，源 Claude `model` 从 `opus` 变成了 `opus[1m]`。没有静默写回旧值；安装结束时源配置指纹原本一致，后续 CLI 操作才观察到这一变化。不可因此声称整个测试期间所有原配置字节都未变。

后置指纹检查：其余受保护配置与基线相同；Claude 原历史文件未变，Kimi 的原会话索引前缀完整保留，仅追加本次真实测试会话。桌面仅保留一个 `Clowder AI PR1519 Verified` 入口，旧测试入口可恢复归档；没有卸载旧程序或删除实例数据。

源码检查：本轮 API TypeScript 检查与变更文件 Biome 检查通过；只读认证回归 9/9、客户端目录/隔离/安装 hooks 回归 9/9。当前分支没有 `check:architecture-ownership` 命令，尝试结果明确记录为 unavailable，不冒称通过；本轮 helper 属于现有 native runtime readiness 路由，没有新建持久化层。

## 如何复跑

先确认当前是明确归属的隔离实例，设置自己的 Web/API 端口及项目外证据目录。脚本拒绝生产 3003/3004、非 loopback 地址和未显式许可的真实调用；它不删除数据，不自动安装客户端，不复制凭据。

故障注入：

```powershell
$env:CAT_CAFE_ONBOARDING_E2E_URL='http://localhost:5362'
$env:CAT_CAFE_ONBOARDING_E2E_EVIDENCE='G:\AIwork\clowder-ai\artifacts\pr1519-e2e\http'
node --test --test-concurrency=1 packages/web/test/browser/native-team-setup.test.mjs packages/web/test/browser/native-team-setup-edge.test.mjs packages/web/test/browser/native-team-setup-recovery.test.mjs
```

真实零角色流程，使用一个**确实为空的新数据目录**；发现已有角色时测试失败退出，不能清库重跑：

```powershell
$env:CAT_CAFE_ONBOARDING_LIVE_CALLS='approved'
$env:CAT_CAFE_ONBOARDING_LIVE_MODE='fresh'
$env:CAT_CAFE_ONBOARDING_E2E_URL='http://localhost:5362'
$env:CAT_CAFE_ONBOARDING_E2E_API='http://localhost:3362'
$env:CAT_CAFE_ONBOARDING_E2E_EVIDENCE='G:\AIwork\clowder-ai\artifacts\pr1519-e2e\fresh'
node --test packages/web/test/browser/native-team-live.test.mjs
```

随后保存 Redis，按安装身份协调停止并启动同一个实例，复跑保留验证：

```powershell
$env:CAT_CAFE_ONBOARDING_LIVE_MODE='verify'
$env:CAT_CAFE_ONBOARDING_LIVE_PREVIOUS='G:\AIwork\clowder-ai\artifacts\pr1519-e2e\fresh\live-journey.json'
$env:CAT_CAFE_ONBOARDING_E2E_EVIDENCE='G:\AIwork\clowder-ai\artifacts\pr1519-e2e\after-restart'
node --test packages/web/test/browser/native-team-live.test.mjs
```

verify 模式检查原角色信息、原消息 ID 与标记，然后再对五种客户端发送新的真实任务；任何伙伴失败，整条验收失败。失败记录和截图保留，不能删掉失败伙伴、改成只检查 HTTP 200 或把问候当执行任务。

## 尚未通过与不得替代的项目

- **Claude 真实中文任务仍是阻塞项**。需要在已证明的请求边界上找到稳定兼容方案，再重跑原样断言和保留验证。
- 新的只读 API 检测修复需要进入下一份实际构建，并在其安装环境复验；旧二进制不能代验。
- 本轮实际候选安装为**同程序目录更新**，耗时约 82.7 秒；renderer ready 约 46.6 秒。不是干净程序目录首装，不能替代最终包干净首装/冷启动验收，也没有据此认定性能优化完成。
- 安装器解压时原生窗口拖动尚未验证，遵从用户此前“先用日志，保留拖动未验证”的边界。
- 本机无法代表 macOS、离线首次下载安装器依赖、所有外部供应商限流与账号策略。相关模拟错误有对应恢复用例，但真实 macOS 和未运行的原生场景必须独立标为未验收。

只有目标二进制的干净首装、首次启动、上述真实旅程、五工具可用和数据保留全部符合预期，且阻塞清零，才能宣布本次交付达到预期。该文档和作者自检不代替维护者 review 或合并批准。
