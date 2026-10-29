---
feature_ids: [F241]
topics: [host, plugins, codeagent, intranet, configuration, acceptance]
doc_kind: plan
created: 2026-10-30
---

# CodeAgent 接入：Host、插件仓与内网交付边界

用户目标：安装内网包后，复用已有 CodeAgent 和原生配置；必要时确认一次程序路径和启动选项，多个角色共用同一个工具定义，保持各自身份和会话，升级和重启不重新配置。

本文细化既有[内外网收敛执行计划](G:/AIwork/clowder-ai/worktrees/feat-intranet-windows-codeagent/docs/plans/2026-10-29-intranet-convergence-execution-plan.md)及[三端落地方案](G:/AIwork/clowder-ai/worktrees/feat-intranet-windows-codeagent/docs/plans/2026-10-29-host-plugin-intranet-delivery.md)。旧计划的通用修复切片继续独立推进，不全部捆入 CodeAgent 插件 PR。

本轮工作树为 `feat/codeagent-plugin-extension`，基于用户指定基础分支的 `99d68baa82e2d27ffde176df76f8d8eed6eb897e`；插件工作树为 `feat/codeagent-configurable-plugin`，最初复用 `834ef916ca0e67bda8367dc0e842509e0555b896` 的 CodeAgent 候选，再将仅 CodeAgent 的提交重放到插件公共 main `d44d3378da0b1cfb9d837f3055e9a6a87db35004`，避免带入另一个 PR 的 ACP 目录/Pi 改动。两者均与原工作树隔离。本轮配置增量的实际证据见[验证记录](./2026-10-30-codeagent-extension-validation.md)，尚未完成发布或内网预置。本文是交付合同，不是完成报告。

## 1. 分工与基础依赖

| 归属 | 应交付什么 | 最终使用者感知 |
| --- | --- | --- |
| Host 公共仓 | 通用插件接纳、固定 ACP client 的配置覆盖、校验、注册、保存与失败恢复；统一运行与授权；部署策略的只读加载 | 在既有插件/成员入口配置，保存可重试，重启后仍生效 |
| 插件仓 | 一个独立 `official.codeagent` 包：固定贡献 `codeagent`、默认入口、非秘密配置声明、说明、包与协议验证 | 使用工具只有一个 CodeAgent；无需按角色复制 client |
| 内网发行 | 精确 Host/插件配对、离线预置、兼容策略默认值、原安装身份与持久数据保护、安装包及现场验证 | 安装一次；已有配置直接复用，特殊参数确认一次长期使用 |

身份/执行分型、执行快照、Host 会话与 A2A、通用权限/取消/续接及旧数据兼容属于[基础重构](G:/AIwork/clowder-ai/worktrees/feat-role-client-architecture-20261029/docs/design/2026-10-29-role-client-refactor/README.md)，实施状态以本分支的[基础验收记录](./2026-10-29-role-client-refactor-acceptance.md)为准。基础契约核心已有实现，真实客户端回归与部分生产接线仍有残余；不得写成整体已完成。

CodeAgent 标准 ACP 直接复用 Host transport；不增加品牌专用角色字段、AgentRouter 分支、A2A 队列或无必要的协议桥。新增必需的通用缺口作为 Host 小切片明确提交，不在插件里自建一套基础框架。

## 2. Host：本次实现与已有能力的边界

