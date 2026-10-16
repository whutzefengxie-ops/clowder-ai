# 🎯 正确的 ASAR 优化方案

## 问题分析

即使设置 `asar: true`，当前配置的问题是：

```json
{
  "asar": true,
  "extraResources": [
    { "from": "../bundled/deploy/api", "to": "packages/api" },     // ❌ 11,484 个文件在外部
    { "from": "../bundled/deploy/web", "to": "packages/web" },     // ❌ 1,312 个文件在外部
    { "from": "../bundled/deploy/mcp-server", "to": "packages/mcp-server" }  // ❌ 1,366 个文件在外部
  ]
}
```

**extraResources 永远不会被打包到 ASAR 中！** 它们会放在 `resources/` 目录下。

## 根本解决方案

### 方案 A：将代码移到 ASAR 内（推荐，最大性能提升）

**原理**：让 Electron 从 ASAR 虚拟文件系统中加载代码

**修改**：
1. 将 API/Web/MCP 从 `extraResources` 移到 `files`
2. 仅保留必须在外部的二进制文件在 `extraResources`

```json
{
  "build": {
    "asar": true,
    "asarUnpack": [
      "**/*.node",
      "**/node_modules/@anthropic-ai/claude-agent-sdk-*/claude-agent-sdk.*.node"
    ],
    "files": [
      // 主进程代码
      "*.js",
      "*.html",
      "assets/**/*",
      "plugin-window/**/*",
      
      // ✅ 将这些移到 ASAR
      "../bundled/deploy/api/**/*",
      "../bundled/deploy/web/**/*",
      "../bundled/deploy/mcp-server/**/*",
      "../cat-template.json",
      "../pnpm-workspace.yaml",
      "../package.json",
      "../cat-cafe-skills/**/*",
      "../.claude/hooks/**/*",
      "../docs/**/*",
      "../scripts/**/*",
      "../guides/**/*",
      "../assets/**/*",
      "../packages/api/src/plugins/**/*"
    ],
    "extraResources": [
      // ❌ 从这里移除 API/Web/MCP
      // ✅ 仅保留无法在 ASAR 中的资源（通过安装脚本处理）
    ]
  }
}
```

**问题**：这需要修改代码路径解析逻辑

### 方案 B：保持架构，使用预打包的 ASAR（当前最可行）

**原理**：在构建阶段预先将 API/Web/MCP 打包成 ASAR，然后作为单个文件复制

**实施步骤**：

#### 1. 创建预打包脚本
```javascript
// desktop/scripts/pre-bundle-packages.mjs
import asar from 'asar';
import path from 'path';

// 将 API/Web/MCP 打包成独立的 ASAR
await asar.createPackage(
  'bundled/deploy',
  'desktop/resources-prebuilt/packages.asar',
  {}
);
```

#### 2. 修改构建配置
```json
{
  "extraResources": [
    {
      "from": "./resources-prebuilt/packages.asar",
      "to": "packages.asar"  // ✅ 单个文件！
    },
    // 其他小文件保持
  ]
}
```

#### 3. 修改代码以从 ASAR 读取
```javascript
// service-manager.js
const packagesAsar = path.join(this.root, 'packages.asar');
const apiEntry = path.join(packagesAsar, 'api', 'dist', 'index.js');
// Node.js 可以直接从 ASAR 中 require
```

**优点**：
- 不改变目录结构
- 减少文件数：14,162 → 1 个
- 安装时间大幅减少

**缺点**：
- 需要修改路径解析
- 需要额外的预打包步骤

### 方案 C：使用压缩归档 + 安装时解压（你们当前在用）

**当前问题**：82,919 个小文件解压太慢

**优化方向**：
1. 使用更快的压缩格式（zstd 而非 gzip）
2. 使用多线程解压
3. 使用更大的压缩块

**修改 `desktop/scripts/create-runtime-archive.mjs`**：
```javascript
// 当前：gzip level 1
await tar.c({ file, cwd: source, portable: true, gzip: { level: 1 }, jobs: 4, follow: false }, ['.']);

// 优化：使用 zstd + 更多线程
await tar.c({ 
  file, 
  cwd: source, 
  portable: true, 
  zstd: true,  // 更快的压缩
  jobs: os.cpus().length,  // 所有 CPU 核心
  follow: false 
}, ['.']);
```

**局限**：仍然需要解压 82,919 个文件

## 推荐实施路径

### 阶段 1：启用 Electron ASAR（已完成）
```json
"asar": true
```
- 主进程代码（~100 文件）打包到 app.asar
- 减少主进程启动时间

**预期提升**：主进程启动加快 2-3 秒

### 阶段 2：探索方案 B（预打包 packages）
1. 测试从 ASAR 启动 Node.js 子进程
2. 如果成功，实施完整方案 B

**预期提升**：
- 安装时间：117s → 10-15s
- 启动时间：112s → 20-30s

### 阶段 3：如果方案 B 不可行，优化方案 C
- 使用 zstd 压缩
- 多线程解压
- 固态硬盘检测和提示

**预期提升**：
- 安装时间：117s → 60-80s
- 启动时间：保持或略有改善

## 技术验证

### 测试：Node.js 能否从 ASAR 启动？

```javascript
// 测试脚本
const { spawn } = require('child_process');
const path = require('path');

// 假设 API 在 packages.asar 中
const apiEntry = path.join(__dirname, 'packages.asar', 'api', 'dist', 'index.js');
const proc = spawn('node', [apiEntry]);

proc.on('error', (err) => {
  console.error('❌ Cannot spawn from ASAR:', err);
});

proc.on('spawn', () => {
  console.log('✅ Can spawn from ASAR!');
});
```

**如果失败**：Node.js 不能直接执行 ASAR 中的脚本，需要：
1. 先解压到临时目录
2. 或使用 `require()` 而非 `spawn()`
3. 或保持当前架构，仅优化压缩

## 立即可测试的方案

### 最小化验证：测试主进程 ASAR（当前配置）

```bash
cd /g/AIwork/clowder-ai/worktrees/feat-onboarding-first-run/desktop
pnpm run pack  # 只打包，不构建安装器

# 检查生成的结构
ls -lh dist/win-unpacked/resources/
# 应该看到 app.asar（主进程代码）

# 测试启动
cd dist/win-unpacked
./ClowderAI.exe
```

**预期**：
- 主进程启动稍快（2-3 秒）
- API/Web 启动时间不变（仍然是散文件）

### 下一步实验：预打包 packages

如果上面成功，我可以实施方案 B 的完整版本。

## 总结

| 方案 | 复杂度 | 预期提升 | 风险 |
|------|--------|---------|------|
| A: 代码移到 app.asar | 高 | 巨大（90%+） | 路径解析问题 |
| B: 预打包 packages.asar | 中 | 很大（70-80%） | spawn 兼容性 |
| C: 优化压缩 | 低 | 中等（30-40%） | 有限提升 |
| 当前: 仅主进程 ASAR | 极低 | 小（2-3%） | 几乎无 |

**我的建议**：
1. 先验证当前配置（asar: true）是否正常工作
2. 如果正常，尝试方案 B（预打包 packages）
3. 如果方案 B 有问题，退回到方案 C（优化压缩）
