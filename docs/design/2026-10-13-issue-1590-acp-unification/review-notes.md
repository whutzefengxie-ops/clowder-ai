---
feature_ids: [F143, F161]
topics: [acp, review, capability-parity]
doc_kind: review
created: 2026-10-13
---

# 独立内容复核与修订

复核者：独立子代理 `/root/acp_plan_review`；作者为 `/root`。同模型独立上下文复核，属于方案内容检查，不是跨家族正式实现批准，也未运行真实模型或全仓测试。

复核范围：统一目标、AgentService 既有能力、源码/标准判断、验收命令、权限/取消与回滚合同。结论：方向可实施，值得进入双端实现验证；未发现 P1，两项 P2 在方案交付前必须补齐。

| Finding | 独立证据 | 修订落点 |
|---|---|---|
| P2：完整范围遗漏 Claude bg/PTY/API-key/canary | claude-carrier-factory.ts 79–90；ClaudeBgCarrierService.ts 279–286 的 chain-key 与轮换 UUID | README 范围、capability-matrix 独立成员行、architecture 桥策略、contracts §9、implementation W0/W6、V24 |
| P2：北向声明与 continuity barrier 不够可执行 | types.ts 811–831；invoke-capacity-snapshot.ts 390–406；route-serial.ts 的 injectsL0Natively 消费 | C27、contracts §9 的声明表与 verdict→drain→settle→prompt 顺序、V24 反例、W0/W6 |

作者处理：两项均接受并补齐；未缩减统一范围。原复核者定向回读后确认 carrier 范围 P2 关闭，并指出 barrier 参数还需精确：settle 接收 `{ evidence, compactions }`，epoch 更新属于 settle 内的既有 owner。已按实际类型更正 §9，不在 settle 前另造 epoch 更新路径；最终定向回执另记下方。

最终定向回执：两项 P2 均关闭，未发现新的实质问题；确认 bg/PTY/API-key/canary 范围与 V24、北向声明和 settle barrier 已补齐。此回执仅确认方案内容修订完成，不代表实现、能力不退化或生产迁移验收。

作者增量检查：8 份 Markdown 的 13 个相对链接、27 个 capability ID、24 个 case ID 与交叉引用、8 个现有 API 测试路径通过；诊断脚本 `node --check` 与 `git diff --check` 通过。所有本次文件均低于 200 行。

复核已核定的事实：固定 Claude bridge systemPrompt/preempt steering、Codex public steering 无 caller target/turn receipt、官方 ACP _meta/扩展方法与可选 elicitation/compaction 均与正文相符。权限拒绝、取消静止、回滚与现有测试入口未见实质错误。

完整实现、真实能力保持、部署/默认迁移审批和 Feature close 均尚未发生，不能由本内容复核代替。
