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

checkpoint_review 对 `ab03ccacb5274ec9b1e6fcd48855f54088c5664f` 给出 approved，subject 仍为 checkpoint-l0；独立复跑 9 PASS，三个原反例和 public/默认/显式 cwd 边界均闭环，无新 P1/P2。只批准 L0 checkpoint，不代表完整 W2 或平台验收。

## W2 模型与 effort 消费切片（尚未完成 W2）

既有执行 binding 增加只读 executionPreferences，保存配置来源、解析后的请求 model/effort 及原生认证继承选择，不增加持久化模型或新注册中心。Host 在准入时捕获并传给实际 consumer；Claude print/bg/SDK/PTY、Codex、Kimi、ACP、CatAgent 优先消费该快照。后台摘要、查询、任务提取及 watcher 也在自身现有 owner 捕获。Git 作者与 OpenCode 模型/速度解析改用同一准入值。实际采用的 model/effort 仍只能由客户端观察报告，未将请求值复制成采用值。

ACP 的 source/model/effort 读取从租约之后移到之前；正式调用使用更早的 Host 快照，直接内部调用在自身入口捕获。两条真实 consumer 反例先 RED：租约等待期间改模型/effort或切换 configurationSource，都错误采用新值；现在实际 session/set_config_option 使用原值。Codex 最终 argv 验证显式偏好与空偏好两种情况；空 model/effort 不注入新覆盖，PTY 同样省略空参数。新偏好对象无账号密钥、token 或完整 env。

| 本切片验证 | 结果 |
|---|---|
| ACP 两反例 + Codex/PTY 最终参数 + 绑定 + 后台 | 11 PASS，`execution-preferences-final-targeted.log` |
| SDK/原生继承/watcher/query | 26 PASS，`execution-preferences-sdk-regression.log` |
| 通用 ACP / iCode / CatAgent | 131 PASS，`execution-preferences-acp-catagent.log` |
| 扩大 native / invocation / 正式命令入口 | 311 项：304 PASS、7 FAIL，`execution-preferences-native-regression.log` |
| 类型 | API tsc、Web tsc --noEmit 通过；API 构建缓存留在任务 artifacts，不修改产品 tsconfig |

7 个失败为：3 条 Claude bg 持久 owner 夹具在 Windows 无原生进程出生身份、1 条 Codex 缓存根断言硬编码 POSIX 分隔符、3 条 PTY 图像/自定义 HOME 断言硬编码 POSIX 路径。涉及进程身份和路径实现与基线无差异，未降低门禁、改期望为假成功或标为通过；也未改写无关夹具来刷绿。这里没有最终安装包、真实模型或 macOS 证据。

剩余的 thread effort/speed、全局沙箱/审批、MCP/ACP 磁盘配置、项目指令及跨 owner revision/generation 一致性仍按后续 W2 实施；当前部分测试通过不能替代 C05/C15 整条。无新增常驻服务或真实模型调用，当前切片等待独立审查。

checkpoint_review 对 `155d932501dbbba29686b24cf0c45b0e52926f2e` 给出 approved，subject 为 `task:01a1881e-1a7b-78d0-9a62-ff99b0ab7a01/checkpoint-preferences`；独立 27 PASS，20 个成员的新旧 effort 解析一致，无新 P1/P2。仅批准该提交，不含下一未提交切片。

## W2 线程偏好消费切片（尚未完成 W2）

ThreadStore 的内存实现返回可变记录，工作区捕获现复制该记录，避免等待后观察到另一轮写入。线程 effort/speed 沿用已有 getter，在执行准入时读入同一 binding；实际调用不再等待后重读。读入使用既有 preflightRace 的超时/取消边界，读取失败仍保留原来的继承行为和可见诊断。未新增线程配置存储、getter、版本或通用事务。

新增三反例先 RED：原记录后写污染快照、真实 ThreadStore 准入后修改 effort/speed 导致实际 invoke 收到新值。修复后均 GREEN，且原 F262/F291 的每轮读取、继承及失败诊断四条保持通过。最终集合 `thread-execution-freeze-final.log` 为 182 项=178 PASS+4 FAIL；4 条失败仍是已记录的 AGY Native Windows 出生身份缺口，不计通过。API tsc 通过；新公开测试已确认由 resolver 选中。

