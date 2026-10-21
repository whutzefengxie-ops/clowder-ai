---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667]
doc_kind: progress-update
created: 2026-10-22
author: claude-code
author_model: opus
reviewed_head: ca0fcc479c8c2f9db4a8b9530dcfdfe5762a3f0a
tips_exempt: 进度更新，记录已修复的 P1 问题
---

# 进度更新 - P1 修复（2/3 完成）

## 当前 HEAD
- Commit: `ca0fcc479`
- Branch: `feat/issue-1667-dsh-bootstrap-policy`
- 基于: c2c069819 (checkpoint)

## 已修复的 P1 问题

### ✅ P1-1: Profile 值验证
**问题**：空 `--profile` 值或非 'acp' 值绕过检查

**修复**（commit ca0fcc479）：
```typescript
// importPolicy 验证
if (named['--profile'] !== 'acp') {
  return {
    success: false,
    error: `Invalid --profile value: "${named['--profile']}". Only "acp" is supported.`
  };
}

// loadPersistedPolicies 同样验证
if (named['--profile'] !== 'acp') {
  console.warn(`[acp-policy-storage] Invalid --profile value: "${named['--profile']}", skipping`);
  continue;
}
```

**覆盖场景**：
- 空字符串 `''` → 拒绝
- 其他 profile `'unreviewed'` → 拒绝
- 只有 `'acp'` → 接受

### ✅ P1-2: 持久化失败返回成功
**问题**：写盘失败后 `importPolicy()` 仍返回 `success: true`，策略在内存激活但磁盘不存在

**修复**（commit ca0fcc479）：
```typescript
// syncToStorage 现在返回结果
function syncToStorage(): { success: boolean; error?: string } {
  try {
    const result = persistPolicies(policies);
    if (!result.success) {
      console.error('[acp-policy-store] Failed to persist policies:', result.error);
      return result;
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: `Failed to sync policies: ${error}` };
  }
}

// importPolicy 事务性回滚
localPolicies.set(key, policy);
const persistResult = syncToStorage();
if (!persistResult.success) {
  localPolicies.delete(key); // 回滚内存变更
  return { success: false, error: `Failed to persist policy: ${persistResult.error}` };
}

// revokePolicy 报告持久化失败
const persistResult = syncToStorage();
if (!persistResult.success) {
  console.error(`[acp-policy-store] Revoked ${policyId} in memory but failed to persist`);
  return { success: false, error: `Revocation completed in memory but failed to persist` };
}
```

**事务语义**：
- Import: 内存 + 磁盘必须都成功，任一失败则回滚
- Revoke: 内存已删除但磁盘失败时明确报错

### ⚠️ P1-3: Windows 存储边界
**状态**：占位符实现

**当前实现**：
```typescript
function validateWindowsStorageDirectory(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`Storage path does not exist: ${path}`);
  }
  
  // TODO: Full Windows native validation with PowerShell
  // - Owner verification (current user only)
  // - Protected DACL (inheritance disabled)
  // - No reparse point
  // - Trusted ancestor path
  console.warn('[acp-policy-storage] Windows native validation not fully implemented');
}
```

**已集成但未完整实现**：
- ✅ 在 `persistPolicies()` 创建/验证目录时调用
- ✅ 在 `loadPersistedPolicies()` 加载前调用
- ✅ Windows 平台检测 `if (platform() === 'win32')`
- ❌ PowerShell 脚本集成待完成
- ❌ Owner/DACL/reparse 实际检查待完成

**TODO 路径**：
1. 使用 PowerShell 脚本检查 owner (WindowsIdentity::GetCurrent().User)
2. 检查 DACL protected (inheritance disabled)
3. 检查不是 reparse point
4. 检查祖先路径不可替换
5. 失败时拒绝加载/持久化

## 测试结果

```bash
node --import ./test/helpers/setup-cat-registry.js --test test/acp/acp-policy-import-revoke.test.js
```

**输出**：
```
✔ importPolicy validates schema and required fields
✔ importPolicy accepts valid policy and makes it active
✔ importPolicy rejects duplicate policyId+revision
✔ revokePolicy removes policy and prevents reuse
✔ revokePolicy cannot revoke builtin policies
✔ revokePolicy can revoke all revisions of a policy

tests 6 | pass 6 | fail 0
```

## 剩余工作

### 来自 checkpoint-c2c069819
1. **P1-3**: 完成 Windows 存储验证（PowerShell 集成）
2. **Pool 生命周期**（checkpoint-815d4571e）：
   - 策略读取期间退役仍发热租约
   - 初始化期间撤销仍发新租约
   - `liveProcessCount=-1` 计数失衡

### 来自原计划
3. **Step 3 (F4)**: 解释器绑定与指纹
4. **Step 5 (W4)**: 错误传播全链
5. **Step 6**: W6 调查 + 统一验证

## 下一步行动

**选项 A**: 先完成 P1-3（Windows 验证）
- 工作量：中等（PowerShell 脚本 + 错误处理）
- 优先级：codex 明确要求必须完成

**选项 B**: 修复池生命周期问题
- 工作量：中等（3 个 await 点重新检查状态）
- 影响：运行时安全

**选项 C**: 继续 F4/W4/W6
- 按原续办顺序推进

**建议**: 选项 A（Windows 验证）→ 选项 B（池生命周期）→ 选项 C（F4/W4/W6）

## 构建状态
- ✅ TypeScript 编译通过
- ✅ Biome check 通过
- ✅ `pnpm --filter @cat-cafe/api build` 成功

---

当前 HEAD: `ca0fcc479`
上游 checkpoint: checkpoint-c2c069819.md

[布偶猫/opus🐾]