| 工作单元 | 具体改动位置 | 必须实现/验证的行为 |
| --- | --- | --- |
| H1 固定客户端也能配置 | `plugin-agent-provider.ts`、`declared/agent-client-library.ts` | 固定声明允许引用 manifest 的字符串配置键；默认 `{}` 即可注册；覆盖仅含 command、startupArgs、bootstrapRoot、mcpWhitelist、permissionPolicy；禁止修改 id/transport 或用包内脚本绕过执行限制 |
| H2 复用现有配置入口 | `routes/agent-client-library-routes.ts`、Web `useAgentClientLibraries.ts`、`PluginAgentClientsField.tsx`、`PluginManagerConfigurationSection.tsx` | 返回默认值与单客户端模式；显示一份连接配置，不出现添加/删除 client；非法内容保留并可修复；保存前明确共享范围 |
| H3 注册失败后恢复 | `declared/declared-runtime-contributions.ts`、现有 `carrier/runtime-carrier.ts` 配置刷新链 | 首次未成功注册时，修正配置并保存能重新注册；不要求卸载重装；启用/停用仍走现有生命周期及 grant 检查 |
| H4 固定客户端的 root-only 恢复 | `manager/acp-bootstrap/acp-bootstrap-config-recovery.ts` | 审计不可用时，对固定对象配置应用既有受限恢复规则；只能是真实引导目录变更，不能夹带命令/参数/权限/MCP 变更；原生检查、包/配置/授权事务围栏保持 |
| H5 持久 Host 策略，独立提交 | 既有执行计划 §4：`deployment-defaults.ts`、API 策略解析与启动、desktop 接线、env registry | owner > env > 发行 preset > 公共默认，逐键解析；API 普通启动不写配置；公共 strict/required，内网 preset 可长期生效；旧 owner/审计路径优先并兼容 |
| H6 离线包接纳，独立接线 | 复用现有插件 publication/install、inventory、完整性校验、启用与授权链；desktop 构建/首次准备负责调用 | 输入确切包及摘要，首次准备幂等；既有版本/配置不静默替换；只复制目录或标记 enabled 不算安装；默认不运行模型 |

H1–H4 是客户端插件的最小通用补齐；H5/H6 是发行所需的独立通用切片，不要求修改基础的角色/会话模型。既有 Windows 首启、DSH/Claude、名称提及、隐窗和安装保护修复按旧计划逐项核 main/基础吸收情况，不重复实现或整块覆盖文件。

共享边界：插件连接是当前 Host 项目范围内的共享设置；改路径/参数会影响引用 `plugin:official.codeagent/codeagent` 的成员后续执行。保存入口应明确提示这一范围。名称、昵称、职责、模型和现有成员级覆盖继续由成员配置管理；不能声称插件连接只影响一位成员。活动 turn 不因保存而改写。

三种权限独立：Windows 引导目录策略决定 Host 如何准备启动文件；`permissionPolicy` 决定 ACP 权限请求如何响应；Clowder MCP grant 决定工具授权。插件不能修改前者或代替后者。基础当前无交互审批通道，未明确允许的 ACP 权限请求按 deny 处理；`auto_allow` 必须明确选择，不能由内网标签隐式打开。

## 3. 插件仓：一份可安装、可配置的 CodeAgent

目标文件为 `packages/codeagent/{manifest.json,agent-provider.json,package.json,README.md,README.en.md,test/package.test.mjs}`；需要市场分发时再补真实 catalog 发布项。

固定契约为 pluginId=`official.codeagent`、贡献 id=`codeagent`、实现引用=`plugin:official.codeagent/codeagent`、command=`codeagent`、startupArgs=`["--acp"]`。固定声明通过 `configurationKey: "connection"` 读取默认 `{}` 的非秘密连接覆盖。标准 PATH 可用时零必填，安装启用即可形成一个贡献，无需先创建预置或保存空配置。

| 用户设置 | 插件声明/说明 | 实际执行者 |
| --- | --- | --- |
| 程序路径 | 默认 `codeagent`，特殊安装才覆盖为 Host 电脑上的绝对路径 | Host 解析并 spawn；不是浏览器电脑的路径 |
| 启动参数 | 数组默认 `["--acp"]`；每项独立传入 | Host 保留 argv 边界，不拼 shell 命令 |
| 引导目录 | 可不填；自动选择失败时通过既有检查入口选择 | Host 检查、建自身私有子目录并持久保存选择；插件不改 ACL |
| ACP 权限响应 | 默认 deny，可显式 auto_allow | Host 使用基础权限策略；不是 CodeAgent 原生 bypass 开关 |
| 账号、端点、模型、CA | 优先复用原生客户端与既有成员配置 | 原生 CodeAgent/现有 Host 账号机制；不复制认证到插件包 |

例如，非默认安装只需保存以下覆盖；成员名字或角色不出现在这里：

```json
{
  "command": "D:/Tools/CodeAgent/codeagent.exe",
  "startupArgs": ["--acp"]
}
```

用户明确选择原生 bypass 时，参数使用已提供的 `--acp --permission-mode bypassPermission --allow-dangerously-skip-permissions`，在表单中每行一个参数。保留已有明确配置，不自动开启。当前合同不新增任意 env；不把企业凭据/端点/证书实际值放公共包。

旧 `plugin:official.acp-clients/<id>` 与 native CodeAgent 绑定保持原样；不按 exe 名自动合并或强换实现引用。通用 ACP 目录继续用于实验新 client，与独立 CodeAgent 包并存。

