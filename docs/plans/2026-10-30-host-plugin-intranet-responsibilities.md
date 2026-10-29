---
feature_ids: [F241]
topics: [host, plugins, intranet, delivery, acceptance]
doc_kind: plan
created: 2026-10-30
---

# Host、插件仓、内网发行：实施责任与验收

目标：基础重构负责角色、执行、会话与 A2A；CodeAgent 成为普通扩展客户端。一份工具定义可供多个角色选择，每个角色保留自己的名字、职责和会话。内网安装可用包后复用原生客户端与已有配置，必要时一次确认后长期生效。

依据：[收敛计划](G:/AIwork/clowder-ai/worktrees/feat-intranet-windows-codeagent/docs/plans/2026-10-29-intranet-convergence-execution-plan.md)、[基础设计](G:/AIwork/clowder-ai/worktrees/feat-role-client-architecture-20261029/docs/design/2026-10-29-role-client-refactor/README.md)、[本轮细化合同](./2026-10-30-codeagent-host-plugin-intranet-scope.md)。采用的基础实现为 `feat/role-client-refactor-20261029-deepseek-flash@99d68baa82e2d27ffde176df76f8d8eed6eb897e`，不改原工作树，不把基础整体完成计作本轮新增。

## 一、Host 公共能力：我们在 Host 仓实现

| 内容 | 本次实际工作 | 验收 |
| --- | --- | --- |
| H1/H2 客户端配置承载 | 固定插件也可声明一个连接配置；用已有插件设置表单覆盖路径/argv/引导目录/权限/MCP 白名单，校验边界，展示共享范围 | 默认安装启用形成一个贡献；非法 id/transport/env 拒绝；保存值实际进入 ACP 启动；不按角色创建 client |
| H3/H4 生命周期与保存恢复 | 修正配置后能重新注册；固定对象配置纳入既有 root-only 审计恢复条件 | 首次注册失败→纠正→恢复，不重装；例外不能夹带命令、参数、MCP 或权限变化；grant/事务校验保留 |
| H5 持久策略机制 | 只读 owner 文件 + env + 发行 preset + 公共默认，逐键解析；启动时一次安装进程快照 | 公共 strict/required；发行 preset 长期生效；显式覆盖优先；API 不改 .env/配置；改文件需重启；不改祖先 ACL |
| H6 离线接纳机制 | 首次安装状态机接受 pinned 本地 bundle，经现有摘要/包身份/接纳/配置/启用链；构建 staging 准备命令 | 首次离线注册、失败重试，已有安装/停用/卸载保持；pin 不漂移；离线失败不回落公共首次安装目录；不启动模型 |

Host 保有安装完整性、grant、运行生命周期、会话、取消/续接和 A2A 权威。使用通用注册/配置能力，不新增 CodeAgent 专用角色字段或 AgentRouter 分支。插件不能决定 Host 的目录策略、审计例外或管理访问权限。

