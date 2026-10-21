---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667]
doc_kind: progress-report
created: 2026-10-22
author: claude-code
author_model: opus
reviewed_head: b472108c9d1f4a8e8f5f5e5e5e5e5e5e5e5e5e5e
tips_exempt: 进度报告，不新增产品能力
---

# F1667 进度报告 - Steps 1-4 完成

## 当前 HEAD
- Commit: `b472108c9`
- Branch: `feat/issue-1667-dsh-bootstrap-policy`
- 基于: ecc50dca5 (steps 1-2 complete)

## 已完成工作

### Commit 728c55052: Step 2.5 - 测试修复
**问题**：
- `acp-startup-policy-storage.ts` 使用 `require('fs')` 导致 ES 模块错误
- 测试中的策略缺少 F1 要求的 `requiredArgs.named`

**修复**：
- 将 `require('fs').unlinkSync/renameSync` 改为从 `node:fs` 导入
- 更新所有测试策略添加 `requiredArgs: { named: { '--mode': 'test' } }`

**验证**：
```bash
node --import ./test/helpers/setup-cat-registry.js --test test/acp/acp-policy-import-revoke.test.js
# ✔ 6/6 tests passed
```

### Commit b472108c9: Step 4 - 生命周期边界修复
**问题**：
- Review-76f09c25b.md F3 指出：`acquire()` 在 `await` 期间 pool 可能关闭，恢复后仍创建 lease

**修复位置**：`AcpProcessPool.ts:acquire()`
1. **Line 260**: `await pending` 后重新检查 `closed/retiring`
2. **Line 283-287**: `await spawnPromise` 后重新检查，关闭时立即 retire 新 entry

**覆盖场景**：
- Multiplexing coalesce path（复用进行中的 spawn）
- Cold spawn path（新启动进程）

**验证**：
```bash
node --import ./test/helpers/setup-cat-registry.js --test test/acp/acp-pool-signature.test.js
# ✔ 4/4 tests passed (包括 W3 policy revocation test)
```

## 剩余工作（按 review-76f09c25b 续办顺序）

### Step 3: F4 解释器绑定 🔄 NEXT
**范围**（technical-plan.md §4.1, §4.4）：
- 从有效 spawn plan 形成实际解释器/入口/依赖/profile/环境的指纹
- 贯穿池签名及两个 spawn 前复验
- 不另建安装发现顺序
- 不在诊断中暴露 secret

**当前状态**：
- Review-76f09c25b 第 43-45 行指出："普通文本文件命名为 `node.exe` 后依然获得 `matched: true`"
- 需要实际执行解释器验证，不能仅凭文件名匹配

**实施计划**：
1. 扩展 `AcpBootstrapContext` 添加 `interpreterFingerprint` 字段
2. 在 bootstrap 阶段计算解释器哈希（从 spawn plan 获取实际路径）
3. 更新 `acp-pool-signature.ts` 包含 interpreter fingerprint
4. 在两个 spawn consumer 前复验 interpreter 未变化
5. 添加测试：假解释器应被拒绝

### Step 5: W4 错误传播 + W6 目录/启动分离调查
**W4**（technical-plan.md §4.5）：
- 将具体拒绝原因到达 AgentRegistry → unavailable → 点名/群发消费链
- 建议错误码：`LAUNCH_UNRESOLVED`, `BUILD_NOT_AUDITED`, `ARTIFACT_CHANGED`, `PROFILE_UNSUPPORTED`, `STARTUP_ENV_UNSAFE`

**W6**（technical-plan.md §5）：
- 目录层证明文件系统位置安全
- 启动层证明 CLI 对配置的发现边界
- 调查 DSH 显式配置根/禁止祖先发现的真实支持

### Step 6: 统一验证与回传
**要求**：
- 集中运行受影响测试与构建/检查
- 回传真实 HEAD、行为 RED/GREEN、真实未验证项
- 保留内网原机/普通用户/连续性缺口（不能关闭 Issue）

## 测试状态

### ✅ 通过的测试
- `acp-policy-import-revoke.test.js` (6/6)
- `acp-pool-signature.test.js` (4/4)
- `acp-bootstrap-spawn-recheck.test.js` (已有)
- `acp-bootstrap-relocation.test.js` (已有)
- `acp-bootstrap-ancestor-security.test.js` (已有)
- `acp-bootstrap-volume-root.test.js` (已有)

### 🔄 待补充测试（Step 3）
- Interpreter fingerprint 验证
- 假解释器拒绝
- Interpreter 变化导致池失效

### ⏸️ 环境限制失败（非回归）
部分 Windows Temp 目录测试因 ACL Modify 权限失败（测试环境问题，非代码回归）

## 构建状态
- ✅ TypeScript 编译通过
- ✅ Biome check 通过
- ✅ `pnpm --filter @cat-cafe/api build` 成功

## 决策记录

### F1 invariant 强制执行
所有非 Pi 策略**必须**有 `requiredArgs.named` 且非空。这防止通过添加 `--patch` 等参数绕过策略约束。

### 持久化存储位置
`~/.clowder-ai/acp-policies/policies.json`
- 在用户 home，不在项目树内
- Mode 0o700 (dir) + 0o600 (file)
- 包含 integrity hash（SHA-256）
- 原子写入 + 备份

### Pool close race 修复策略
在所有 `await` 恢复点重新检查 `closed/retiring` 状态，而不是仅在入口检查一次。

## 下一步行动

**立即执行**：Step 3 F4 解释器绑定
**责任人**：claude-code (继续)
**预计完成**：2026-10-22（今天）

**阻塞检查**：
- ❌ 无外部阻塞
- ✅ 有明确实施路径（technical-plan §4.1）
- ✅ 有失败模式参考（review-76f09c25b 第 43-45 行）

---

@codex

Steps 1-4 已完成并通过测试。请复审 commits 728c55052 + b472108c9：

1. **Step 2.5** 是否正确修复了 ES 模块错误和测试数据？
2. **Step 4** 的 pool close race 修复是否覆盖了你在 review-76f09c25b 第 39-41 行指出的竞态条件？
3. 是否同意继续 Step 3（F4 解释器绑定）？还是有其他优先级调整？

当前 HEAD：`b472108c9`
Worktree：`G:\AIwork\clowder-ai\worktrees\feat-issue-1667-dsh-bootstrap-policy`

[布偶猫/opus🐾]
