---
feature_ids: [F032, F127, F143, F161, F241]
topics: [role-configuration, agent-client, implementation, acceptance]
doc_kind: implementation-plan
created: 2026-10-29
status: implementing
---

# 角色与 Agent 接入综合重构实施记录

接受的规范为 `C:/Users/Administrator/Desktop/猫猫咖啡馆/技术方案/综合重构方案-20261029` 内六份文件，哈希及全部验收条目见 [acceptance-ledger.json](acceptance-ledger.json)。以该综合方案为准：原生与 ACP 长期共存、配置为身份权威、纯投影不迁移配置库、现有 owner 承担保存/冻结/会话/权限。

目标分支 `feat/role-agent-refactor-20261029-gpt-sol`，基线 `6d8d4915bcd84edfeb42edf76466cf6318cecdbd`。本任务工位为 `G:/AIwork/clowder-ai/worktrees/role-agent-refactor-20261029-gpt-sol`；主工位和生产环境不改写。桌面 App 的 worktree 工具因聊天工作目录为 Git 外层目录而拒绝 sourceRoot，已改用仓库 `scripts/worktree-new.mjs`，先建 feature 分支再创建并登记 owner=codex/policy=merged。

## 约定范围与实施顺序

1. W0：核对最新源码、真实入口、在飞 PR 文件重叠、各客户端/载体与测试基线；保存验收总账。
2. W1：角色/执行纯投影；成员编辑权威与 dossier/名册；S1/S2/S3 保存、失败读回和各资源 CAS。
3. W2：完整冻结输入与实际消费者、L0 冻结渲染、写入通知、默认权限拒绝和实现 generation。
4. W3：现有 session record 的兼容摘要/原生片段；输入、取消和恢复的真实终态；原地身份更新须先采用再持久化。
5. W4：逐个保护 Claude、Codex、Gemini、AGY、Kimi、Pi、DSH、OpenCode、CatAgent、A2A、通用 ACP 的现有能力，接入冻结与能力投影。
6. W5：CodeAgent 单工具发现/合法声明/专属适配/网络环境；用户补充授权本机简单 mock，模拟契约证据与企业真实能力分开。
7. W6：26 项 C、4 条 E、4 组 Q 及性能检查；当前原生/ACP 的纵向切片通过后补全其余存量回归。
8. W7：按绑定启用、最终发行物和回退演练；无开放 P1/P2，数据与权限底线保留，环境有收尾回执。

分步提交不改变完成定义。总账中 NOT_RUN/BLOCKED/FAIL 不计通过；不会用一个局部绿灯宣称完整实施完成。

## 已核对的现状

- 正式成员入口是 MemberSettingsHost/MemberSettingsPage/useMemberEditor、MemberCreationPage；不复活旧 HubCatEditor。
- S1 已有成员 revision；S2 runtime override 已存 revision 但路由无 CAS；S3 ConfigStore 同步按键写入，正式端点无版本前置。
- 当前 ACP 缺 permission handler 的默认分支仍可允许；必须在真实 consumer 和 wire 验证拒绝语义。
- L0 和名册仍有 dossier 优先及全局重读；最终必须迁入冻结输入模式，不只新增 readonly 类型。
- 新 main 的 DSH secret guard 已存在，persona 组合必须保留其受信哈希约束。
- 在飞 #1596 与 ACP/工具链重叠；#1673/#1674 与取消链重叠；#1607 触及旧 HubCatEditor。已看具体文件，任务只在自己的分支实施必要改动，不整体移植这些 PR。

## 验收边界与环境

用户确认本机没有 CodeAgent 程序，允许简单 mock。它可证明接入合同和故障处理，不能证明企业发行物、真实认证或模型质量。macOS 未提供实际连接信息；按既有发布承诺确定所需组合后记录具体缺口，不虚构实机结果。

尚未启动本任务服务。之后实例必须维护任务台账；使用独立 HOME/原生状态根、无生产 3003/3004/6399，测试 Redis 端口先核归属；禁止清空任何持久数据。依赖和构建产物属于本工位，用户在用环境不停止。

Architecture ownership：涉及现有配置、context、invocation/session、approval 和 client adapter。准确 cell 和依赖映射在对应工作包实改前核对；不新增数据库、队列或通用 launcher。代码先观察可信 RED，再最小 GREEN；每个提交保存检查命令、结果与仍未覆盖的边界。

## 2026-10-30 阶段记录（尚未整体验收）

已实现：

