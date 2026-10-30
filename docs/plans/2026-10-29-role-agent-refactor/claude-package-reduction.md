---
feature_ids: [F161, F241]
topics: [claude, packaging, external-runtime]
doc_kind: implementation-plan
created: 2026-10-30
---

# Claude 主包减重（PR #1748）

来源：用户要求在当前 PR 实施主包不再捆绑 Claude 大型程序。沿用既有工位与所有数据保护规则，不切换生产、不强制迁移 ACP。

PR #1748 的目标为上游 `develop`（2026-10-30 用户更正，已远端回读），不是 `main`；原始源码基线仍按总账保留。

1. SDK 调用显式使用外部 Claude：在既有准入端口捕获程序路径、版本及文件摘要，启动前核对；缺少程序或文件变化时在发送前报错。构造服务不发现或加载 Claude，其他客户端不受影响。
2. 冻结发行导出保留 SDK JavaScript 库，仅排除其平台原生包，包括根/私有嵌套及 Windows/macOS 布局。其他 optional/native 依赖保留。归档入口拒绝残留原生包，旧缓存不能绕过。
3. 先运行失败用例，再实现并运行 SDK、冻结导出、归档与类型检查。使用真实 SDK 无模型协议夹具验证外部程序调用及缺失处理；记录真实依赖文件和同条件压缩前后大小。
4. 更新 PR 和实施记录，提交并推送当前分支。Windows 安装包能否完整构建以实际结果记录；没有 Mac，不能宣称 macOS 实机/DMG 验收通过。

Architecture cell：identity-session / transport；Map delta：沿用原 captureInvocationOptions、SDK carrier 和 frozen-runtime-export，无新增 owner、数据库、下载器或生命周期。

验证入口：`node --test desktop/claude-runtime-packaging.test.mjs`；API 使用既有 with-test-home.mjs 与 SDK 测试命令。格式命令为 `pnpm biome format --write <本次文件>`，终态执行定向 Biome 与 API tsc。完整 34 项验收仍单独记账，本切片不替代整体验收。

## 已执行的代码与验证

`claude-sdk-runtime.ts` 复用原 CLI 发现和 Windows npm shim 解析，执行无模型的 `--version` 并捕获规范化入口和 SHA-256。正式调用在原 captureInvocationOptions 保存快照，发送前核对原文件；直接 SDK 调用也必须解析外部程序。SDK 的 Node 参数只接受 node/bun/deno，因此 JS 入口通过选定系统 Node 的目录构造子进程 PATH，不启动 Electron。模型发现共用同一解析和启动参数。构造服务和未使用 Claude 的 API 启动不探测客户端。

`frozen-runtime-export.mjs` 在原 materialize 边界按真实包名排除 Claude SDK 平台原生包，保留 JavaScript SDK 和其他 native/optional 依赖；共享和独立依赖布局及嵌套副本均覆盖。`create-runtime-archive.mjs` 在压缩前拒绝旧部署残留。没有全局 --no-optional、依赖锁重写、隐式下载或第二套 launcher。

| 已执行范围 | 证据与边界 |
| --- | --- |
| 可信 RED | claude-packaging-red.log：两种导出仍带原生包，旧缓存可归档；claude-external-red.log：SDK 未采用提供的程序路径 |
| 打包/导出/归档回归 | claude-packaging-final.log：14 PASS，无失败/跳过 |
| SDK/账号/权限/设置/压缩回归 | claude-sdk-regression.log：57 PASS、1 既有 SKIP；不将跳过计为通过 |
| 受影响调用/追加/停止/MCP | claude-sdk-affected-owner.log：50 PASS，无失败/跳过 |
| 真实 SDK 的独立程序协议 | claude-sdk-wire-closed.log：4 PASS。复制的真实 SDK 无 exe/node/native 包，验证调用、历史 API 读取不存在会话、模型发现、缺失提示和同路径文件更换拒绝。程序是协议夹具，不是实际模型 |
| 本机真实 Claude 2.1.312 | claude-real-external-receipt.json：SDK 0.3.285、真实产品 carrier、外部原生程序、本地合成提供方；10 项检查通过，含 UUID 已读、追加、工具结果、旧调用拒绝及同一 session 续接。未改写 SDK 提供的程序路径，没有真实模型请求 |
| 类型与格式 | API tsc 通过；26 文件 Biome 无错误，14 条已有 warning；diff --check 通过 |

