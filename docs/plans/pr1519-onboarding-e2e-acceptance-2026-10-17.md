---
feature_ids: [F155, F229, F320]
topics: [onboarding, desktop, native-client, testing, compatibility]
doc_kind: validation-report
created: 2026-10-17
tips_exempt: 验收用例和已有能力的缺陷修复，不新增用户入口
---

# PR #1519 完整旅程：端到端用例、证据与阻塞

## 当前判定：No-Go，尚未达到整体交付标准

完整路径：真正干净首装 → 首次启动 → 自动协作演示与渐进预览 → 检测本机工具 → 自由选择/手动回退 → 一键创建 → 五工具真实任务 → 真实 A2A → 刷新、退出、重启后继续使用 → 完整 Setup 失败后同版修复。

干净指 Clowder 角色、会话和数据库为空；复用已授权的本机客户端认证及连接配置。不得清空旧数据制造首装。单元、HTTP 故障注入、实际安装、原生窗口证据分层，不能相互替代。

当前候选 f1fa89f86 已完成真正首装、五客户端真调用、四种真实 A2A、两轮完整 Setup 失败/修复及194e96886实际升级。含Fresh载体首装和三种启动故障后的恢复，共五轮五客户端任务全部自然done；此前 Claude 的失败保留，不宣称已确定其网关兼容问题的修复因果。手动创建、昵称保存、真实模型/强度选项、工具草稿往返及新角色真调用也已通过。旧100/120秒问题没有受控复现，原生拖动等未验收项保持开放；不能写成所有未知异常都已覆盖。

## 证据的身份与保护边界

- 工作树：`worktrees/feat-onboarding-first-run`，分支 `feat/onboarding-first-run`，PR #1519。
- 前两次真正首装的 API/Web/壳均来自 `194e96886bae95946df9092b888ab1c85780128f`，版本 1.14.0；包 SHA256 为 `FB3738CEECEB7464000ADA287A30C0D020E77EDA395E8F4F398A190944028E5D`。
- 该旧包没有后文首装 MCP 修复及两处额外 SDK 按需加载。最终候选已从 f1fa89f86562eab15439787eadf3656acaff0733 重新完整构建；包 SHA256 为 59F12E69283C7AA56D3DFF9348812F76054BC48718884C2FA3DB0A74133E5A0D，699197540字节，API/Web/壳记录一致。程序和数据目录 clean-final-f1fa89f86 均为此前不存在的新目录。
- 项目外证据根：`artifacts/pr1519-verified-build-20261016/e2e-20261017/`。正文列相对此根的文件名；不向公开评论发布本机认证、路径或原始模型请求。
- 首装目标分别是 `clean-e2e-194e96886`、`clean-e2e-repeat-194e96886`，每个目录的 `app` 与 `instance` 都是新建。后者已实际从194升级到f1，目录名不是构建身份；手动测试新增角色也保留，最终8角色、19会话、55个有效消息ID已保存并协调停止。各作者实例顺序运行。
- 端口 Web 5362 / API 3362 / Redis 6362；作者 Electron CDP 5363 仅用于实物页面取证，不进入交付默认。生产 3003/3004/6399 不参与。
- `client-homes.json` 只绑定已授权的五客户端与 npm cache。Clowder HOME、Redis、SQLite 保持隔离；不复制角色或会话。Claude 使用已有作者 API 配置副本，其他工具使用原有效登录位置，避免复制旋转 grant。
- 旧 B 实例、第一轮首装实例和用户交付实例的数据均保留。用户交付实例没有被作者测试写入角色/消息，尚未提供新“已验收”包。
- 早期 CLI 认证探测曾把源 Claude 模型别名从 `opus` 迁为 `opus[1m]`，已披露且没有静默改回；后续 API 认证检测改为只读，调用使用作者副本。不能声称整个历史测试期间原配置始终字节不变。

## 用例与最低验收断言

每条至少记录：构建/包 SHA、前置数据、操作、期望、实际结果、耗时、截图/日志、恢复及数据保留结果。失败和未执行都不能计为通过。