- RoleProfile / ExecutionProfile 为现有 CatConfig 的纯投影，准入 binding 深冻结；未改 JSON 持久化模型。实际消费者全面改用快照尚待 W2。
- 同一次 template/catalog 合并保留字段来源。自身 L0、队友名册及原编译预览共用配置优先与 dossier 自述块抑制；显式空性格/空团队定位不复活旧文本。模板历史兼容和显式完整配置分别验证。
- S2 override 和 S3 Codex 全局键返回独立版本，正式端点无版本 428、冲突 409；Redis GET 与 Lua 比较写处理独立 owner 竞争。S1 原有 CAS 的无版本盲写仍须强制关闭并迁移其他正式写入者，C17 未完成。
- 正式 useMemberEditor 改为分步保存/局部提交，冲突保留草稿；S1 创建/PATCH 结果不明时先读回，重新进入按原 catId 核对后再写，不能换 ID 悄悄创建另一成员。S2/S3 只补交已修改且未采用的字段，读回成功的超时不假报总体失败。
- ACP stdio / HTTP 缺审批处理器时默认拒绝；明确允许仍需显式策略或 handler，仅选择协议实际提供的允许选项。未新增审批 owner。
- 用户授权的简单 CodeAgent mock 位于 `packages/api/test/fixtures/codeagent-mock.mjs`，包含 NDJSON 握手、身份文本、固定隔离文件工具、权限、持久两轮续接、取消未知与断线。由真正 AcpClient 启动独立 Node 子进程；不是企业 CodeAgent 或模型质量证明，专属发现/合法声明/适配接线尚待 W5。

本阶段验证集合分别记录，不相加为全量通过率：

| 验证 | 结果与范围 |
|---|---|
| API 相关 catalog / L0 / prompt / member / strategy / config 回归 | 496 项，494 PASS、2 SKIP（Redis 单独执行）；无 FAIL |
| ACP 两传输 / iCode / mock | 87 PASS；mock 中 7 项为真实子进程协议验证；缺 handler 的 stdio 两反例、HTTP 一反例先见 RED |
| Redis 持久化 CAS | 独立 owner 同 revision 竞争、GET 后 Lua 前改写，2 PASS；自建 6398 实例已 SHUTDOWN SAVE，端口释放、RDB/AOF 和日志保留 |
| 正式页面 hook / 保存恢复 / 身份来源等 Web 回归 | 6 文件 45 PASS；创建响应丢失、重进读回、PATCH 读回、不同配置不覆盖先见 4 RED |
| 实际浏览器 | `role-agent-refactor.journey.mjs` 1 PASS：生产 SettingsShell → MemberSettingsPage，编辑职责/保存/刷新读回及 Codex 全局 CAS，后端为本工位真实 Fastify 路由。浏览器路由/网络为隔离夹具，未调用原生客户端、不是最终安装包验收 |
| 类型与格式 | shared 构建、API tsc、Web tsc --noEmit 通过；目标文件 Biome 无错误，有原有及新增复杂度提示，未以批量拆函数掩盖 |

初始扩大回归的两处环境问题已明确：`audit-cc-system-prompt.test.js` 引用未公开脚本，现有 public-test-exclusions 已将其列为 source_only，正式相关集合按既有边界排除；convention graph 测试用 URL.pathname 在 Windows 得到错误盘符，改为 fileURLToPath。L0 等价测试仅规范比较边界的 CRLF/LF，不改变产品内容。旧账号必填夹具显式设为 managed_account，保留 native_tool 继承语义。

本地证据根：`artifacts/role-agent-refactor-20261029-gpt-sol/`。浏览器截图和 result.json 已回读；本机 Playwright 借用桌面随附库及已安装 Chromium 1228，适配 loader 只在该证据目录，不进入产品。mock 的所有状态根在 `packages/api/artifacts/role-agent-refactor/codeagent-mock/`，均为独立 HOME/USERPROFILE，不复用原生登录/历史。

Architecture cell 为 `identity-session`（其 identity-agent / runtime-binding 边界）；map delta 为新增代码锚点及投影/保存消费者说明，owner 不变。`cat-life-settings` 是生活/日记配置，与本任务成员设置无关，未借其名字建立新归属。

下一步顺序：完成 S1 必需版本及正式写入者迁移；完成冻结输入传到实际 L0/ACP/native consumer 与实现 generation；会话兼容、取消/回执/恢复；逐客户端保真与 CodeAgent 专属接线；固定 Q 样本、性能与平台/发行物矩阵；最终独立 review、启用和回退。macOS 与真实企业发行物仍无现场证据，不计通过。全部未覆盖项在总账保持 NOT_RUN。

