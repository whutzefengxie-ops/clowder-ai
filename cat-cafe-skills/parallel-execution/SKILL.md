---
name: parallel-execution
description: >
  多个独立任务的并行分发、子代理驱动、计划执行。
  Use when: 有 2+ 个互不依赖的任务、需要子代理并行工作。
  Not for: 单一任务、有依赖链的任务（顺序执行即可）。
  Output: 并行任务完成 + 集成验证。
triggers:
  - "多个独立任务"
  - "并行"
  - "parallel"
  - "subagent"
merges: dispatching-parallel-agents + subagent-driven-development + executing-plans
---

# Parallel Execution

三种模式合一：独立任务并行派发、顺序+review、批次计划执行。

## 选哪个模式？

```
独立任务（无共享状态）？
  → 可以同时跑且互不干扰？ → (A) 并行派发
  → 需要 review checkpoint？ → (B) Subagent 驱动
有书面计划要执行？ → (C) 计划批次执行
```

## (A) 并行派发 — Parallel Dispatch

适用：3+ 个独立问题域（不同测试文件、不同子系统、不同 bug）

**四步走：**
1. **识别独立域** — 按"修 A 不影响 B"来分组
2. **写聚焦 prompt**（见下方模板）
3. **同时派发** — 每个 Task() 独立跑
4. **整合结果** — 检查冲突 → 跑全量测试

**Agent Prompt 结构：**
```
[上下文] 哪个文件/子系统，具体出错信息
[任务]   修复这 N 个失败用例
[约束]   不改其他模块；不要只加 timeout
[输出]   返回：根因 + 你改了什么
```

**禁止：**
- 太宽泛："修所有测试" → 改成具体文件名
- 无上下文：把错误信息粘进去
- 无约束：Agent 可能重构整个模块

**Subagent 不需要指定 model**（继承主猫即可）。

## (B) Subagent 驱动 — Sequential with Review

适用：有实现计划、任务基本独立、需要在本 session 执行

**流程（每个任务）：**
```
派发 implementer subagent
  → 如果他问问题：先答再让他继续
  → 实现 + 测试 + self-review + commit
派发 spec reviewer（检查 spec 对齐）
  → 不通过 → implementer 修 → 重新 review
  → 通过 ↓
派发 code quality reviewer（检查代码质量）
  → 不通过 → implementer 修 → 重新 review
  → 通过 → TodoWrite 标完成
```

所有任务跑完 → 派发 final reviewer → `quality-gate`

**铁律：**
- spec compliance 先通过，再做 code quality review（顺序不能反）
- reviewer 发现问题 = implementer 修 = 重新 review（不能跳过 re-review）
- 不能并行跑多个 implementer（会有文件冲突）

## (C) 计划批次执行 — Plan Batch Execution

适用：有书面计划文件，需要在独立 session 执行

**五步：**
1. 读计划文件，批判性审阅（有疑问先问）
2. 建 TodoWrite，默认每批 3 个任务
3. 执行一批：mark in_progress → 按步骤执行 → 验证 → mark completed
4. 汇报："已完成 [X]，输出如下，等待反馈"
5. 全部完成后 → `quality-gate`

**遇到阻塞立即停**，不要猜测继续。

## 整合阶段（A/B/C 通用）

返回结果后必须：
1. 逐条读 summary，理解改了什么
2. 检查是否有同文件冲突
3. 跑全量测试套件
4. 抽检（Agent 可能犯系统性错误）

## Next Step

→ `quality-gate`（所有路径收敛）