| 编号 | 前置与操作 | 验收断言 | 当前证据/状态 |
|---|---|---|---|
| I01 | 新程序与数据目录执行完整 Setup | 路径原先不存在；退出码 0；安装身份与 API/Web stamp 匹配 | 四次实际通过；旧194两次56.2s/52.3s，f1为57.638s，Fresh载体51.066s |
| I02 | 首次启动、无角色历史 | 独立 Redis；API/Web/renderer ready；默认 v2；无升级弹窗 | 实际通过；见阶段表 |
| I03 | 损坏 API archive manifest 的完整 Setup | 不启动损坏载荷；明确日志与非成功终态；保留外置身份/数据 | f1两轮实际退出20、数据10文件哈希不变；第二轮显式开启自动启动仍无启动尝试 |
| I04 | I03 后使用同版正常 Setup 修复并重启 | 无清库；原身份、角色字段、消息 ID、SQLite/Redis 可读 | f1两轮同版修复退出0，83.664s/80.284s，回读26/36条原消息 |
| I05 | 存量实例升级、连续退出/重启 | 配置字段与历史回读，无新重复角色；只退出本安装身份 | 194→f1实际升级81.818s，10文件哈希不变；5角色、12会话、39原消息ID回读，再五真调用通过 |
| I06 | 无效参数、端口冲突、启动超时、子进程非零退出 | 阶段/归属可诊断；不借用其他环境服务，不误报 ready | Fresh安装实物：占用223ms失败、子进程42在1806ms失败、挂起在121341ms失败；未调大120秒，原生弹窗像素未验 |
| I07 | 解压中窗口操作与中断 | 窗口可响应；退出有界，失败可恢复 | 拖动**未验证**；用户允许先日志，不能称已通过 |
| G01 | 首次打开，未完成引导 | 自动弹出并开始，无中间三选弹窗和额外开始按钮 | 实际 Electron 通过 |
| G02 | 自动 mock A2A 与右侧 HTML | 六阶段渐进；真实角色零创建；成果添加任务可交互 | 实际 Electron 通过，有截图 |
| G03 | classic/v2 各入口、重播/暂停/跳过、已完成再进 | 保留用户 shell 偏好；仅首次自动；既有手动入口可达 | 两shell真实生产页面的手动/演示/创建导航2/2；暂停重播等组件回归，不能把HTTP注入写为原生窗口证据 |
| D01 | 无工具/检测失败/慢检测/后启动 DSH再检测 | 三种状态可区分；有手动入口；刷新反映新工具 | HTTP 边界通过；不当作真实服务启动证据 |
| D02 | 五工具既有配置；Claude API配置、Codex OAuth | Codex/Claude/DSH/Kimi/Pi 推荐正确，API key不误报未登录；不主动调用模型 | 真实检测五工具通过；认证边界 41 项回归 |
| D03 | 缺 adapter、未登录、配置损坏或不可读 | 不冒称实际可用；坏工具不阻塞其他选择；配置不被覆盖 | 浏览器与服务边界通过 |
| S00…31 | 五工具全部 32 种勾选组合 | POST 只包含选择；零选择可离开；每个单选都能创建 | 32/32 浏览器通过 |
| C01 | 双击创建 | 一批请求；五个唯一幂等标识；无重复角色 | 通过 |
| C02 | 已有角色，再进入首配入口 | 不再推荐一键初始化，不改旧角色 | 实际 Electron 通过 |
| C03 | 中途失败、刷新、继续 | 成功角色保留；失败同 key/body重试；不重复创建 | 通过 |
| C04 | Claude失败后取消勾选，再继续 | 不再次提交Claude，其余被选伙伴可完成 | 已通过；另补充取消Claude后仍选中Codex认证失败的独立用例 |
| C05 | 401/400/403/409/429/500/503、网络/超时 | 401仅自动恢复一次；其他失败命名伙伴；有界恢复操作 | 通过，含提交前/后断线、31s超时 |
| C06 | 自动检测不可用，转手动创建 | 手动创建始终可达，不替换 main 原入口 | 浏览器通过 |
| C07 | 默认头像/性格/模型、短 ID、旧长 ID与自定义字段 | 角色可区分；跟随实际客户端；旧 ID/语音/session不丢 | 新五角色有实际头像；升级catalog字节哈希不变，旧长ID/自定义字段另有服务回归 |
| C08 | 手动模板创建、昵称保存、模型/强度选择、工具切回 | 真POST201/PATCH200；短ID/头像；刷新保留昵称；真实目录；往返无幽灵dirty；新角色真调用 | 实际Electron通过，保存227ms，记录save-id/request；原7角色字段未改，失败创建的数据也保留 |
| R01…05 | 各伙伴正常聊天完成随机中文任务 | UI POST202；目标 assistant含本次标记；lifecycle completed；invocation done；刷新可读 | f1共五轮五种均通过；每轮独立记录，不把旧Claude失败删掉或转绿 |
| R06 | 仅流式部分输出、问候、失败/取消、他猫或用户复述 | 全部不能满足 R01成功判据 | 纯证据正反例通过 |
| A01 | 首装不访问能力设置、创建后直接协作 | 启动前置 owner初始化6MCP；客户端调用时读同一注册表 | 实测发现P1后源码8/8；f1首装直接检查文件6MCP，未GET能力设置修复，三种A2A通过 |
| A02…04 | 单一用户请求唤起Codex，再传给DSH/Pi/Kimi，最后回传 | 真实委派/peer产物/回传input因果；恰好3调用全部done；无额外模拟用户唤醒 | f1真正首装后三种各1次通过；未显式修复能力设置 |
| A05 | 回传仍运行、提前宣称完成、无关/失败MCP读取、重复投递 | 不通过；真实MCP读取可作观察证明，但不能替代回传终态 | A2A与精确清理21/21反例通过 |
| A06 | Claude首选→Codex执行→Claude整合 | 单一初始POST、恰好3调用、委派/产物/回传因果及自然done | 194升级后实际通过48.334s，cleanup=[] |
| P01 | 保存Redis后协调退出、端口释放、同实例重启 | 原角色字段、原消息ID与标记逐个回读；再做新任务 | f1两轮修复回读5角色、9对话26消息及14对话36消息，首次修复后再次五真调用通过 |
| O01 | JS异常和阻塞弹窗 | 自动记录/截图/释放测试；仍判失败，不能悄悄dismiss后通过 | 浏览器真实alert与JS error注入通过 |
| O02 | 测试失败/超时的任务收尾 | 只取消本次thread的精确执行；成功仅自然等待；连续3空快照 | 6项清理反例通过；真实A2A cleanup=[] |