## 独立审查第一轮

非作者 reviewer 审查 `2ec3bd6d30255b2b76d7fc7d3237c38f14eb8339`，结论 changes_requested，两个 P2，未申请全 Feature 终态通过。reviewer 独立验证原方案 6 文件哈希，定向 API 16/Web 11 项通过，另外实证两个恢复反例 RED；无新增工位/服务。

1. 来源元数据先看 raw catalog 的默认 variant/breed，而没有先看有效值已经被 template variant 占位，导致未编辑成员错误停用 dossier。修复按实际取值链选择来源，覆盖默认性格、breed 描述及旧 name→displayName 例外；新增普通/空性格的双 variant 反例先 RED，再 GREEN，真实继承仍为 default_variant。
2. pending PATCH 后用户改回旧 baseline，页面以 dirtyCount=0 截断核对；即使直接调 hook，旧 baseline 重基线也吞掉撤回意图。修复将待核对状态单独显示并绕过无改动短路，恢复时用 pending.form 判断提交后的编辑，保留用户撤回值。正式页面/hook 两反例先 RED 后 GREEN；实际浏览器通过响应丢失、读回失败、改回旧值、核对、再保存的真实 API 旅程。

修复后相关 API 集合 499 项=497 PASS+2 Redis SKIP；Web 六文件 47 PASS；浏览器两条旅程 PASS；mock+身份定向14 PASS。7 个新 `.test.js` 已验证进入现有 public resolver；未用未被 CI 发现的测试文件充数。mock 新记录补全子进程 PID、源码/dirty 标记、实际 adapter/fixture/Node 哈希和独立关闭状态；早期失败状态保留为 RED 证据，不补造过去的原生调用记录。

平台矩阵见 [platform-matrix.md](platform-matrix.md)，明确 Windows/macOS、CPU、内外网、已有承诺及未取得现场证据。当前修复等待同一 reviewer 复审，不自称通过。

复审回执：非作者 checkpoint_review 对 `74e0caebd503851803d923291ddce0ce3c25f8d4` 给出 `localReviewVerdict=approved`，同一 reviewSubjectRef；独立 API 19/Web 13 项及原恢复反例通过，核看恢复截图，两个 P2 闭环。未发现新 P1/P2，无新增工位/服务/源码改动。仅批准继续实施，不代表 W0–W7 终态。

## S1 写入前置条件收尾

成员 owner 和正式 PATCH/DELETE 端点拒绝无版本写入（428），旧版本返回 409。启停状态纳入成员 revision；DELETE 在核对成员版本之后才清理策略，复用原有目录锁，等待异步策略持久化期间继续持锁。修复此前 `return Promise` 提前经过 finally 释放锁的问题，未新增锁、事务或存储。

正式 SettingsContent 启停/删除和 MemberCloudIdentity 恢复操作携带成员版本；恢复动作的混合字段检查接受版本元数据。既有 API 测试客户端改为先读取当前成员版本，再提交原字段；保留新的盲写/过期写入反例，不为旧测试开放绕过入口。迁移时发现 `body`/`payload` 双入口覆盖，已修正并重跑；拒绝写入副作用测试先完成 GET 的已有目录迁移，再记录写入前字节快照。

验证：新增 5 项 owner/锁/真实 Fastify 反例先见 RED 后 GREEN；API 9 文件共 145 PASS；Web 4 文件 28 PASS；正式设置浏览器 2 PASS；API/Web 类型检查通过。账号回归中的 ACP 构造案例仅在测试进程显式使用已有 trusted-host 测试模式，避免把 runner Temp 父级 ACL 当作账号语义失败；并未验证或放松产品 Windows ACL。

证据为本工位 `artifacts/role-agent-refactor-20261029-gpt-sol/s1-*.log` 与 `browser-journey-s1.log`。无新增服务或原生客户端调用。C17 仍须与 S2/S3、并发和失败场景一并验收；当前只是 S1 局部闭环，等待独立审查。

独立审查 `d25959f95bc4a26b5fa688dddf16499ff1937ea1` 返回两个 P2。其一是旧持久草稿没有成员版本，428 未显示“重新读取并保留修改”，重开仍恢复旧 baseline；现将 428 和 409 一并进入已有恢复入口，验证重开、保留个性编辑、手动读取新版本、再次保存。其二是删除成员原本没有 S2 override，另一合法的 `none` 版本策略请求可在删除后落盘；现让 S2 PATCH/DELETE 复用同一目录锁，并在锁内重读持久成员存在性，不依赖尚未刷新的 registry。无新增事务或 owner。

