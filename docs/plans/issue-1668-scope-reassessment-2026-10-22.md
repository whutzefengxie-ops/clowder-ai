---
feature_ids: [F241]
topics: [issue-1668, dsh, custom-provider, acp, scope-review]
doc_kind: plan
created: 2026-10-22
status: verified
---

# #1668：DSH 自定义 LLM 的收敛结论与验证

## 目标与结论

用户澄清的目标是：DSH 使用自定义 LLM 时，经 Clowder ACP 调用能够采用正确的 provider、模型、地址、协议和凭据来源。
本次指定验证 `kitcoding-claude`，并要求优先通过配置解决；只有确认 Host 偏差后才修改代码。

**该组合通过 ACP profile 配置即可调用成功，当前无需修改 Clowder Host 业务代码。**
原生 ACP 对照、最新 main 实际服务调用链和同会话续接均已完成真实模型请求。
修复方法见[DSH ACP 自定义 LLM 指南](../ops/dsh-custom-llm-acp.md)。

## 已定位的偏差

本机自定义 provider 在 Desktop profile 中，ACP profile 的用户 patch 为空。
DSH ACP bundle 因而仍选择默认 `deepseek-official / deepseek-v4-flash`。
同一配置根已有自定义路由的凭据引用，但这不会自动把 Desktop 的路由声明和选择带入 ACP。

基线最小请求在模型网络调用前失败，错误明确指向 `deepseek-official` 缺少 key。
这不是自定义服务拒绝了凭据，也不能据此认定当前 DSH 不支持自定义接口。
在隔离副本中，仅加入自定义路由声明与 `acp.config.provider/model` 选择后，请求成功。
未配置官方 DeepSeek key，未向 Host 注入一套新的凭据机制。

## 版本与方法

- Clowder：实测时最新 `upstream/main`，`74ad585dccefb884d3d9d67367c90a9b5c605442`。
- DSH：`687f282e8625c6b8d11ff58211a90524be2e4317`，源码包版本 `0.2.1-rc.2`。
- 时间：2026-10-22 15:35–15:39 UTC。
- 路由：用户配置的 `kitcoding-claude`；请求模型 ID 为 `claude-sonnet-5-5`，协议为 `openai-completions`。
  这里只确认网关采用的模型标识，不独立验证其底层模型身份。
- 原生测试通过 DSH CLI 源码入口启动 `--profile acp`，使用独立 `DSH_HOME`，避免本机包装器重设配置根。
- 最新 main 从实际构建的 `AcpServiceFactory → AcpProcessPool → AcpAgentService → AcpClient` 发起调用，
  没有替换这些服务为 mock；角色使用 `native_tool`、无 `accountRef`，模型留空以沿用原生选择。
- 请求通过诊断用 fetch 包装器转发，仅允许目标网关并限制请求次数；只采集路径、模型与状态，未记录认证头。
  原生客户端配置和凭据文件在测试前后哈希一致。

## 真实对照结果

| 场景 | 采用的路由 | 观察结果 |
| --- | --- | --- |
| 原生 ACP，用户 patch 为空 | 官方默认 provider/model | 缺官方 key；无模型网络请求，重现选择偏差 |
| 原生 ACP，配置目标路由与默认选择 | `kitcoding-claude / claude-sonnet-5-5` | `POST /v1/chat/completions` 返回 200，文本为 `KITCODING_ACP_OK`，ACP 正常结束该轮 |
| 最新 main，经实际 Factory/Pool/Service/Client | 同一自定义路由和模型 | 第一轮返回 `KITCODING_MAIN_OK`；第二轮在相同 ACP session ID 中正确返回约定词 `CEDAR1668`；两次请求均为 200，无 AgentMessage 错误 |

成功场景的新会话模型当前值为 `["kitcoding-claude","claude-sonnet-5-5"]`。
实际网关请求中的模型与其一致，没有静默回退到官方路由。
main 的 shared/API 构建通过；业务源码与上述 main 基线一致。

Windows 的首次 main 预检曾在子进程启动前被测试目录祖先 ACL 检查拒绝，未发出模型请求。
改用全新、由现有 Factory 创建安全权限的独立 bootstrap 目录后完成上述验证；
未修改既有目录权限，也未启用隔离兼容绕过。该启动环境问题与 provider 选择偏差分别记录。

## 收敛后的交付范围

本次交付配置指南、可发现的文档入口及上述验证结论。
现有 main 已有 ACP client 启动参数、角色绑定、opaque 模型选项与回执检查，应使用已有能力。
不将本次问题扩展到 readiness 状态机、成员 API、`@all` 过滤、跨工作目录投影或 Pi 行为修复。

验证使用独立配置和会话目录，原始凭据、配置、历史与日常 runtime 未修改。
测试创建的 DSH 子进程均已退出；实验历史保留在本地私有目录。
原始日志和含本机路径的诊断产物不随文档提交。

## 验证边界与后续条件

该结果覆盖一次原生调用，以及最新 main 服务链的首次调用与同会话续接。
它不代表已部署到日常环境，也不覆盖 Web UI 全流程、跨角色 MCP、重启恢复、其他模型或所有自定义协议。
官方路由的成功调用未实测；本次未改代码或覆盖现有官方路由配置。
Issue #1668 中其他客户端或独立错误展示问题不能凭这份结果一并关闭。

用户日常配置需按指南在实际 ACP 配置根合并相同路由，再从日常入口验收。
只有出现“原生 ACP 成功、Host 采用选择不同”的证据，才针对该偏差新增最小代码修复。