## 浏览器故障与导航矩阵：54/54

入口在 `packages/web/test/browser/native-team-setup*.mjs`，使用真正生产页面、组件及HTTP客户端，在HTTP边界注入故障；模型与真实安装不在这一层冒充通过。

- 全部32选择组合；HTTP六种失败、401恢复；检测失败/无安装/后启动刷新；手动入口；取消未登录Claude；缺ACP adapter。
- 草稿刷新、部分创建刷新、双击；Claude失败后取消；提交前断线、提交后丢响应；约31秒超时后重试。
- 新增阻塞dialog及JS异常观测的自证，避免测试看不到用户弹窗。
- `matrix-54.log`：54 pass / 0 fail / 0 skipped，105.808秒。包含当前源码真实Codex认证错误文案的恢复场景和classic/v2导航两项；检测失败/没有客户端的截图也已保存。每例断言相应请求体、幂等标识、角色数量、错误及图片加载。
- 该通道仅将Service Worker替换为无fetch拦截的最小注册脚本，确保故障能注入HTTP边界；真实安装通道使用原生产Service Worker，无模型/接口替换。

实际安装版的演示与渐进成果（不是独立原型）：

![安装版渐进演示](assets/pr1519-e2e-20261017/installed-demo.png)

下两图来自真实生产页面的HTTP故障注入，分别为无客户端、探测失败；未通过卸载本机工具制造场景：

![无客户端仍可手动创建](assets/pr1519-e2e-20261017/no-clients-http-fixture.png)
![检测失败可重新检测](assets/pr1519-e2e-20261017/discovery-failure-http-fixture.png)

## 真正首装的阶段测量