两反例均先 RED；修复后 S1/S2 定向 API 22 PASS，保存恢复/actions/Codex Web 21 PASS。更早的 API 145 和浏览器 2 条为前一提交证据，不冒充这次最终源码全量重跑。reviewer 原始反例保存在独立审查证据目录，后续按修复提交复审。

复审回执：checkpoint_review 对 `b5e517d0c3c3ec909a6509ec6c14558f10d4e5a3` 给出 approved，subject 为 `task:01a1881e-1a7b-78d0-9a62-ff99b0ab7a01/checkpoint-s1`；独立原始反例 GREEN、API 22/Web 21 PASS，无新 P1/P2。只批准 S1 checkpoint。

## W2 L0 冻结输入切片（W2 尚未完成）

现有 L0 编译 owner 增加 typed FrozenL0Input：成员/名册、规则模板、治理、工作流和本次嵌入的用户 capsule 捕获为私有只读文本；输入摘要和编译器版本共同进入原缓存。共享 Node-only 模块承接原脚本的捕获逻辑，CLI 和 API 复用同一实现，不复制另一份身份解析器。public 在读取私有正文前使用独立白名单。API 不导入自举 CLI；子进程的 `--frozen-input` 模式只验证/渲染 stdin JSON，不读取当下 registry/profile/rules。选择已有 stdin 管道传输私有输入，未新增 IPC 服务或私有临时输入文件；原生输出工件仍由原 owner 管理。

准入 binding 增加冻结 L0，并用现有 CatRegistry revision 拦截异步工作区解析期间的配置变化。Claude print/bg/SDK、Codex、Kimi、OpenCode、AGY Native/ACP 的实际编译调用传入该输入且要求存在；真实编译器缺快照明确失败，不退回 live。AGY 手动压缩路由在控制准入处捕获同一输入，并保留原生 binding 严格哈希/工作区/账号检查。独立 CLI 继续允许 live 诊断，stderr 标明 configurationRevision/inputDigest，不记录提示词正文。

新增 3 项冻结协议及 2 项准入反例先 RED；旧捕获器与新捕获模块在删除重复实现前已比较 owner/public 实际产物一致。实际 Codex L0 子进程 + 替身 CLI 验证被冻结的 developer instructions，随后缺快照时不启动 CLI。AGY Windows 文件权限反例又实证了根路径/目标路径分隔符不一致，现统一比较；POSIX shell 测试引用 Windows 临时路径时单引号保护，CLI 测试用 fileURLToPath，不修改真实 shell 执行或降低预期。

| 本切片验证集合 | 实际结果 |
|---|---|
| L0/准入/Codex真实编译边界/Claude bg/OpenCode/F296 | 73 项：69 PASS + 4 既有本地 OpenCode 文件缺失 SKIP，不计为通过 |
| Kimi 与 AGY ACP 配置/权限/协议 | 63 PASS；ACP 构造测试的 runner Temp 仅按既有 trusted-host 测试模式隔离，非 ACL 实机验收 |
| Claude SDK 两文件 | 22 PASS |
| 压缩控制路由与 AGY 目标 guard | 15 PASS |
| dossier 显式根脚本回归 | 5 PASS |
| owner/public/edition 渲染等价 | 10 PASS；跨 edition 安装 hook 的额外 1 项在显式 Git Bash PATH 下通过 |
| 较大 invocation/routing/member 集合 | 217 项：213 PASS、4 FAIL；四项均进入既有 AGY Native 的 Windows 进程出生身份缺口，不计绿灯 |
| AGY Native 独立压缩 | 8 FAIL，首次调用因同一进程身份缺口无法启动；日志保留 |

Windows 默认 `bash` 指向失效 WSL 磁盘，额外 edition 用例失败来源已定位；测试进程显式选已安装 Git Bash 后通过，未改系统 PATH 或修复/启动 WSL。原生 ownership 工具在 win32 返回 null，相关源码与基线无差异；F325 原始 Feature 明确 Linux/Windows 未认证，因此保留候选和现场缺口，不把 Host 的 Windows 安装承诺误当该原生载体已认证，也不删除失败或新增 skip。MCP 测试仅规范路径断言分隔符；OpenCode host 编译的捕获条件已对齐实际 consumer，原有三条自愈旅程恢复通过。

