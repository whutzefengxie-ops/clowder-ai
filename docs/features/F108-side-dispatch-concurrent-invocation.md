---
feature_ids: [F108]
related_features: [F086, F039, F048, F052]
topics: [runtime, invocation, concurrency, orchestration]
doc_kind: spec
created: 2026-03-12
---

# F108: Side-Dispatch — 同一 Thread 多猫并发执行

> **Status**: spec | **Owner**: TBD | **Priority**: P1

## Why

team lead作为 CVO，需要在**任何时刻**向**任何猫**派活，且**不打断**正在工作的猫。

当前架构的限制：InvocationTracker 对每个 thread 持有单一执行锁——当Ragdoll在 thread 里修 bug 时，team lead无法同时派Maine Coon在同一 thread 里做架构反思。只能开新 thread（信息孤岛）或等当前猫完成（阻塞 CVO）。

team experience（2026-03-12）：

> "赶紧开 worktree 修了他 记住只有Ragdoll去修这个问题！@opus"
> "@gpt52 你Maine Coon反思你为什么给Ragdoll过了？你回答我这个不要碰代码"

> "这样的情况我会需要一直和不同的你们交流 甚至我可能就是给Maine Coon一直发悄悄话避免影响你的修复。我会想要 1. 让你修复问题 2. 并发让Maine Coon反思为什么他做的不好 然后如何从架构上改进"

**核心诉求**：同一 feat、同一 thread，team lead并发派不同的猫干相关但不同的事——一边修 bug 一边反思，互不干扰，结果都在同一 thread 可见。

## What

### Phase A: 运行时并发基座

**核心改动**：InvocationTracker 从 per-thread 单锁改为 per-thread-per-cat 多槽。

1. **Invocation 多槽模型**：一个 thread 可以有多个并发 invocation，按 `catId` 隔离
2. **Side-Dispatch 路由**：当 thread 已有活跃 invocation 时，新消息根据 `targetCat` 路由到旁路执行，不 abort 主执行流
3. **消息可见性**：旁路执行的消息在同一 thread 可见（所有参与者看到完整对话）
4. **安全约束**：
   - 同一 catId 在同一 thread 不能有多个并发 invocation（保留原有单锁语义，只是粒度从 thread 细化到 thread+cat）
   - 文件锁/worktree 冲突检测（两只猫不能同时改同一个文件）

### Phase B: Steer 集成 + UX

1. **Steer 旁路派遣**：UI 上「悄悄话」模式或指定猫模式，不中断主执行流
2. **Whisper Mode**：team lead给特定猫发消息，其他猫看不到（类似当前 steer，但不 abort 其他猫）
3. **Thread 执行状态面板**：显示当前 thread 有哪些猫在活跃执行

## Acceptance Criteria

### Phase A（运行时并发基座）
- [ ] AC-A1: 同一 thread 中，两只不同的猫可以有并发 invocation，互不 abort
- [ ] AC-A2: 旁路 invocation 的消息在 thread 中对所有参与者可见
- [ ] AC-A3: 同一 catId 在同一 thread 仍保持单锁语义（不能自己和自己并发）
- [ ] AC-A4: InvocationRecord 存储结构支持 per-thread 多条并发记录
- [ ] AC-A5: 现有 multi_mention 等编排工具继续正常工作（向后兼容）

### Phase B（Steer 集成 + UX）
- [ ] AC-B1: team lead可以在 UI 上选择目标猫发送消息，不中断其他猫的执行
- [ ] AC-B2: Thread 状态面板显示当前活跃执行的猫和状态
- [ ] AC-B3: Whisper Mode — 发给特定猫的消息不影响其他猫的执行流

## Dependencies

- **Evolved from**: F086（多猫并行编排——F086 解决了猫发起的并行，F108 解决team lead发起的并行）
- **Related**: F039（消息排队——需要适配多槽模型）
- **Related**: F048（Restart Recovery——InvocationRecord 结构变更需要迁移）
- **Related**: F052（跨线程身份隔离——同 thread 多 cat 的身份隔离复用）

## Risk

| 风险 | 缓解 |
|------|------|
| InvocationTracker 改动影响所有消息处理链路 | Phase A 仅改锁粒度，不改接口；充分的集成测试 |
| 两只猫并发改同一个文件造成冲突 | worktree 隔离 + 文件锁检测（Phase A 约束 4） |
| 消息顺序混乱（两只猫交叉回复） | 消息带 invocationId 标记，前端按 cat 分组或按时间排列 |
| 向后兼容——现有 multi_mention / steer 行为变化 | Phase A AC-A5 强制向后兼容测试 |

## Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 锁粒度从 per-thread 改为 per-thread-per-cat（不是完全无锁） | 保留同一猫的串行语义，避免自己和自己竞争 | 2026-03-12 |

## Review Gate

- Phase A: 跨家族 review（架构级改动），Maine Coon review 运行时安全性

## 需求点 Checklist

| ID | 需求点（team experience/转述） | AC 编号 | 验证方式 | 状态 |
|----|---------------------------|---------|----------|------|
| R1 | "让你修复问题，并发让Maine Coon反思" — 同一 thread 同时派两只猫干不同的事 | AC-A1 | integration test: 两猫并发 invocation 互不 abort | [ ] |
| R2 | "给Maine Coon一直发悄悄话避免影响你的修复" — 旁路消息不中断主执行 | AC-A2, AC-B1 | test: 主执行猫不被 abort | [ ] |
| R3 | 相关但不同的任务在同一 feat/thread 里，结果都可见 | AC-A2 | test: 旁路消息在 thread 中可见 | [ ] |
| R4 | 涉及 A2A 并发调整，安全性需要强评估 | AC-A5 | 向后兼容测试 + Maine Coon安全 review | [ ] |

### 覆盖检查
- [x] 每个需求点都能映射到至少一个 AC
- [x] 每个 AC 都有验证方式
- [ ] 前端需求已准备需求→证据映射表（Phase B 适用）

## team lead用例示例

```
场景：Ragdoll修 bug 中，team lead同时想让Maine Coon反思架构

当前（F108 之前）：
  team lead → @opus 修这个 bug
  team lead → @gpt52 你反思一下为什么过了
  ❌ @gpt52 的消息 abort 了 @opus 正在进行的修复
  ❌ 或者team lead被迫开新 thread，结果分散在两个地方

期望（F108 之后）：
  team lead → @opus 修这个 bug       → Ragdoll在主执行流修 bug
  team lead → @gpt52 你反思一下       → Maine Coon在旁路执行流反思（不打断Ragdoll）
  ✅ 两只猫并发执行，消息都在同一 thread
  ✅ team lead可以随时和任一只猫交流
```