| 194e96886 实例 | Setup | API preload到监听 | services all-ready | renderer visible / load完成 |
|---|---:|---:|---:|---:|
| clean-e2e | 56.213s | 38.372s | 39.585s | 第一轮未单独汇总 |
| clean-e2e-repeat | 52.292s | 30.523s | 31.910s | 33.278s / 34.245s |
| clean-final-f1fa89f86 | 57.638s | 38.144s | 见main/desktop阶段日志 | 40.321s / 41.463s |
| Fresh载体 fresh-author-f1fa89f86 | 51.066s | 33.638s | 34.529s | 35.188s / 36.844s |

证据：`two-fresh-install-stage-metrics.json`、两套 `*-install-receipt.json`、`*-desktop-stdout.log` 及实例main日志。均为全新程序和数据目录；缓存未受控，不称冷盘benchmark。没有受控复现原100/120秒，不能因此关闭性能问题。moduleReadMs为hook累计开销，不等于独占磁盘IO，也没有证实Defender是根因。

第一轮测试要求URL含shell=v2，但Electron本来通过preload写localStorage，实际DOM/偏好已经v2。此为测试前提错误：失败保留，修断言后再做第二次全新首装，未清角色重试。截图 `native-fresh-observed-after-assertion.png` 显示实际壳的新UI与完整演示背景。

## E2E实际找出的首装MCP缺口与修复

新实例的capabilities.json只有7个plugin schedule，无任何MCP；Codex实际工具清单没有传球工具。原因：插件激活先持久化了稀疏v1文件，而首次正常聊天不会进入能力设置来补齐6个内置MCP。

修复沿用既有注册表、锁和原子writer，不新建owner/store：

```text
API首启
  └─既有capability owner：仅文件absent时初始化6个核心MCP
      └─插件追加schedule → 一键创建五角色
          └─原生carrier在调用时读取同一注册表 → 真实A2A → 全部调用自然终态
```

现存空/禁用/blocked/legacy/损坏配置原样保留，alpha不写文件或锁。再串起旧startup发现其会把显式空数组补齐，新增RED后修为保留空选择。`native-mcp-first-run.test.ts` 8/8覆盖fresh、5角色继承、plugin追加、显式空后续startup、legacy、禁用/损坏、alpha与并发。

本轮对旧194实例显式读取一次标准能力设置，文件恢复v2+6MCP后，Codex→DSH/Pi/Kimi三种协作都通过；这仅证明诊断对照，不代替新包自动首装。证据 `native-capabilities-before-owner-read.json`、`native-capabilities-owner-read-receipt.json`、三个 `native-a2a-*-terminal/live-journey.json`。

## 真调用和A2A的判据不能放宽

- 每次真实任务使用新随机标记，只从目标assistant读取；必须完成lifecycle并自然done。streaming、用户echo、问候和已取消半成品不算。
- A2A只有一次浏览器初始POST。用invocationId/producerInvocationId/inputMessageIds/发布时间，证明首选委派、peer实际产出、实际回传和最终整合；不是看到两个猫名就通过。
- 模型可在首个turn中通过配对成功的内置get_thread_context读取peer实际产物；记录toolUseId、结果消息ID及时间作为观察证据。仍要求真正回传调用完成，不能拿观察替代投递。
- 成功不取消合法任务；故障仅收尾本thread。DSH/Pi/Kimi三次各恰好3调用、全部done、cleanup=[]，耗时约34.7/30.1/25.9秒。
- 旧 `native-a2a-after-owner-read` 对实际MCP读取判假阴性；持久事件回放仅作诊断，不伪装新运行。
- 旧 `native-a2a-natural-after-owner-read` 曾PASS但收尾取消了仍running的return；该PASS失效，日志保留。强化终态判据后才产生上述三份新有效结果。

## Claude、启动加载与未验收边界

