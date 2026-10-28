---
feature_ids: []
topics: [plugins, feedback, privacy]
doc_kind: implementation
created: 2026-10-28
---

# 反馈插件宿主承接

用户已批准插件交互并要求实现、提 PR。业务源位于 `clowder-ai-plugins/packages/feedback`，宿主提供通用底部 UI slot、隔离面板与安全诊断 seam，不加入反馈主页、不默认安装未发布插件。

## 调用链与所有权

`PluginRuntimeCarrierRouter.start/stop → DeclaredPluginUi → owner-local plugin-ui route → ModuleHostInvocation → plugin action`。

`WorldRail/ActivityBar → PluginUiEntries → opaque iframe + nonce/window-bound postMessage → session apiFetch → declared command`。

诊断由激活态 neutral Host 提供 `diagnostics.describe/collect/analyze`。每次检查同一安装实例、包摘要、启用态及当前 owner HTTP lifetime；原生工具、其他插件、过期面板不能继承确认权限。该 seam 为可选，缺失时插件保留直接/手动反馈。

架构归属：Host 管理安装生命周期、session/owner 权限、UI 隔离、成员服务与账号；插件拥有表单、脱敏、排查配方、报告、确认、持久化提交日志及平台适配器。UI 复用现有 public command/slot-item 结构，无新 manifest kind。

## 材料与原生边界

日志仅从当前实例 logger 根读取最近 15 分钟、有界的结构化 warning/error，排除 stack、原始行、认证文件和历史库。用户选中日志后，由插件本地脱敏并展示，再确认交给所选 Client。

现有配置决定成员、模型、账号；仅提供已实现安全文本诊断能力的服务。Codex 在同一服务内选择一次性 exec 文本路径，关闭 shell、网络搜索、插件、Apps、记忆、规则、hooks、多 Agent 等工具面；Claude SDK 使用空工具表、单轮且不持久化会话。独立空工作目录，不续接业务会话。

普通调用保持既有 L0 注入；反馈文本诊断使用同一成员标识与最小诊断身份，不编译私有家庭/项目上下文。原生参数测试用抛错 canary 观察了 Red→Green，不执行真实模型。

## 验证与边界

- API 与 Web TypeScript 检查通过。
- owner dispatch、无权限调用、激活代际失效、保留 authority 到期、日志材料边界、Codex/Claude 私有上下文及工具/原生历史抑制测试通过。
- Web 面板 CSP/opaque origin/异常 HTML 单元验证通过。
- 配套插件独立 npm 包安装后，通过实际 Host React 组件、HTTP route 和模块调用端口运行 17 项联合浏览器检查；图片复制与下载为实际字节操作，剪贴板在测试内隔离。
- 联合验证的 Client 与远端服务为替身，未创建真实反馈单或原生会话。完整真实设置页安装、真实 Client 和内网目标仍需上线前验收；不以合成证据代替。

可复现：先在插件仓打包，设置 `FEEDBACK_ARTIFACT`、`FEEDBACK_NPM_CLI`，然后运行 `pnpm --filter @cat-cafe/api test:plugin-feedback:installed`。可选 `FEEDBACK_PLAYWRIGHT_MODULE`、`FEEDBACK_CHROMIUM` 指定已有浏览器运行时；所有临时数据放入 `FEEDBACK_JOURNEY_ARTIFACTS`。

测试服务使用随机空闲端口，台账在对应 artifacts 下，完成后已停止。未改生产 runtime、端口、认证、角色、会话、Redis 或 SQLite。两个 feature worktree 保留用于 PR 评审，合入前不部署。


复审修复：诊断 ID 使用真实 CliRawArchive 允许的字符；账号/模型目的地与配置代际绑定到确认，原生未知目的地明确标注。联合验证改用真实 Host 私有存储编码器（Redis 传输为替身），覆盖超过 1 MiB 的截图及元数据、部分上传恢复、已创建待回读链接。初轮 CI 的首装浏览器证明发现新增的空插件目录 GET 未加入其显式 HTTP fixture；已补精确只读响应和回归，未放开未知写入。