尚待 W2：各 owner 完整 revision/generation 读前读后重解析；ACP/native 启动参数、MCP 暴露、权限/沙箱、model/effort 和非 L0 上下文消费者全面使用 binding；实现 generation 与受控启用。当前 registry 变化会明确要求重试，不能据此声称已经实现规范要求的完整跨 owner 冻结。会话兼容摘要/片段、CodeAgent 专属发现及 Q/平台/发行物验收继续保持未完成。

提交前定向集合复跑 `frozen-final-targeted.log`：157 项=153 PASS+4 既有本地 OpenCode 文件缺失 SKIP，无 FAIL。shared 构建、API tsc、Web tsc --noEmit 通过；目标 25 文件 Biome 无错误、68 条复杂度/已有风格警告；新增两个 `.test.js` 已验证由现有 public resolver 选中。较大集合及 Native Windows 的失败仍独立保留，不以定向集合替代。无新增服务/真实模型调用；本切片等待独立审查。

### L0 独立审查修复

checkpoint_review 审查 `2a69d4789ee16b44c2f50a2f768e4abffd888220`，返回两个 P2，subject 为 `task:01a1881e-1a7b-78d0-9a62-ff99b0ab7a01/checkpoint-l0`。其独立运行的 59 项通过，另外两个实际调用反例先见 RED：摘要后台入口缺少冻结输入，外部项目的冻结捕获改变了 Host 工作流覆盖目录。

现由实际后台 owner 补齐输入：curation provider 携带解析后的成员；摘要/线程馆员将真实 userId 传到 native run；任务提取和查询资格判断在现有入口捕获；离线 watcher 把自身既有专用指令冻结，不引入普通成员身份。public native admission 独立捕获 public 白名单，捕获前不读取 owner catalog/profile/governance。保留真实编译器缺快照拒绝行为，没有恢复 live fallback。共享根解析复用原有 Host 工作区算法，移除 task projectRoot 作为覆盖来源。未增加存储、协议或 launcher。

两个 reviewer 原始反例转绿，并将后台摘要、实际任务提取、外部工作区覆盖和 public 无 owner 读取的四条旅程纳入公开发现的 `background-frozen-l0.test.js`。实际 L0 仍运行独立编译子进程，原生客户端使用替身，未调用模型。旧命令路由夹具只有无效的半个成员对象，更新为同一真实模板成员，不能以 L0 捕获失败后的降级任务冒充模型提取成功。

| 修复后集合 | 实际结果 |
|---|---|
| reviewer 原反例 + 后台四旅程 + 任务提取/正式命令路由/查询 + 冻结协议 | 40 PASS，`l0-review-caller-green.log` |
| L0 编译/等价/准入/Codex 实际编译/Claude bg | 45 PASS，`l0-review-native-regression.log` |
| curation/source labels/watcher/account | 39 项：38 PASS、1 FAIL；失败为既有 Windows `plugin_native_workspace_not_private`，在 L0 前被拦截，`l0-review-background-ts.log` |
| public native 原有完整旅程 | 13 项：6 PASS、7 FAIL，同一 Windows 私有目录门禁；新增 public 捕获/真实编译旅程通过。保留 `l0-public-capture-tests.log`，不降低门禁 |
| 更早扩大后台 TS 回归 | 37 项：26 PASS、11 FAIL；11 项均为旧 MessageStore 夹具缺少必需 MessageFrom，在 L0 前失败；无本次改动，不修改无关夹具。`l0-background-ts-tests.log` 保留 |
| 类型和格式 | shared/API/Web tsc 通过；21 个目标文件 Biome 无错误，61 warnings、2 infos（随后删除新增测试未用 import）；diff --check 无错误 |

原生/public 载体的 Windows 认证缺口仍须按矩阵处理。上述集合不相加为完整验收率。无新常驻服务、模型调用或用户状态根复用；隔离测试目录保留原始证据。当前等待同一 reviewer 复审，W2 整体仍未完成。

复审 `847aa4d571f852fb35470038b5bd1608c595114f` 独立确认原两反例及调用集合 40 PASS，但发现原 overlay P2 的显式 cwd 变体：查询资格判断已有 compiler cwd=Host 配置根，API 进程 cwd 可与它不同。新增 owner-only `compilerCwd` 捕获参数并由该入口传现有 root，普通入口仍默认原 cwd，public 不读取此参数或 owner 源。reviewer 真实 child 第三反例及实际查询入口的 Host canary 反例先 RED 后 GREEN；`l0-query-overlay-green.log` 共 9 PASS（原三反例、后台四旅程、实际查询两旅程）。未把 task 工作区作为 Host 来源；等待修复后复审。