当前独立 Draft：[固定客户端配置 #16](https://github.com/whutzefengxie-ops/clowder-ai/pull/16)、[持久策略 #17](https://github.com/whutzefengxie-ops/clowder-ai/pull/17)。它们以 fork 中精确基础快照为 base，尚未进入公共 main。[H6 离线预置 #18](https://github.com/whutzefengxie-ops/clowder-ai/pull/18) 位于 `feat/offline-acp-plugin-preload`，叠在 #16 上；独立审查与组合验收状态另记。

## 二、插件仓：我们提供一份 CodeAgent 包

| 内容 | 插件提供 | 验收 |
| --- | --- | --- |
| 固定定义 | `official.codeagent` / `codeagent`，稳定实现引用 `plugin:official.codeagent/codeagent`；默认 command=`codeagent`、args=`["--acp"]` | 工具选择只有一个 CodeAgent，名字/角色不改变稳定引用 |
| 可配置声明 | `configurationKey: connection`，默认 `{}`；非默认路径/参数等交给 Host 通用表单 | 标准 PATH 零必填；特殊路径确认一次，重启保留；没有三份宪宪/砚砚/墨墨 client |
| 参数与说明 | 标准 ACP 复用 Host transport；明确原生 bypass argv 与 Host ACP permissionPolicy 的区别 | 不默认开启 bypass/auto_allow，不将权限开关混成一个；打包内容与文档一致 |
| 包与适配验证 | manifest、声明、双语说明、测试、可安装 tgz；有真实方言差异才加专属 adapter | 实际 tgz 经 Host 接纳而非只测源码 JSON；修正错误/停用/重启恢复；包无企业凭据/二进制 |

当前 Draft：[插件仓 #166](https://github.com/zts212653/clowder-ai-plugins/pull/166)，`@clowder-ai/codeagent@0.1.0-beta.2`。真实包的 Host+ACP fixture 链路已验；未发布市场/npm，不把目录或 Draft 当作已发布。通用 ACP 目录仍可试新 client，旧 native/目录绑定保留，不按 exe 强制合并。

账号、企业 API、模型和 CA 优先复用原生 CodeAgent/已有 Host 成员入口；本轮不在插件里自建账号库，不把企业值打进公开包。多个角色可以共享启动定义，但身份和会话仍由基础分别保存。修改插件连接影响引用它的成员的后续执行，活动 turn 不被改写。

## 三、内网发行：我们接线，现场只提供环境输入与验收

| 内容 | 交付方必须处理 | 现场需要做什么 |
| --- | --- | --- |
| 配对与离线闭包 | 锁 Host SHA/插件版本/摘要，在 API staging 准备 bundle，选中发行 profile 的 offlinePluginBundle；安装闭包包含全部资源/依赖 | 安装交付 EXE；不手工补源码、装框架或联网下载插件 |
| 兼容默认与旧配置 | profile 选 trusted-host/warn-bootstrap-root；保留旧 intranet-host.json 的只读兼容、显式 strict/required 和原 AUDIT_LOG_DIR；不自动迁文件 | 普通用户无需设变量/建文件；管理员确需改策略才一次写 owner 覆盖并重启 API |
| 安装和升级身份 | 保留已有内网 AppId/GUID、marker、实际数据根和端口；公共/内网隔离；程序升级不覆盖认证、角色、绑定、历史或数据库 | 托盘退出后原目录升级；不先卸载、不清数据；原有可用角色继续用 |
| 真实 CodeAgent | 预置同一插件，不嵌企业私有 binary/认证；错误分层诊断 | 在 Host 运行账户安装/登录 CodeAgent；必要时确认 exe 路径及批准 argv 一次 |
| 默认伙伴与工具 | 只配置工具偏好和角色推荐，不把角色名做成 client | 新建两位不同身份的成员，共选一个 CodeAgent；旧成员不强切绑定 |
| Release 更新 | 独立 provider 项目；当前内网包不得误用公共自动更新源 | 先按批准的内网安装包更新；企业 Release 检测/下载尚未纳入本轮 |

内网不是再维护一套 Host/client 框架：长期差异应收敛为发行数据、插件包选择和必要的兼容接线。现阶段 **尚不能宣称“公共 EXE 换一个 JSON 就等同现有内网包”**：旧配置桥、安装身份和数据根等还需发行侧采用/验证。不会为了收敛而删除已验证的内网能力。

## 四、最终用户路径与验收边界

1. 原目录安装/升级，启动后已有成员、配置和历史可回读；CodeAgent 插件预置状态可见。
2. Host 账户的 PATH 与原生登录可用时直接选择 CodeAgent；否则在现有插件入口确认真实程序路径和参数一次，之后重启/升级继续生效。
3. 创建两个身份不同的成员，都选择同一个 CodeAgent；首轮、续聊和重启后继续，各自会话不串。
4. 按现有权限入口授予需要的 Clowder MCP；验证真实 MCP 调用和角色协作。引导目录兼容不等于获得 MCP grant；原生 bypass 也不会自动开启。
5. 出错时提供脱敏诊断；包接纳、Host 保存、恢复、安装/资源失败由交付方修复。程序缺失、账号/接口授权和企业网络由现场提供输入，不要求先改系统盘 ACL 或清历史试错。

本机已验：实际 tgz、Host 配置/恢复、双 ACP 测试进程会话与重启、持久策略进程测试、离线接纳及失败恢复；UI 证据来自隔离的真实配置组件与 Manager 路由，并非完整安装包首启。

现场待验：真实企业 CodeAgent 模型、Clowder MCP、角色协作及最终 EXE 首装/升级。用户已明确真实 binary 无法提供、由内网验收，因此本机 fixture 不作为这些项目的通过证据。H5/H6 的通用实现通过也不等于旧内网发行已采用，后续锁版本整包验收后才可宣布内网交付完成。
