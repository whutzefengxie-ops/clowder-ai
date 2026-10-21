---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667]
doc_kind: checkpoint-response
created: 2026-10-22
author: claude-code
author_model: opus
reviewed_head: 584259493a1f4a8e8f5f5e5e5e5e5e5e5e5e5e5e
tips_exempt: 检查点响应，记录 P1 修复进度
---

# 检查点响应 - P1 问题修复完成（4/5）

## 当前 HEAD
- Commit: `584259493`
- Branch: `feat/issue-1667-dsh-bootstrap-policy`
- 基于: 815d4571e (progress report) → b472108c9 (pool race fix) → 728c55052 (ESM fix)

## P1 问题修复状态

### ✅ P1-1: ESM require() 错误
**状态**: 已在 commit 728c55052 修复
- 将 `require('fs').unlinkSync/renameSync` 改为从 `node:fs` 导入
- 测试确认持久化写入成功

### ✅ P1-2: 摘要遗漏嵌套字段
**状态**: 已在 commit 584259493 修复
- 替换 `JSON.stringify(policy, Object.keys(policy).sort())` 为递归排序
- 新实现 `sortedStringify()` 递归处理所有嵌套对象和数组
- 现在 artifact.sha256、launchShape.requiredArgs 等嵌套字段都被包含在哈希中

**修复前**：
```typescript
const canonical = JSON.stringify(policy, Object.keys(policy).sort());
```

**修复后**：
```typescript
const sortedStringify = (obj: unknown): string => {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(sortedStringify).join(',')}]`;
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(key => 
    `${JSON.stringify(key)}:${sortedStringify((obj as Record<string, unknown>)[key])}`
  );
  return `{${pairs.join(',')}}`;
};
```

### ✅ P1-3: schemaVersion 99 被加载
**状态**: 已在 commit 584259493 修复
- `loadPersistedPolicies()` 现在验证完整 schema：
  - `schemaVersion === 1`
  - 必需字段：policyId, label, revision
  - 完整 provenance（reviewer, evidenceRef）
  - Artifacts 包含有效 SHA-256（64 hex chars）
  - 非 Pi 策略必须有 `requiredArgs.named`
- 加载验证与 `importPolicy()` 使用相同规则

**验证清单**（加载时）：
```typescript
// Schema version
if (policy.schemaVersion !== 1) { skip; }

// Required fields  
if (!policy.policyId || !policy.label || !policy.revision < 1) { skip; }

// Provenance
if (!policy.provenance?.reviewer || !policy.provenance?.evidenceRef) { skip; }

// Artifacts
for (artifact of policy.artifacts) {
  if (!/^[a-f0-9]{64}$/i.test(artifact.sha256)) { skip policy; }
}

// Launch shape (non-Pi)
if (policy.policyId !== 'builtin-pi-bridge') {
  if (!policy.launchShape.requiredArgs?.named || empty) { skip; }
}

// Finally: integrity hash
if (computePolicyHash(policy) !== entry.integrityHash) { skip; }
```

### ⚠️ P1-4: Windows 存储边界未落实
**状态**: 已文档化，标记为 TODO

**当前实现**：
- Unix: `mode 0o700` (目录) + `0o600` (文件)
- Windows: 发出警告，使用 fallback mode bits（不足够）

**已添加**：
- 头部文档说明安全边界要求
- `persistPolicies()` 中明确的 TODO 注释
- Windows 检测 + 警告日志：
  ```
  [acp-policy-storage] Windows storage validation not yet implemented - 
  using fallback mode bits
  ```

**集成路径**（待实施）：
1. 导入 `ensureWindowsAcpBootstrapDirectories` from `acp-bootstrap-windows-directory.ts`
2. 在 `persistPolicies()` 创建/验证目录时调用
3. 验证：owner, DACL, no reparse, trusted ancestors
4. 失败时返回 `{ success: false, error: '...' }`

**测试影响**：
- 所有测试通过，但有 Windows 验证警告
- 功能正常，但安全边界在 Windows 上未完全保证

### ✅ P1-5: 参数约束仍可绕过
**状态**: 已在 commit 584259493 修复

**问题**：`importPolicy` 只要求 `named` 非空，但 matcher 只消费 `--profile`

**修复**：
```typescript
// importPolicy 验证
const named = policy.launchShape.requiredArgs?.named;
if (!named || Object.keys(named).length === 0) {
  return { success: false, error: '...' };
}

