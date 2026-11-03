---
feature_ids: []
topics: [codex, proxy, issue-1666]
doc_kind: evidence
created: 2026-11-03
---

# Issue 1666 / PR 1785 retained experiment evidence

本分支仅属于贡献者 fork 的证据，不进入官方产品树。对应 [维护者请求](https://github.com/zts212653/clowder-ai/pull/1785#issuecomment-6594217982)。没有为这次导出重复调用模型。

实验源码：`e1fcfb3372d469b294ce54b1b3b17de452de5a71`；当前候选：`6852774b343077f7916c831b6bb254c6e5a885b0`。manifest 列出八个生产文件的相同 Git blob；后续修改为 next 合流和测试/CI，不把历史实验说成新 HEAD 重跑。

真实客户端 Codex CLI 0.163.0，通过隔离的 CC Switch 4.0.13 的 127.0.0.1:15721/v1，使用 kitcoding 第三方 Responses API-key provider。未使用 OAuth；代码中 family/clientId=openai 不是官方模型路由的证明。CLI/网关二进制 SHA256 在 manifest；网关 model/cost 只代表网关记录，不证明真实模型身份或账单。

## 可读取原件导出

- events-*.jsonl：从已保留原始事件逐条白名单导出，保留全部事件的 type/timestamp、session、原生输出语义和 marker；去除 status/system_info 的原始内容、机器路径、persona 与元数据，host 签名正文替换为标识。它们不是原文件逐字副本；manifest 的原始 SHA256 固定本地留存原件。
- invocation-results.json：首轮、续聊、系统代理组与 504 反事实组的事件窗口、实际 spawn 例外和 HTTP 计数。原始 baseline 结果未序列化 actualSpawnNO_PROXY，导出值来自保留 probe 的 baseline 分支；baseline-spawn-excerpt.txt 给出该段原文。preparedNO_PROXY 和实际控制环境不能混为一谈。
- gateway-records.json：五条原始网关请求记录，仅 provider 标识替换，保留请求/响应 ID、时间、状态与 token。CC Switch session_id 是每请求 ID，不是 Codex 原生 session。exec 两轮及 system-native 可在事件中匹配 response ID；direct 两轮仅凭唯一、不重叠时间窗口关联，不能声称响应 ID 精确匹配。
- native-session-headers.json：四个作者隔离根下的原生会话头字段及原始 rollout 哈希；工作目录脱敏。exec 两轮共用一个原生 ID，direct 两轮共用另一个 ID。
- proxy-records.json：HTTP 数组只有一次本地 POST/504。成功显式环境组 delta=0 仅指该 HTTP 数组，不能称全部代理流量为零。CONNECT 另计：1 次 allowlisted attempt，2 次 outside-allowlist reject；后两次无时间戳，不归属任何模型调用。
- remote-proxy-control.txt：保留的作者 curl stdout，非模型 HTTPS GET 的 CONNECT=200/HTTP=200/exit=0。allowed=true 仅证明允许尝试，不能单独证明成功；200 来源是作者工具观察，未经维护者独立重跑。

504 是同一修复版本在实际 spawn 前移除回环条目的环境反事实，不是旧程序；网关没有模型请求，故障代理 HTTP 请求 +1。正常显式组保留 existing.corp.fixture 并加回环，四次真实 exec/direct 模型请求网关均200。system-native 第五次成功时诊断为 windows_proxy_override_unsupported，原环境保留，成功不能归因于本补丁。

## 边界与收尾

受控故障代理不是企业设备。原企业现场待用户合入 next 后内网验收；PAC/WPAD、不支持模式和环境读取失败不宣称完整支持。真实 Unix 模型 host、正常 UI/重启旅程未测。此次仅连接测试 marker，无 MCP/callback 网络调用；共享 host/环境变化后的复用由已有自动化覆盖。

任务网关、故障代理与其私有 WebView 已停止，端口释放；私有认证/数据库/原生历史保留且未发布。原用户配置文件及只读系统代理值前后未变。原始认证、数据库、完整 rollout、绝对路径和本机实例台账不在此分支。