Claude历史阻塞（最终候选已五轮通过，机制归因仍有限）：本机CLI 2.1.301是唯一实际路径；完整889字任务已发送。原样脱离Clowder也会只回问候。私有透明代理发现user后有system环境消息，将其移入顶层或移除的对照4次通过；短prompt偶尔成功，SDK原样3次仍失败。原失败有网关请求格式兼容线索。f1在全新安装、完整修复重启、194升级、Fresh载体首装及启动故障恢复后，五轮五工具的原样严格任务都通过，另有Claude首选A2A通过。没有改写网关请求、静默换模型/载体或放宽断言；不能据此把全部历史失败因果归给MCP或SDK。

API认证检测先只读配置/环境；OAuth fixture清宿主API环境，确保真正跑auth status。42/42覆盖readiness、只读API模式、SDK与首装MCP边界，见 `windows-native-final-source.log`。

首启SDK懒加载又发现model catalog与本地session导入的两个静态路径，扩大禁止SDK导入的子进程测试先RED，再改为调用时加载；加载后已取消不启动query。API类型检查通过；catalog/startup/session回归14 pass、6平台skip。f1实物API监听38.144秒，loadHookCalls1815、moduleReadMs25290、resolve3645、CPU user7015/system1453ms。没有受控对照证明额外SDK改动带来显著收益，仍不等同“100秒已修”。

原生安装窗口拖动尚未验证；真实macOS、离线首次下载依赖、外部供应商所有账号策略不能由本Windows覆盖。每个未执行场景保持未验收，不能写成全部异常均已通过。

## 最终交付载体的独立首装

原候选默认指向已存在的clean-user目录，不能清空它来伪装首装。新增Fresh载体仅修改默认程序/数据目录到新的 `clean-delivery-f1fa89f86`，保留AppId与三个默认端口；API/Web/壳及payload没有变化。新包SHA256 `5464458B58E7276B8B23FA1DE1BEFA9028B32CC233E591CAEF988CF8687671EE`，699202772字节；`fresh-package-receipt.json`记录可逆的路径差异与原包SHA。

对这个新EXE再次使用此前不存在的 `fresh-author-f1fa89f86/app` 与 `instance` 真正首装。只补client-homes路径绑定，不复制认证或会话。`native-fresh-delivery-carrier.log`完整通过：自动thinking/typing、六阶段14.073/19.059/23.212/28.199/33.204秒到达后续阶段、iframe实际添加任务、五次真实创建、五种真实调用全部自然done、刷新可读、已有角色不再首配。没有GET能力设置来修复测试前提。额外Codex→Pi→Codex实际3调用done、cleanup=[]，37.668秒。

用户默认交付目录另行保留，仅有 `instance/client-homes.json`，无程序、角色、历史和Electron引导状态。作者验收不在这个目录进行，不能把它描述成已经启动过的零角色环境。

## 复跑入口

先确认明确归属的隔离实例与项目外证据目录。脚本拒绝生产端口、非loopback和未显式批准的真实调用；不清数据，不安装客户端，不复制认证。

```powershell
$env:CAT_CAFE_ONBOARDING_E2E_URL='http://localhost:5362'
$env:CAT_CAFE_ONBOARDING_E2E_EVIDENCE='G:\AIwork\clowder-ai\artifacts\pr1519-e2e\http'
node --test --test-concurrency=1 packages/web/test/browser/native-team-setup.test.mjs packages/web/test/browser/native-team-setup-edge.test.mjs packages/web/test/browser/native-team-setup-recovery.test.mjs packages/web/test/browser/native-team-shell.test.mjs
```

用真正新程序+数据目录安装目标EXE后执行fresh。CDP仅对明确归属的作者Electron启动时启用，缺省则测试自己启动浏览器；两种载体在record中区分。fresh遇到已有角色会失败，不清库。

```powershell
$env:CAT_CAFE_ONBOARDING_LIVE_CALLS='approved'
$env:CAT_CAFE_ONBOARDING_LIVE_MODE='fresh'
$env:CAT_CAFE_ONBOARDING_E2E_API='http://localhost:3362'
$env:CAT_CAFE_ONBOARDING_E2E_CDP='http://127.0.0.1:5363'
$env:CAT_CAFE_ONBOARDING_E2E_INSTANCE='G:\作者新首装目录\instance'
$env:CAT_CAFE_ONBOARDING_E2E_PID='实际Start-Process返回的主PID'
$env:CAT_CAFE_ONBOARDING_E2E_EVIDENCE='G:\AIwork\clowder-ai\artifacts\pr1519-e2e\fresh'
node --test packages/web/test/browser/native-team-live.test.mjs
```

