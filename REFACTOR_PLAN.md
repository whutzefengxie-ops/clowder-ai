# Issue #1666 重构计划

## 当前问题总结（基于 Codex Review）

### P1 级问题
1. **编译错误**: L1479 和 L1535 重复声明 `accountEnv`
2. **普通调用未接入**: L2242-2418 的 invoke/exec/direct 路径使用 `codexEnv`，未经网络派生
3. **Windows 系统代理例外丢失**: 从不传 `systemProxy` 参数，系统例外完全未读取

### P2 级问题
1. **大小写别名未同步**: 只读一个别名，Windows mixed-case 产生冲突键
2. **Host 环境指纹未实现**: 签名只看 overrides，父环境变化不影响签名
3. **集成测试失败**: Windows 路径问题 + 只检查字符串不检查行为
4. **PR 范围不符**: 需要基于正确的 upstream/main

## 重构方案 A（推荐）

### 1. 统一网络环境应用函数

```typescript
private applyCodexNetworkEnvironment(baseEnv: CodexAccountEnvironment | Record<string, string | null>): Record<string, string> {
  // 同步读取 Windows 系统代理（带超时保护）
  const systemProxy = process.platform === 'win32' ? this.readWindowsSystemProxySync() : undefined;
  
  const result = deriveCodexNetworkEnvironmentSync(baseEnv, systemProxy);
  
  // 记录诊断信息
  if (result.diagnostic.unsupportedScenarios.length > 0) {
    log.warn({
      catId: this.catId,
      scenarios: result.diagnostic.unsupportedScenarios,
      source: result.diagnostic.exceptionSource,
    }, 'Codex network environment partial support');
  }
  
  return result.env as Record<string, string>;
}

private readWindowsSystemProxySync(): WindowsSystemProxyConfig | null {
  // 实现同步版本，带超时保护
  // 或使用服务启动时预读取的缓存
}
```

### 2. 应用到所有路径

#### prepareCapabilityLaunch (L1535)
```typescript
const finalizedAccountEnv = withoutSessionScopedHostEnv(
  finalizeCodexAccountEnvironment(descriptor, { ... }),
);
const derivedEnv = this.applyCodexNetworkEnvironment(finalizedAccountEnv);
return { command, args, cwd, env: derivedEnv };
```

#### 普通 invoke (L2242-2309)
```typescript
const finalAccountEnv = native ? { ...codexEnv } : finalizeCodexAccountEnvironment(...);
Object.assign(codexEnv, finalAccountEnv);
// 新增：应用网络环境派生
const derivedEnv = this.applyCodexNetworkEnvironment(codexEnv);
const cliOpts = { ..., env: derivedEnv, ... };
```

#### Direct factory (L2418)
```typescript
const createDirectSession = (sessionOptions) =>
  createDirectAgentCarrierSession(
    { ...sessionOptions, env: this.applyCodexNetworkEnvironment(codexEnv) },
    { ... }
  );
```

#### Host pool (CodexUnixWebSocketSession.ts)
```typescript
export async function prepareCodexHostLaunch(options) {
  // ... 现有处理 ...
  
  // 在计算签名前应用网络派生（需要传入 service 实例或独立函数）
  const derivedEnv = applyCodexNetworkEnvironmentForHost(env);
  
  // 使用派生后的环境计算签名
  const signatureEnv = Object.fromEntries(
    Object.entries(derivedEnv).filter(([key]) => !SESSION_SCOPED_ENV_KEYS.has(key)),
  );
  
  return {
    signature: createHash('sha256').update(JSON.stringify({
      command, args, cwd, 
      env: Object.entries(signatureEnv).sort(...)
    })).digest('hex'),
    authIdentity: await readCodexHostAuthIdentity(buildChildEnv(derivedEnv, ...), cwd),
    launch: { command, args, cwd, env: derivedEnv },
  };
}
```

### 3. 修复 helper 函数

#### deriveCodexNetworkEnvironmentSync
- 修复别名处理：收集所有变体，Windows 生成唯一键，Unix 同步两个别名
- 修复系统代理读取：区分有效/禁用/缺省/失败/未读取
- 修复 diagnostic 为只读

#### readWindowsSystemProxySync
- 实现同步版本（使用 child_process.spawnSync）
- 带超时保护
- 缓存结果（考虑 TTL）

### 4. 修复测试

- 修复 Windows 路径问题（使用 fileURLToPath）
- 添加行为断言而非字符串检查
- 补充真实网络路由测试（需隔离环境）

## 验收清单

- [ ] 修复所有编译错误
- [ ] 所有 Codex 启动路径应用网络派生
- [ ] Windows 系统代理正确读取和保留
- [ ] 别名处理正确（所有大小写变体）
- [ ] Host 签名包含网络环境
- [ ] 集成测试通过
- [ ] shared build 通过
- [ ] API build 通过
- [ ] 类型检查通过
- [ ] 格式检查通过
- [ ] 真实网络路由验证（本地网关 vs 代理）

## 估计工时

2-3 小时（包括完整验收）