本切片解决已准入后的晚读，不宣称 workspace/偏好/账号/MCP 各 owner 之间的读前读后一致性已经完成。下一步继续配置一致性重解析、MCP/ACP/native 启动计划与全局策略冻结。无新增常驻服务或真实模型调用；当前线程切片等待独立审查。

独立审查 `7fe6cdb0f0db1bd1393abd5f6c7db1a372c56e5d` 返回一个 P2：已取消准入仍创建偏好读取 Promise；既有 preflightRace 提前拒绝，未消费的原始 Promise 随后失败，默认 Node 进程退出 1。现于准入入口、workspace await 之后检查取消，避免启动已废弃读取；读取 await 之后也检查取消，不能将取消中的准入报告为 ready。不改全局 race helper，已有在途读取仍由其原处理器消费。

reviewer 独立子进程反例和公开测试的三个时点（准入前、workspace 中、偏好读中）均先 RED 后 GREEN，使用严格 unhandled-rejections 模式；子进程不再崩溃、取消不返回可用 binding。最终 `thread-cancel-green.log` 为 186 项=182 PASS+原 4 条 Windows AGY FAIL，新增取消场景与原线程/诊断场景通过。API tsc 通过，Biome 两文件无错误、20 warnings。证据仍区分真实 Node 子进程与模型调用；本次没有真实模型调用或常驻环境，等待同一 reviewer 复审。

checkpoint_review 对 `87beb72db4b11ad061314ab9e85b8db053f5a3b9` 给出 approved，subject 仍为 checkpoint-thread-preferences；原崩溃反例、三个取消和三个快照场景通过，另外以已注册成员独立验证 effort/speed 两个 getter 的严格拒绝模式取消边界。该 P2 闭环，无新 P1/P2，批准仍限本切片。

## W2 Codex 全局启动策略切片（尚未完成 W2）

现有 codex-cli 解析 owner 增加一次只读捕获，把实际使用的 sandbox、approval、OAuth transport 和 served-model observation 放入既有 binding/options。Host 准入和后台摘要捕获一次；独立内部调用在 Codex 入口、首次异步准备之前捕获。实际 consumer 只用该值，保持既有枚举解析与默认值。任务 read_only、live 和 public native 的强制限制继续优先，不允许被冻结的宽松全局设置扩大它们的权限；不增加配置项、存储或 launcher。

实际最终 argv 反例先 RED：准入为 read-only，后续全局改 workspace-write，旧调用错误采用后者。修复后 native_tool、托管 OAuth 与 read_only 三旅程通过；最后的注册成员夹具为 `codex-policy-final-targeted.log` 3 PASS，验证 sandbox/approval、传输 provider 参数及 RUST_LOG 观测开关。受影响 L0/后台/原生继承/served-model 两载体共 37 PASS，`codex-policy-green.log`；扩大 Codex/config 回归共 123 项=122 PASS+1 已登记的 POSIX 缓存根断言 FAIL，`codex-policy-regression.log`。API tsc 通过；新测试公开 resolver 可发现。

这不是所有全局配置或 ACP/MCP 启动环境已冻结的声明；各 owner 的一致性重解析、MCP/项目指令及实现 generation 仍待继续。无真实模型调用或新增常驻服务，本策略切片等待独立审查。

checkpoint_review 对 `fa1a82a14b209cf7c20fe625c73d40c3b6019221` 给出 approved，subject 为 `task:01a1881e-1a7b-78d0-9a62-ff99b0ab7a01/checkpoint-codex-policy`；独立 23 PASS，包括内部调用首次等待后保留原 sandbox/approval/HTTPS/tracing，权限优先序保留，无新 P1/P2。仍只批准本切片。

## W2 ACP MCP 计划消费切片（尚未完成 W2）