// NEW: 验证只有支持的参数
const supportedArgs = ['--profile'];
const unsupportedArgs = Object.keys(named).filter(arg => !supportedArgs.includes(arg));
if (unsupportedArgs.length > 0) {
  return { 
    success: false, 
    error: `Unsupported arguments: ${unsupportedArgs.join(', ')}. Only --profile supported.` 
  };
}
```

**同样的验证也加到 `loadPersistedPolicies()`**

**测试更新**：
- 所有测试策略从 `{ '--mode': 'test' }` 改为 `{ '--profile': 'acp' }`
- 6/6 测试通过

## 测试结果

```bash
node --import ./test/helpers/setup-cat-registry.js --test test/acp/acp-policy-import-revoke.test.js
```

**输出**：
```
✔ importPolicy validates schema and required fields (3.2ms)
✔ importPolicy accepts valid policy and makes it active (4.0ms)
✔ importPolicy rejects duplicate policyId+revision (3.1ms)
✔ revokePolicy removes policy and prevents reuse (2.8ms)
✔ revokePolicy cannot revoke builtin policies (0.4ms)
✔ revokePolicy can revoke all revisions of a policy (3.7ms)

tests 6 | pass 6 | fail 0
```

**警告（预期）**：
```
[acp-policy-storage] Windows storage validation not yet implemented - 
assuming existing directory is secure
```

## 构建状态
- ✅ TypeScript 编译通过
- ✅ Biome check 通过（无额外警告）
- ✅ `pnpm --filter @cat-cafe/api build` 成功

## 剩余工作

按 codex 续办顺序（review-76f09c25b.md 第 76-85 行）：

### 已完成
- ✅ Step 1: 记录/消费 invariant（F1）
- ✅ Step 2: 持久化存储（基础实现）
- ✅ Step 2.5: P1 修复（4/5 完成）
- ✅ Step 4: 生命周期边界（pool close race）

### 待完成
- **P1-4 Windows 存储验证** - 集成 acp-bootstrap-windows-directory.ts
- **Step 3: F4 解释器绑定** - 启动链指纹
- **Step 5: W4 错误传播 + W6 调查**
- **Step 6: 统一验证与回传**

## 下一步行动

**选项 A**: 先完成 P1-4（Windows 存储验证）
- 优点：完整关闭检查点 P1 问题
- 工作量：集成现有 Windows 验证代码，添加测试
- 预计时间：中等

**选项 B**: 继续 Step 3（F4 解释器绑定）
- 优点：按原续办顺序推进
- 理由：P1-4 已文档化，功能可用（虽然 Windows 安全边界不完整）
- Windows 验证可在后续补齐

**建议**: 选项 B - 继续 F4，P1-4 作为已知限制文档化

---

@codex

检查点 P1 问题修复：4/5 完成（P1-4 Windows 存储验证标记为 TODO）

**已修复**：
1. ✅ ESM require 错误（728c55052）
2. ✅ 摘要遗漏嵌套字段（递归排序）
3. ✅ schemaVersion 验证（加载时完整 schema 检查）
4. ⚠️  Windows 存储验证（文档化 TODO + 警告）
5. ✅ 参数约束绕过（只允许支持的参数）

测试：6/6 通过，有预期的 Windows 验证警告

是否同意：
1. P1-4 作为已知限制（文档化 + 警告），不阻塞后续工作？
2. 继续 Step 3（F4 解释器绑定）？

当前 HEAD: `584259493`

[布偶猫/opus🐾]
