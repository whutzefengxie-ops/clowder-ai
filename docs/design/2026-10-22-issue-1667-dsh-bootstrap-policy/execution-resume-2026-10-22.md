---
feature_ids: []
topics: [issue1667, execution, coordination, recovery, windows]
doc_kind: note
created: 2026-10-22
author: codex
author_model: gpt-6.1-sol
reviewed_head: 3a50dec9c59ce59fa4a880ed055e7badd97d6d54
status: pending
tips_exempt: 执行中断的只读协调记录，不构成新复审或验收
---

# 执行恢复：区分项目投影不可用与作者执行失败

最新共享中断消息为 `0001792634969292-000123-0978b7af`（2026-10-22 02:09 UTC），正文只有“收到。让”和“执行控制面不可用”。它没有带来实现结果。工位本地 HEAD 仍为 `3a50dec9c59ce59fa4a880ed055e7badd97d6d54`；最新审查仍是 `checkpoint-3a50dec9c.md`，文件原生信任 P1 未关闭，整项未验收。

## 只读查证

- 本地 Git 命令正常；协作 thread/task 工具可用，父 Task 为 doing，读回 revision 11。没有把未挂载工具的旧观察当成当前状态。
- 当前 thread 的执行 projection GET 返回 **200**，其中可见本轮 codex 执行；没有作者的新完成结果。
- Host workspace 与 config-root 的 project projection GET 均返回 **404 PROJECT_NOT_FOUND**。`cat_cafe_get_running_work()` 返回 **503，source=F295**。
- 仓内 `companion-work-read.ts` 对上游非 200 或 project identity 解析不符统一返回 F295 unavailable。因此该 503 本身不能证明全部执行控制面故障，更不能证明 Claude CLI 退出或损坏。当前 Host project 的 404 足以构成此包装响应的一种解释；没有把它认定为旧中断的已证实根因。
- 文案“执行控制面不可用”在 `queue.ts` / QueueProcessor 的终态处理生成；文案不是 CLI 原生 stderr。旧回合为何被终态化仍待确切记录或作者的工具诊断。

探针仅访问本调用 `CAT_CAFE_API_URL` 指向的同一 Clowder API，先核对 loopback 和监听进程身份，使用同一 user 的 GET projection。不调用 Stop、cancel、force-reset 或启动/配置接口。不修改 runtime/账号/历史/Redis，也未读取 peer 原始 session transcript。

可复验材料在忽略目录 `.tmp/review-pr1669-control-plane/`：`probe.ps1` 与去除 token、header、控制句柄后的 `probe.log`。脚本绑定这次观察到的 API PID，进程变化时必须重新核实，不应当作长期部署脚本。HTTP error body 读取最初遇到 PowerShell 版本差异，修正后以最终日志中的状态码为准。

## 一次有界恢复探针

已通过 post_message 持久化并路由给 claude-code：

- messageId：`0001792639222752-000001-2c606cf6`
- clientMessageId：`issue1667-readiness-0001792634969292-000123-0978b7af`
- replyTo：`0001792634969292-000123-0978b7af`

要求先在该 feature 工位执行 `git rev-parse HEAD`、`git status --short`，保留真实工具名、exit code 和输出。成功后同回合直接续做原生文件验证、W2、池生命周期、F4/W4/W6；失败则只回传具体错误/cliDiagnostics/debugRef。该回执只证明已路由，不证明作者收到、命令执行成功或功能已恢复。

原安全与授权边界保持：不重启/停止 runtime，不改启动或运行配置，不用生产数据测试；不因这次中断砍范围，不把 A2A 回执当完成，不重跑无变化的安全复审来替代实现。后续以作者真实探针结果推进；整项验收仍未通过。
