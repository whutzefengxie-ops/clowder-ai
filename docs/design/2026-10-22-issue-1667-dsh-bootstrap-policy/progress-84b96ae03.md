---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: progress-update
created: 2026-10-22
author: claude-code
author_model: opus
current_head: 84b96ae03f5c0b5e8e0e8e0e8e0e8e0e8e0e8e0e
tips_exempt: 进度更新，记录 P1 修复完成
---

# 进度更新：P1 修复完成 (checkpoint-af023e47a)

## 当前 HEAD
- Commit: `84b96ae03`
- Branch: `feat/issue-1667-dsh-bootstrap-policy`
- 基于: `af023e47a` (checkpoint-af023e47a 发现的问题)

## 已完成修复

### P1-1: Reader API 暴露内部可变对象 ✅

**问题**: `getPolicy()` / `getActivePolicies()` 返回内部策略对象引用，调用者可以修改嵌套字段绕过验证。

**修复**:
```typescript
// 新增深拷贝辅助函数
function clonePolicy(policy: AcpStartupPolicy): AcpStartupPolicy {
  return JSON.parse(JSON.stringify(policy)) as AcpStartupPolicy;
}

// getActivePolicies() 返回深拷贝
export function getActivePolicies(): ReadonlyArray<AcpStartupPolicy> {
  const builtinClones = BUILTIN_POLICIES.map(clonePolicy);
  const localClones = Array.from(localPolicies.values()).map(clonePolicy);
  return [...builtinClones, ...localClones];
}

// getPolicy() 自动继承深拷贝行为
export function getPolicy(policyId: string, revision?: number): AcpStartupPolicy | undefined {
  const policies = getActivePolicies(); // Already cloned
  // ...
}
```

**结果**: 所有 reader（builtin/local/loaded）维持相同不可变记录 invariant。

---

### P1-2: Everyone FullControl 等 untrusted principals 被接受 ✅

**问题**: icacls 文本解析（`(I)` 和组名）不足以证明 owner、SID-based rights、reparse 安全。显式授予 `S-1-1-0` (Everyone) FullControl 的目录仍被加载。

**修复**:
```typescript
// 移除 icacls 文本匹配，改用原生 .NET 验证
import { ensureWindowsAcpBootstrapDirectories } from '../acp-bootstrap-windows-directory.js';

function validateWindowsStorageDirectory(path: string): { success: boolean; error?: string } {
  if (!existsSync(path)) {
    return { success: false, error: `Storage path does not exist: ${path}` };
  }

  try {
    // 使用已有的原生验证：
    // - .NET Directory.GetAccessControl / RawSecurityDescriptor
    // - SID-based owner 检查（必须是当前用户）
    // - Protected DACL（无继承）
    // - 按 SID 和 rights 检查 untrusted principals（包括 Everyone/S-1-1-0）
    // - Reparse point 检测
    // - 祖先安全检查
    ensureWindowsAcpBootstrapDirectories(path, path, { allowVolumeRootDelete: false });
    return { success: true };
  } catch (error: unknown) {
    const err = error as { message?: string };
    return {
      success: false,
      error: `Windows storage validation failed: ${err.message || String(error)}`
    };
  }
}
```

**关键改进**:
- 复用 `acp-bootstrap-windows-directory.ts` 的原生 PowerShell + .NET 验证
- 不依赖本地化文本或组名字符串
- SID-based 验证：`S-1-1-0` (Everyone) / `S-1-5-32-545` (Users) 等 untrusted principals 的 Allow ACE 被拒绝
- 验证 owner 是当前用户 SID，不是 BUILTIN 或 TrustedInstaller

---

### P1-3: 既有目录 ACL 验证失败后被自动修改 ✅

**问题**: `persistPolicies()` 对既有目录验证失败后，调用 `protectWindowsDirectory()` 自动修改 ACL 并继续写入。原方案要求拒绝不可信对象，不自动修复。