fresh观察默认shell/自动演示/六阶段/交互成果/五工具检测/五真实POST/五真实调用/刷新/已有角色回避首配。不得预先GET /api/capabilities人为修复；新增监听断言也禁止此路径。

PID必须填写本次实际数字；不填写示例字符串或复用旧PID。原生模式先消费对应instance的启动report，再接入CDP。`node --test packages/web/test/browser/native-team-startup-ready.test.mjs`可独立回归该守卫。

```powershell
$env:CAT_CAFE_ONBOARDING_A2A_EXPLICIT='0'
$env:CAT_CAFE_ONBOARDING_A2A_PEER='pi' # 顺序再用dsh、kimi
$env:CAT_CAFE_ONBOARDING_E2E_EVIDENCE='G:\AIwork\clowder-ai\artifacts\pr1519-e2e\a2a-pi'
node --test packages/web/test/browser/native-team-a2a.test.mjs
```

保存Redis、按安装身份协调退出、确认端口释放、同实例重启，再用verify回读角色和全部成功消息并发送新任务。前一轮失败不能作“保留已通过”的证据；可独立保留原始消息回读，但整体验收继续失败。

```powershell
$env:CAT_CAFE_ONBOARDING_LIVE_MODE='verify'
$env:CAT_CAFE_ONBOARDING_LIVE_PREVIOUS='G:\AIwork\clowder-ai\artifacts\pr1519-e2e\fresh\live-journey.json'
$env:CAT_CAFE_ONBOARDING_E2E_EVIDENCE='G:\AIwork\clowder-ai\artifacts\pr1519-e2e\after-restart'
node --test packages/web/test/browser/native-team-live.test.mjs
```

手动配置使用同一真实调用授权、明确的作者实例和新的证据目录运行 `node --test packages/web/test/browser/native-team-manual.test.mjs`。它会新增一个作者角色，修改该新角色的昵称并发真实任务；不会删除失败创建或修改原角色。重跑前若上次失败留下未保存草稿，先在该作者页面明确放弃草稿，不能清localStorage/数据库掩盖问题。

## 安装版启动故障的可观测性用例

只对已备份的作者程序目录注入，不改用户交付EXE和数据。先完成真实正常首装与调用，再SAVE Redis、保存角色/消息ID、按安装身份退出、确认端口释放。每次故障分开准备、启动、观察、退出与恢复；不按通用进程名杀服务。

| 故障输入 | 期待诊断 | 判据与保留 |
|---|---|---|
| 自有HTTP夹具占用隔离API端口 | 在启动服务前拒绝，不借用503夹具作健康API | failed含具体端口；夹具仍由原PID持有，应用未关闭它；停止夹具后端口为空 |
| 作者程序的API entry临时替换为`process.exit(42)` | 子进程早退立即识别，不耗满120秒 | failed包含API、42、日志目录；退出原因落盘时无需先关闭原生弹窗 |
| 同一entry临时替换为不监听端口的`setInterval` | 原120秒门限维持，超时明确可诊断 | 119–135秒内failed；不调大超时、不把注入挂起当旧冷启根因复现 |

注入前将原entry备份并记录SHA；每轮launch receipt记录fault、精确主PID、app、instance及实际payload SHA。`native-startup-observe.test.mjs`是只读观察器，不启动/停止程序或改数据。它按当前PID等待`startup-state.json`，任何ready都失败；验证失败原因与时限，保留`.observed.json`。原生弹窗像素未被验证，记录值为false，不能描述成已经截图验收。

本轮三项实物观察均通过：占用223ms、退出42为1806ms、挂起121341ms；原生弹窗尚未关闭时，失败状态和具体原因已经可被测试读取。端口占用夹具未被应用借用或杀死，随后只关闭自有夹具。API原entry最终恢复为SHA `57B1A4AAE4D55E85414FB345985F4834D2436E9596F42FB9C4854B344A73D48B`，八项配置/SQLite指纹不变，RDB因Redis重启发生字节变化，另做消息ID回读，不掩盖该差异。

