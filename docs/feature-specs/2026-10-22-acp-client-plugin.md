---
feature_ids: [F241]
topics: [acp, plugins, members]
doc_kind: implementation-plan
created: 2026-10-22
tips_exempt: "本地候选插件尚未发布，配置和绑定入口说明随插件 README 展示；发布目录接入时再提供可导航的能力提示。"
---

# ACP client 插件配置与角色绑定

来源：用户在本聊天授权本地实现、适配 dsh / Claude / pi 并端到端验证；不提交或推送远端。
Host 基线为上游 PR #1665 的 `5cb50be949eb737e4d60573a81e649f664a368c3`。
插件仓基线为 `c84ddd7`，分别使用独立 feature worktree。

Before：每只成员重复填写命令参数，插件实现绑定还需修改环境变量并重启。
After：插件管理页配置命名 client；成员编辑器选择已启用 client，保存即可对话。

## 契约与状态

- 插件为纯数据包，通过 `agent-provider.json` 的 `configurationKey` 引用 manifest 声明的 string 配置。
  值为有界 JSON 数组，Host 使用结构化编辑器呈现 id、名称、命令及逐项 argv，不要求用户手写 JSON。
- 保留 #1665 的单 provider 声明。新配置仍经已有配置、完整性验证、授权、激活和停用链路。
- Host 拥有 ACP 传输、身份、工作目录、MCP、回调凭证、进程和会话；插件只提供启动数据。
- 成员保存角色级 `agentProvider` 引用，不复制 client 命令。字符串选择插件；`null` 明确选择原生/手动工具；缺失才兼容旧嵌套引用及环境绑定。移除、停用或配置失效均不得回落到其他 client。
- 更新插件配置释放旧会话并重新注册。角色改绑释放旧桥；插件停用取消进行中调用。
- 配置页可展示未启用和无效状态；角色下拉只允许已激活的配置。持久化引用重启后恢复。

## 工作单元与证据

1. 有界配置解析和多 provider 激活：新增失败测试，API build、定向 Node 测试转绿。
2. 持久成员绑定与目录 API：复用 cats 写入、插件 owner 访问控制，验证缺失与停用不回落。
3. 插件包和配置/成员 UI：复用 Settings token，跑相关 Vitest、typecheck、正常视口的浏览器验证。
4. 实际 client：从本机安装确认 ACP 入口和版本，隔离实例验证两轮、工具结果、取消、重启续接及插件停启。
5. 最终 packed plugin 在空白 consumer 验证；代码、包哈希、会话及进程记录归档。

验证命令来源：当前 package.json。格式化使用 `pnpm biome format --write <改动文件>`，
API 使用 `pnpm --filter @cat-cafe/api build`，Web 使用 `pnpm --filter @cat-cafe/web exec vitest run <受影响测试>`。
只对适用面执行检查，不拿 mock 或直接 ACP probe 代替完整 UI/runtime 验收。

Architecture cell：现有 F241 Host-owned ACP extension；Map delta：none。
Why：复用已有插件配置、准入、运行生命周期和 SessionImplementationRegistry；不新增持久存储或进程所有者。
不会修改生产 runtime 或其配置，不使用 3003/3004/6399；测试状态永久保留并记录确切归属。
原生客户端隔离认证与历史：先确认实际状态根；不向日志输出凭据，不修改既有会话。

## MCP 与角色协作续办（2026-10-22）

用户补充验收范围：三个实际客户端必须调用 Clowder MCP 并参与角色协作，补齐 pi，仍不向远端提交。

- Host 自动提供协作 MCP、当前会话回调凭证与角色身份；用户配置只有启动命令和参数，不填写 token。
- pi 使用独立 `@clowder-ai/pi-acp` 桥，固定上游 pi-acp 版本及源哈希构建，透传 ACP MCP 到本机 Pi 1.3+ 原生注册 API。
- 仅注册当前会话，不写用户 mcp.json；新建、恢复、凭证刷新都应用新的服务器参数；重复配置和不支持的传输明确失败。
- 复用成员既有工具选择和 MCP 开关；选择插件 client 默认允许 MCP，保存后生效。
- 验证：协议新建/恢复、stdio/HTTP 参数、异常边界 → packed fresh consumer → 隔离真实客户端 MCP 调用和跨角色回执 → API 重启续接。
- 交付本地安装包、操作说明、真实消息/工具/会话证据及实例收尾；旧阶段 MCP=0 的证据保留，不用于替代本阶段验收。

## 源码提交范围（2026-10-22）

用户后续授权将 Host 与插件分别提交至对应仓库并创建 PR，取代前述仅本地保留的提交限制。
Host PR 依赖 #1665；插件 PR 依赖本次 Host 扩展。这里只提交源码，不发布 npm 或部署生产。
公开操作指南采用可替换路径与完整源码启动命令；原本机手册、认证、历史及原始验收数据在仓外保留。

## 可信主机兼容模式（2026-10-22）

用户在内网验证确认：引导检查通过，但配置保存被 `AUDIT_UNAVAILABLE` 拒绝；CodeAgent 仍有未定位的 EPERM。
后续将该历史共享模式拆成两项 Host 部署策略：Windows 祖先信任默认 strict；配置审计默认 required。只有 Windows、trusted-host、warn-bootstrap-root 同时生效且正常审计实际失败，才允许符合完整校验的已有 client 引导目录变更。新增 client 或混改命令、参数、bypass、MCP 不获得例外；鉴权、本机管理和目录自身私有权限保留。
旧变量仅 exact 1 对未设置的新键分别提供受限回退，显式 strict 会屏蔽审计例外。策略可一次持久配置并在正常重启后沿用；API 不自写部署文件。实现与验收边界见[计划](../design/2026-10-22-trusted-host-compatibility.md)及[操作说明](../ops/acp-trusted-host-compatibility.md)。不将本机合成 ACP 验证声明为真实 CodeAgent 或原企业机验收。
独立内网 Windows 发行版属于 D：内置 CodeAgent 发现与既有角色身份推荐，无需插件，预置持久默认值；不把该发行版默认值混入公共 Host。见[内网包指南](../ops/intranet-windows-codeagent.md)。