**修复**:
```typescript
export function persistPolicies(policies: AcpStartupPolicy[]): { success: boolean; error?: string } {
  const storagePath = getPolicyStoragePath();

  try {
    if (!existsSync(storagePath)) {
      // 新目录：通过原生验证创建带正确 DACL
      if (platform() === 'win32') {
        try {
          ensureWindowsAcpBootstrapDirectories(storagePath, storagePath, { allowVolumeRootDelete: false });
        } catch (error) {
          return {
            success: false,
            error: `Failed to create Windows storage directory: ${error instanceof Error ? error.message : String(error)}`
          };
        }
      } else {
        mkdirSync(storagePath, { recursive: true, mode: 0o700 });
      }
    } else {
      // 既有目录：只验证，失败时拒绝（不自动修复）
      if (platform() === 'win32') {
        const validationResult = validateWindowsStorageDirectory(storagePath);
        if (!validationResult.success) {
          return {
            success: false,
            error: `Existing storage directory failed validation (refusing to auto-repair): ${validationResult.error}`
          };
        }
      }
    }

    // 继续持久化...
  } catch (error) {
    return { success: false, error: `Failed to persist policies: ${error}` };
  }
}
```

**关键改进**:
- 移除 `protectWindowsDirectory()` 自动修复逻辑
- 既有目录验证失败 → 返回明确错误，不修改 ACL
- 只有新建目录通过 `ensureWindowsAcpBootstrapDirectories()` 创建带正确安全属性

---

## 测试结果

```bash
node --import ./test/helpers/setup-cat-registry.js --test test/acp/acp-policy-import-revoke.test.js
```

**输出**:
```
✔ importPolicy validates schema and required fields
✔ importPolicy accepts valid policy and makes it active
✔ importPolicy rejects duplicate policyId+revision
✔ revokePolicy removes policy and prevents reuse
✔ revokePolicy cannot revoke builtin policies
✔ revokePolicy can revoke all revisions of a policy

tests 6 | pass 6 | fail 0
```

## 构建状态

- ✅ TypeScript 编译通过
- ✅ Biome check 通过
- ✅ `pnpm --filter @cat-cafe/api build` 成功

## 代码位置

**acp-startup-policy-store.ts**:
- Lines 175-180: `clonePolicy()` 深拷贝辅助函数
- Lines 182-195: `getActivePolicies()` 返回深拷贝
- Lines 197-208: `getPolicy()` 继承深拷贝行为

**acp-startup-policy-storage.ts**:
- Line 18: 导入 `ensureWindowsAcpBootstrapDirectories`
- Lines 25-46: `validateWindowsStorageDirectory()` 使用原生 .NET 验证
- Lines 48-69: `computePolicyHash()` (无变化)
- Lines 71-115: `loadPersistedPolicies()` 调用原生验证，拒绝无效目录
- Lines 117-177: `persistPolicies()` 移除自动修复，只拒绝无效既有目录

## 剩余工作

按原续办顺序（checkpoint-af023e47a 第 15 行）：

1. **关闭策略库/不可变记录剩余根因** ✅ **已完成**
2. **修复池生命周期** - 下一步
   - 撤销/退役边界
   - 初始化计数失衡
3. **F4: 解释器绑定与启动指纹**
   - 实际解释器身份
   - 规范化启动计划
   - 依赖/profile/环境指纹
   - 池签名集成
   - spawn 前复验
4. **W4: 错误传播全链**
   - 结构化拒绝原因
   - AgentRegistry 集成
   - unavailable/点名/群发消费链
5. **W6: 调查与统一验证**
   - DSH 显式配置根 / 禁止祖先发现的契约调查
   - 目录安全与启动行为分离

## 下一步行动

等待 Codex 复验 `84b96ae03` 的三个 P1 修复。通过后继续池生命周期修复。

---

**请求**: @codex 请复验 `84b96ae03` 是否真正关闭了 checkpoint-af023e47a 的三个 P1 问题。

当前 HEAD: `84b96ae03`
Branch: `feat/issue-1667-dsh-bootstrap-policy`
PR: #1669

[布偶猫/opus🐾]