```powershell
$env:CAT_CAFE_STARTUP_E2E_LAUNCH='G:\作者证据目录\startup-child-exit-launch.json'
node --test packages/web/test/browser/native-startup-observe.test.mjs
```

退出每轮精确安装身份，恢复原entry并校验原SHA，才能正常重启；回读全部原角色/消息ID并重新执行五种任务。Redis重启可能改变RDB元数据，不能只用运行前后RDB字节差异推断历史损坏；配置/SQLite指纹、API消息ID与真实回复联合核验。原故障输出、测试断言失误与后续有效结果分别保存，不覆盖失败日志。

恢复后5角色、7会话中的15个有效原消息ID全部回读，再次五真任务全部done（`native-after-startup-faults-corrected.log`）。早期PowerShell快照将空会话的null也算入计数，16应为15；旧作者快照56应为55，原文件保留并另记计数更正。不是把null当消息或丢失数据。

恢复首轮另暴露测试自己的竞态：仅观察到产品URL就立即跳转历史页，中止了尚未完成的Electron首屏loadURL，壳按ERR_ABORTED停止服务。原失败日志保留。`native-team-browser.mjs`现要求明确instance和当前主PID，等待该PID的持久ready后才操作；failed立即报告，旧PID的ready不能通行。4项正反例通过，随后同一健康payload恢复通过，不为测试修改产品启动语义。


## 最终候选的完整安装器故障恢复

- 独立故障carrier只把API archive manifest的SHA改为64个0；原archive不改，正常候选不改，不交付故障carrier。`fault-final-carrier-delta.json`保留差异与双方哈希。
- 第一轮显式关闭自动启动：失败47.508s/退出20，随后同版本正常完整Setup修复83.664s/退出0；安装身份及9个数据文件哈希不变，重启读回5角色、9会话、26原消息ID，再完成五种真实调用。
- 第二轮**明确请求自动启动**：失败67.794s/退出20，没有目标App启动尝试、没有服务端口；10个受保护文件哈希仍不变。同版本修复80.284s/退出0，再重启读回5角色、14会话、36原消息ID。
- 以退出20、runtime failure marker和真实未启动的联合证据判失败；Inno仍会写通用的`Installation process succeeded.`，不能单独据这句认定成功。`final-autolaunch-fault-verdict.json`明确记录此差异。
- 这是失败闭锁与同版修复，**不是安装事务回滚**；不清Redis/SQLite，不恢复覆盖原数据，不用升级替代真正首装。

## 用户截图中认证报错的补充核验

“本机默认号未登录或读不到”在当前后端来自Codex原生默认账号校验，并非Claude登录提示。取消Claude不能消除仍选中Codex的认证失败；当前浏览器用例明确断言错误命名Codex，取消它后其余DSH/Kimi/Pi三位能完成，未提交Claude，也不重提Codex。

真实API集成用例也新增：Codex缺登录时返回400、catalog字节不变；恢复本用例自有的假OAuth fixture后，原key/body正常创建。最初RED来自该集成fixture跳过了host正常启动迁移，触发了main的历史owner/GLM模板回填；确认并非半创建Codex后，在fixture中明确执行与host一致的bootstrap前置，保留严格字节断言并得到GREEN。原失败保留，不改产品迁移或认证门禁来迎合测试。

本轮真实认证范围为本机既有登录/连接，其中Claude是API配置、Codex是本机OAuth。其他供应商认证方式和Codex仅auth.json API key但无进程环境的模式未作为本轮实物通过项；不能将42项认证/SDK回归写成所有五客户端的所有认证组合均已验收。

## 终态门槛

不能通过跳过Claude、修改预期、复用已修过的旧profile、覆盖升级代替首装、取消未完成回传、只测一次ready或省略原生失败恢复来变绿。目标二进制的全部必验场景通过、阻塞清零、旧配置/历史回读、review逐项处置和产物进程收尾完成，才宣布符合预期。作者测试不代替维护者approval，不自动关闭#1466。
