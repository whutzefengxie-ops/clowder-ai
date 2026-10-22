---
feature_ids: []
topics: [desktop, packaging, offline, windows]
doc_kind: implementation-plan
created: 2026-10-22
status: in-progress
---

# Windows 包体优化第一批

本轮用户授权：在独立 worktree 修改、测试并打包对比，提高压缩等级、过滤非目标平台文件和两项构建缓存；保留现有功能及内网离线能力，不覆盖当前安装与运行环境。

基线为已核验的内网 1.14.0 包，sourceSha `7615c9eca5fe01be158060fc4d771c5f77c227b0`，EXE 680,806,374 字节，SHA-256 `f996afbb97b2686f63b5b5d7bb9391147927a6479db3da3e3d8f744cbe75a9ea`。实现位于独立 worktree `G:\AIwork\clowder-ai\cat-cafe-package-slimming-phase1`，不会切换原分支或在 runtime 修改文件。

Architecture cell：Windows 发布载荷。Map delta：保持 Next/API/Redis/Node/Electron 的运行关系；仅修改归档压缩、frozen runtime 文件选择和 Web 构建缓存选择。Why：减少主安装包与安装内容，并保留完整离线资源。

Canonical source：`desktop/scripts/create-runtime-archive.mjs#createRuntimeArchive`、`native-runtime-assets.mjs#nativeRuntimeAssetFilter`、`frozen-runtime-export.mjs#exportFrozenRuntime`、`stage-built-web.mjs#stageBuiltWeb`。

Consumer evidence：`rg -n 'createRuntimeArchive|exportFrozenRuntime|exportModules|stageBuiltWeb' desktop` 可复查归档、导出和构建资源入口；`frozen-runtime-deploy.mjs` 在导出后 bundle 并生成启动预读信息，Windows 安装器与 portable 分发均使用该 frozen output。

Claim guard：Windows x64 只过滤 node-pty 的已知其他平台 prebuilds；共享依赖和私有依赖都受保护，其他平台/未知文件保留。`desktop/frozen-runtime-export.test.mjs` 的目标架构、私有依赖、包身份、源文件保留和外部链接用例覆盖这些要求。Web 保留 fetch-cache、生成的 CSS/WASM/service worker，由 `desktop/built-web-assets.test.mjs` 覆盖。归档的压缩收益、解压字节和完整性错误由 `desktop/runtime-archive-progress.test.mjs` 与 `extract-runtime-archive.test.cjs` 覆盖。

## 实现范围

- 五个 Node tar 归档使用 gzip 9；保留现有 gzip 格式、解包器和完整性 sidecar。Node 归档仍由现有系统 tar 路径生成，Inno 的 nocompression 不变。
- 仅 Windows x64 的 node-pty 包排除 `win32-arm64`、`linux-arm64`、`linux-x64`、`darwin-arm64`、`darwin-x64` prebuilds。包身份由 package.json 核实；其他包、未知平台、win32-x64 文件及其 PDB/maps 保留。目标默认与构建 Node 的平台/架构一致，导出函数也接受显式 targetPlatform。
- 在解析目标链接并核实其位于 frozen workspace 内之后，再应用文件选择；过滤不能掩盖外部链接。
- Web staging 额外过滤 `.next/cache/.tsbuildinfo` 和 `.next/cache/eslint`，保留现有 webpack cache 排除项；不排除整个 cache，保留 fetch-cache 等运行内容。
- 不改图片、ONNX、VAD、esbuild WASM、源码、API 模块、Next/SWC、Claude SDK、代理配置和数据；不外置 x64 调试文件。

## 验证与证据

三项行为检查先在原实现上得到 4 个预期失败，再以最小实现转绿。定向验证命令：

```powershell
node --test --test-concurrency=1 desktop/built-web-assets.test.mjs desktop/frozen-runtime-export.test.mjs desktop/runtime-archive-progress.test.mjs desktop/extract-runtime-archive.test.cjs desktop/verify-runtime-archives.test.mjs desktop/runtime-dependency-selection.test.mjs desktop/workspace-runtime-modules.test.mjs desktop/api-startup-read-ahead.test.mjs desktop/runtime-package-bundle.test.mjs desktop/api-bundle.test.mjs desktop/api-dependency-bundle.test.mjs
pnpm exec biome check desktop/scripts/native-runtime-assets.mjs desktop/scripts/frozen-runtime-export.mjs desktop/scripts/stage-built-web.mjs desktop/scripts/create-runtime-archive.mjs desktop/frozen-runtime-export.test.mjs desktop/built-web-assets.test.mjs desktop/runtime-archive-progress.test.mjs
```

既有启动预读测试在多文件并发执行时一次未能在 40 ms 预算内启动读取；串行执行后通过。没有修改该测试或启动预读实现。定向检查共 58 项通过。Biome 无错误，保留既有复杂度/未使用参数警告。

打包时保持干净源码、锁文件、构建身份检查和完整 manifest，不重写旧构建 stamp。最终报告须区分与现有交付包的比较、同一组程序/资源输入下的压缩/筛选比较及实际运行证据；不得将只读计数当作已生成安装包。

待核实：实际 EXE 大小、归档成员差异及必要文件哈希、真实原生加载/终端、隔离的首次启动与本地资源。测试实例使用自有端口和独立 HOME/数据目录，不连接生产 Redis，不导入真实用户凭据，不注册或覆盖当前安装。

实现回退为恢复本次四个生产源码文件并重建新工件；没有数据格式迁移或用户数据清理。保留当前交付包、回退包、源码工作树和运行实例。后续部署需要另外明确授权。