插件发布验证必须从实际 packed artifact 开始：必要文件、摘要、目标 Host 契约、默认/覆盖、错误后重配、停用/启用和升级保留。源码 JSON 单测不代替 Host 接纳，也不声称尚未发布的包已在市场可用。

## 4. 内网：发行配置及现场输入

| 项目 | 交付方负责 | 内网用户/运维负责 |
| --- | --- | --- |
| 版本与离线插件 | 锁定 Host SHA、插件版本/摘要、打包闭包；包内带同一 CodeAgent 插件并经 H6 接纳 | 安装交付 EXE，无需联网另装框架 |
| 安装与数据 | 保留内网 AppId/GUID、已有 marker/实际数据根与端口；同目录升级不覆盖配置、认证、角色、会话、Redis/SQLite | 从托盘完整退出后按指南原目录升级；不先卸载/清数据 |
| 策略默认 | 发行 preset 提供 trusted-host/warn-bootstrap-root；旧显式 strict/required、文件和审计目录仍优先；H5 负责只读接线 | 普通用户不配 env；确需覆盖时，管理员仅一次设置既有 owner 配置并重启 API |
| 原生 CodeAgent | Host/插件不捆绑企业私有 binary 或认证 | Host 运行账户安装/登录；PATH 无法发现时提供真实程序路径和已批准参数 |
| 推荐与身份 | 一个工具定义，推荐值与角色模板分开；不再按砚砚/宪宪/墨墨复制 client | 创建多位成员时各自设置身份，共选 CodeAgent |
| 更新与发布 | 当前手动批准 EXE；禁止内网包误走公共更新源 | 使用批准的内网包；企业 Release 检测/下载由独立更新项目处理 |

Host 普通启动/API 不自写 `.env`、不迁旧配置、不修系统盘/祖先目录 ACL。插件也不决定 AppId、数据根、端口、Host 安全策略或更新源。发行层只能提供预设值，不能覆盖用户已经保存的值或扩大 grants。

用户路径：安装/升级 → 复用已有角色，或在原成员入口选择 CodeAgent → 必要时在插件配置确认一次路径/参数 → 两个角色分别对话/协作 → 重启继续。首次必要的启用/授权使用现有入口一次完成；“已安装/已启用/已登录/实际可调用”分别报告。

## 5. 验收与失败归属

| 责任与验收 | 可观察通过条件 | 失败归属 |
| --- | --- | --- |
| 实施方：Host 通用回归 | 固定/目录模式兼容；默认注册、覆盖被实际执行；非法字段拒绝；root-only 例外不扩大；初次失败后保存恢复；重启保留 | Host |
| 实施方：包到 Host 的纵向验证 | 实际 tgz/解包包经既有安装/校验/授权链形成一个工具；两成员稳定引用、独立会话；停用诚实拒绝、重启/重配可恢复 | 插件包或 Host 接线，按失败层定位 |
| 实施方：发行与升级验证 | 精确 EXE/manifest/哈希同源；离线首启；程序/数据隔离；现有身份、配置、授权、历史及未切换的绑定可回读 | 发行/安装链；不让现场补源码 |
| 用户：真实企业 CodeAgent | 实际程序与认证下首轮/续聊、Clowder MCP、角色协作、重启续用；多身份独立且无需再次配置 | 通用错误回 Host；客户端方言回插件适配；企业 binary/账号/网络由现场提供输入 |

本地没有真实企业 CodeAgent，用户已明确由内网验收，不再把提供本机 binary 设为前置。协议 fixture 只证明相应链路；不能代替企业模型回答、权限、MCP 和安装包验收。每条证据记录精确版本及真实/模拟/未验证边界。

实施顺序：核基础接收条件 → H1–H4 与插件配对闭环 → H5/H6 独立交付 → 内网锁版本与预设、整合被公共能力替代的补丁 → 回归与现场验收。各仓单独 PR；基础重构单独跟踪，内网 #1702 保持 WIP/Draft。当前 H5 已有独立 Draft #17，H6 本工作树见 Draft #18；机制实现不等于发行侧已采用。发行参数化/旧配置桥与整包验收未齐前，不能宣称“公共包只换 JSON 即等同现有内网包”。当前责任和操作清单见[三方责任表](./2026-10-30-host-plugin-intranet-responsibilities.md)。