AgentService 增加限定的 Host 配置捕获端口；现有 AcpAgentService 复用原 resolver，在准入时读取 capabilities、用户项目 `.mcp.json` 及验证过的插件 MCP 视图，返回独立描述符。原执行 binding 深冻结该计划，RegisteredSessionAgentService 和池的已钉住视图转发同一具体实现的捕获端口；正式 serial/parallel 入口保留原 ownerAuthProvenance 和成员 exposure scope。直接内部 ACP 调用也在池租约之前捕获，不再等待后重读。

MCP 描述符与每轮 callback 认证分开：仍在既有 session owner 获得所有权之后绑定当前轮凭据和刷新文件。配置解析失败不启动客户端池租约；捕获阶段取消沿用既有 preflightRace 并消费在途 Promise。该端口不启动模型、不改变插件 manifest 或 MCP 语义/权限 owner。

两个实际 consumer 反例先 RED：修改 capabilities 或项目 `.mcp.json`，租约之后的 session/new 收到新参数。修复后四条旅程覆盖这两种来源、正式插件 ACP 实现桥接、插件 MCP 的当前 Host 激活视图；准入后及租约中两次改写不污染原计划，普通 catalog 不能替代本次已验证的插件启动。新捕获过程中的取消以已注册成员、严格拒绝模式的独立 Node 子进程验证；成员 registry 在异步 MCP 捕获期间变化也被现有冲突门禁拦截。

| 本切片验证 | 实际结果 |
|---|---|
| 四来源冻结 + 四时点取消 + 线程偏好 + 认证轮换/空响应 | 27 PASS，`acp-mcp-freeze-credential-final.log` |
| 通用 ACP/iCode/MCP resolver/插件视图/Host 能力/池 pin | 155 项=150 PASS+5 FAIL；5 条在 Windows runner Temp 父级 ACL 处先失败，`acp-mcp-freeze-regression.log` |
| 上述 5 条纯池归属夹具的独立执行 | 既有显式 trusted-host 测试模式下 5 PASS，`acp-mcp-owned-lease-fixture.log`；未改变产品默认值，不能证明 strict ACL 实机通过 |
| invocation/L0/异步成员冲突/四来源 | 184 项=180 PASS+4 已记录的 AGY Native Windows FAIL，`acp-mcp-invocation-final.log` |
| 类型 | API tsc 与 Web tsc --noEmit 通过；新 `.test.js` 公开 resolver 选中 |

注册插件的新夹具最初缺 invocationId 而超时，已补真实调用必需字段，并用完成结果与租约门槛的 race 提前报告夹具错误；早期超时日志保留，不计通过。复杂度复核：复用现有 resolver、binding、AsyncLocalStorage 视图与凭据 owner，仅新增一项 Host 捕获端口及描述符载体；没有新存储、队列或 launcher。map delta 为 identity-session 的运行消费锚点和 mcp-surface-governance 的原投影消费说明，owner 不变。

尚待：其他原生客户端的 MCP/项目输入冻结、配置写入通知及各 owner 的读前读后一致性重解析、实现 generation、会话兼容与最终平台/工程任务验收。无真实模型调用或新增常驻服务；当前 ACP MCP 切片等待独立审查。

checkpoint_review 对 `8f852771c1e4aeca4dd6a27675c02466254325cb` 给出 approved，subject 为 `task:01a1881e-1a7b-78d0-9a62-ff99b0ab7a01/checkpoint-acp-mcp`；独立 24 PASS，覆盖 strict/unknown owner、外部项目、blockedCats 暴露策略和捕获后绑定当前凭据，无新 P1/P2。批准仍限该 ACP 描述符切片，其他环境变量引用与原生客户端配置仍须继续。

## W2 Claude 原生 MCP 消费切片（尚未完成 W2）

原 native MCP resolver 分为读取现有配置计划和绑定本轮凭据两个阶段；计划继续使用原服务器格式，记录已经验证的插件服务器来源。正式准入借用同一 Host 捕获端口，Claude print、SDK、后台、PTY 和回退包装器消费该计划。插件普通环境引用在捕获时解析，回调 transport 环境在启动时绑定当前轮；不把本轮 token 放入准入计划。read_only 的准入与启动都跳过 MCP 工具发现，serial/parallel 入口传递既有工具策略，不增加策略 owner。