原始日志在本工位 artifacts/role-agent-refactor-20261029-gpt-sol。扩大回归还保留一次缺 tsx loader 的 runner 失败，以及 Windows tmux 场景缺少无扩展名 tee 的失败；修正 runner 后，实际受影响集合 50 PASS，未为 tmux 改产品、降低 guard 或新增 skip。归档最初在 tar 异步 filter 中抛错，已改为生成前预检。SDK 协议测试首次用 .cjs 被 SDK 当原生文件，改用它支持的 .js；Windows 清理等待改为异步 rm，确保子进程结束后再回收普通夹具。这些失败见证均保留。

真实运行数据根 `C:/Users/Administrator/AppData/Local/Temp/ca-H9wssJ` 为本任务独立创建，不复用本机 Claude HOME。两条原生进程在 spawn 回执中退出 code=0，测试 HTTP 端口关闭，数据和台账保留；PID 后续复用不作为仍运行的证据，也不结束其他进程。台账为 claude-real-external-instance.json。

## 真实 Claude 组件体积

`claude-size-8iwVM4/measurement.json` 记录同一 SDK 0.3.285、同一布局、gzip level 1 的前后清单与逐文件 SHA-256。通过新的 materialize 实际导出，移除 243,751,648 bytes（其中 claude.exe 243,751,072 bytes）；压缩组件从 120,156,778 bytes 降至 1,757,785 bytes，减少 118,398,993 bytes，约 112.91 MiB。保留 JavaScript SDK。此数是 Claude 组件差值，不能冒充最终 EXE/DMG 的净减量；其他依赖与首次单独准备 Claude 的占用没有在该比较中消失。

当前仍待：Windows 最终安装物构建与核查、独立审查、macOS 实机/DMG、内网离线环境及全量 34 项 C/E/Q。此处不把本机合成提供方说成真实质量或企业验收。

## 独立审查后的响应性修复

非作者 claude_package_review 对 `6eb09adb7e318a562220806a383699e0f544e214` 独立验证打包 12 PASS、协议 4 PASS、SDK/MCP 43 PASS，发现一个 P2：同步版本探测会阻塞共享 API；600ms 延迟夹具令 25ms 心跳延迟至约801ms。原反例保留于 artifacts/claude-package-peer-review/nonblocking-runtime-probe.mjs 和 nonblocking-runtime-red.log。

已改为异步 execFile 和流式异步 SHA-256，原 captureInvocationOptions、模型发现及启动准备等待同一快照；传递现有 AbortSignal，可取消版本探测与文件读取，没有增加轮询或缓存。原反例转绿，capture 结束前心跳已执行；永久用例同时覆盖慢启动期间的事件循环和取消。API tsc 通过，`claude-runtime-async-regression.log` 为 123 项：122 PASS、1 既有 SKIP、无失败；包括全部本切片 SDK/调用链/配置冻结测试。

异步版本又用真实 CLI 2.1.312 和本地合成提供方复验同一十项，全部通过（`claude-real-external-async.log`），新数据根为 `C:/Users/Administrator/AppData/Local/Temp/ca-OcBUum`，两条原生进程 code=0、测试端口关闭，数据保留。独立的 SDK JavaScript 副本还实际读取了前次原生会话：8 条消息可读，没有 native 平台包（`claude-library-history.log`）。等待修复 SHA 的同一 reviewer 复审，未将旧批准转录为新批准。

发布构建在原工位因历史未跟踪测试证据被 clean-check 拒绝，证据保留。已按原 managed worktree 入口创建 `build/pr1748-claude-gpt-sol` 独立构建工位，owner=codex、ttl=7天；仅在那里构建，不清理或覆盖原记录，不使用 -AllowDirtyInputs 绕过发布检查。
