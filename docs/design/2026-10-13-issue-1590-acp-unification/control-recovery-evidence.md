---
feature_ids: [F143, F161]
topics: [acp, control, recovery, evidence]
doc_kind: report
created: 2026-10-14
---

# W4.P：控制回执的恢复与对账

原本的桥内 Map 会在 owner 重启后再次调用 native；五个新反例均先 RED。现在隔离原型在 native 调用前以 operation/binding/session 为键持久认领 intent，写明 caller target、输入 hash 和稳定 native clientUserMessageId；原生接受后先持久写回执，再返回 ACP。相同 operation 的不同 target/content 拒绝，跨 binding 拒绝，缺记录/损坏记录/无法核实结果都不能重新注入。

receipt 查询先复用经校验的持久原生回执；丢 native 回执时，调用实际 CodexAcpClient 的 native thread/read 历史，要求同 native session、原 target turn、唯一 clientId、完整文本输入 hash 全部匹配。只有准确原生证明能收敛为 injected；不存在、读取失败、歧义等保持 outcome_unknown，不能以未查到推断未执行。injected 仍不等于模型已采用或任务完成。

21 项确定性检查包含：可控 A→B fence、冷 owner 去重、并发 claim、丢回执、未知结果不重发、外国 binding、输入修改、持久写失败、空 claim、合法 JSON 缺证明/错误 target/clientID、返回对象污染。独立审查实际复现两个 P2：对账后活 owner 仍保留 rejected Promise，以及坏原生证明被 accepted。分别留存 RED→GREEN，已将确认终态写回缓存、严格校验两种原生证明并隔离返回对象。

真实固定 bridge 2.1.1 / native 0.161.0 在同一个受限只读回合中发送三个不同 operation：

1. host 丢弃一个真实 ACP steer 响应，持久查询恢复原回执。
2. native 真正接受后，测试钩子在桥写回执前抛错；仍存活的 owner 从原生历史对账，重复请求返回确认终态。
3. 同样丢 native 回执，关闭桥进程并创建新的桥/native 连接；session/load 恢复已执行回合，查询精确原生历史后确认，并且重复请求不再次执行 native。

最终约 20.044 秒，三个 native steer 各一次；原 target 原值、三个不同 client ID 与原生历史证明可核。测试钩子是明确的接受后丢回执故障注入，不称为实际网络事故。确认与 raw wire hash 见 [机器证据](evidence/w4-control-recovery.json)。hooks/仓库指令/shell/apps/skills 禁用，只访问合成哨兵；预算为一个模型回合、90 秒 prompt、工具8秒/12次，没有 native USD 硬上限。

早期失败保留：从未执行 prompt 的空 session 没有 rollout，不能跨进程冷恢复（无模型调用）；第二次丢包夹具把查询响应也丢掉，修正夹具后通过。不能把这些运行器失败当作 native fence 失效，也不能删掉失败记录。

持久性证据覆盖桥进程退出/重启。临时文件 fsync 与 rename 没有证明 OS 崩溃或断电目录落盘；生产不得采用该隔离文件 journal 代替现有 durable operation owner。原子 claim 的孤儿不能靠超时偷取，数据损坏会 fail closed。真实测试在回合终态后重连，未验证活动回合在网络断线期间持续存活。

非作者 `/root/acp_plan_review` 复审确认两项 P2 闭环，并核对实际 primary/restored wire 分别3/0次 steer。该回执补齐已明确的丢回执/冷恢复缺口；完整 W4.P/W4 和整体迁移仍保持 held，待全部验收条件确认。Claude 的 W5.P、正式 W3 审批、V24-C 和回滚不由该结果自动放行。