五条真实消费边界反例先 RED：capabilities、项目 `.mcp.json`、当前插件激活、回退包装器和 SDK 读取准入后新值；修复后 GREEN，另加后台最终 argv、PTY 驱动参数与只读对照，`native-mcp-carriers-final.log` 8 PASS。这里的“真实消费边界”使用实际 Host/carrier/resolver 配合 fake spawn/driver，不代表真实 Claude 模型或 PTY 会话验收。插件场景还验证环境引用保留旧值、callback 使用当前轮值。最初夹具缺模板、SDK 误读保留为空的 sdkOptions.mcpServers 和后台 mock 等待错误事件，均修正后重新取证；早期失败日志保留，未计行为 RED 或通过。

扩大回归 `native-mcp-regression-final.log` 为 209 项=208 PASS+1 FAIL，涵盖既有 Claude/MCP 合并、carrier fallback/health、插件视图、Kimi 原生解析与 SDK。剩余 Kimi shared HTTP 测试使用 URL.pathname 作为 Windows 程序路径，`native-mcp-path-witness.log` 确认该路径及 collab.js 不存在，fileURLToPath 后存在；未改该测试或产品默认值，仍记 FAIL。首轮回归缺公共 registry 预加载已纠正，首轮结果不计有效回归。API tsc 通过，Biome 14 文件无错误；factory 只增加转发端口，不重排原文件格式。新增公开测试受 public resolver 覆盖。

复杂度复核：复用原解析规则、原 native server 格式、原冻结 binding 和 transport 凭据绑定；仅拆出确需复用的计划/绑定两阶段，不增数据库、配置 DSL、通用 launcher 或插件权限层。map delta 仅增加现有 consumer 锚点与消费说明。其他 native MCP、完整环境/策略/项目输入、owner revision 一致性重解析及 implementation generation 仍待继续，C05/C14 整条未完成。本次无真实模型调用、新增常驻环境或持久业务数据改写；本切片等待独立审查。

最终计划显式 structuredClone 后再交给深冻结 binding，避免冻结借来的 Host 视图对象。受影响凭据/取消/L0/ACP/Claude 集合 `native-mcp-freeze-credentials-final.log` 为 38 项=35 PASS+3 FAIL：两条既有 hook 测试硬编码 `/bin/bash` 在 Windows ENOENT；一条凭据文件测试把 POSIX mode 0600 作为 Windows ACL 证明而得到 0666。未修改这些测试或降低权限要求，均不计通过；当前轮凭据轮换和冻结反例通过。这些夹具失败不能替代 Windows ACL 的真实验收。

checkpoint_review 对 `e241747ae71c202b7846c3516651014fea6aa299` 给出 approved，subject 为 `task:01a1881e-1a7b-78d0-9a62-ff99b0ab7a01/checkpoint-claude-mcp`；独立 25 PASS，补验真实内置 MCP 的当前轮 HTTP 凭据、材化不修改计划、插件环境不重复展开及 strict/unknown/只读边界，无新 P1/P2。批准限该 Claude MCP 切片。

## W2 配置捕获与账号环境顺序切片（尚未完成 W2）

Kimi 的原生 HOME 依赖所选账号环境，而旧捕获端口早于账号解析。现先调用原账号冻结 owner，再把同一绑定的 accountEnv 和成员 mcpSupport 交给 provider 捕获；仍在既有成员 revision/取消门禁内。F171 原环境过滤逻辑从实际 invoke 前移到冻结 owner，后续 invoke 直接消费同一投影；模板映射与 callback 权限分离、空字符串、非法 key 和 CAT_CAFE_ 过滤均保持原规则。原 deepFreeze 供准入的最后组装复用，不重新解析账号，不新增配置存储或解析框架。

反例先 RED：provider 捕获得不到账号 HOME，捕获期间账号文件变化使后续绑定采用另一份账号配置。修复后同一账号 HOME、普通环境、成员 MCP 开关均保持准入值，实际 invoke 消费一致；过滤不修改原 account projection。`account-environment-consumer-final.log` 1 PASS；扩大 `account-environment-green-regression.log` 231 项=227 PASS+4 原 AGY Native Windows 出生身份 FAIL；API tsc 通过。这里只把既有账号环境连接到捕获端口，Kimi 原生配置计划、全局 ambient env、各 owner revision 一致性与重解析仍待继续；无真实模型调用或新增常驻环境，等待独立审查。

checkpoint_review 对 `6c34051ee463c9dfc7b8e1cb7c1aa0bd2579378d` 给出 approved，subject 为 `task:01a1881e-1a7b-78d0-9a62-ff99b0ab7a01/checkpoint-account-environment`；独立 44 PASS，补验 native_tool 不读取应用账号库，以及缺有效凭据的托管账号在 provider discovery 前失败，无新 P1/P2。批准限该账号环境顺序切片。

## W2 Kimi 原生 MCP 消费切片（尚未完成 W2）

Kimi 复用现有 native MCP resolver 和项目配置借用 owner，在准入时捕获允许服务器、成员 MCP 开关、原生 HOME、Git 项目根及拒绝层路径。实际 native 读取、secret hooks、MCP 文件和最终 spawn 都使用同一 HOME。既有显式关闭 Host 注入模式仍不借用项目文件；关闭成员 MCP 则仍覆盖并拒绝所有原生层，不能被随后成员配置变更绕过。未创建第二 HOME、认证库、launcher 或通用版本框架。

Kimi 无法完全关闭原生自动发现，因此启动前仍读取下层配置以补充拒绝项：未知/新增原生工具只能被禁用，不能加入允许集合或替换已准入参数；使用计划副本，不污染冻结对象。Git 根变化时在写入项目文件前明确拒绝。原文件备份、独占锁、改动冲突保留和凭据清理沿用既有 owner。此处的负向收口读取不作为可变配置的允许回退。

五个原反例 `kimi-mcp-red-consumer.log` 先 RED：capabilities/项目参数晚读、MCP off 晚读、原生层变化伴随允许参数晚读、显式关闭注入时 HOME 未钉住。最终新增实际 invoke 与 Git 根变化两场景，`kimi-mcp-consumer-final.log` 7 PASS，验证最终 MCP 文件/进程环境和租约恢复，仍使用 fake spawn 而非模型。首轮对原生层变化的临时拒绝断言未作为最终方案；最终使用既有“未知工具拒绝”规则，既保持冻结允许项，也允许任务继续。

扩大回归发现并修复三个真实凭据回归：原 resolver 对内置 split 入口的环境绑定不能只依赖最后一个安装路径校验器。现由原 isManagedCatCafeSplit/本机 fallback 解析分支记录入口来源，启动时按原规则绑定当前轮凭据；外部同名服务器不因名字获得该权限。Kimi 凭据文件材化仍去除 inline token，并保留 caller-owned 文件。`kimi-mcp-callback-green.log` 25 PASS（实际原生 MCP 握手与凭据恢复、七条 Kimi、八条 Claude）；API tsc 通过，7 文件 Biome 无错误，公开 resolver 选中新测试。

最终 `kimi-mcp-regression-final.log` 189 项=186 PASS+3 FAIL：一条既有 Kimi shared HTTP 测试的 Windows URL.pathname 问题；一条 hook 测试的 POSIX mode 断言；一条旧 hook 测试期待拒绝本地 ReadFile/WriteFile，而基线 F333 native-secret-policy 仅约束识别出的外发 shell 操作。`kimi-secret-policy-witness.log` 和基线 diff 确认策略/该测试均未由本任务修改，不把旧预期改成通过，也不恢复已经移除的策略。复杂度复核与 map delta 均限现有 native/MCP/凭据 owner；无新服务或真实模型调用。其他 native MCP、完整 env/策略、跨 owner 一致性重解析、generation、会话兼容与整体验收仍待继续；本切片等待独立审查。
