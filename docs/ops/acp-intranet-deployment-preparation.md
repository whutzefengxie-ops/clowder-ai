---
feature_ids: [F241]
topics: [acp, windows, deployment, audit]
doc_kind: guide
created: 2026-10-22
---

# 内网源码部署的一次准备（独立 D）

本工具由部署负责人在首次准备时显式执行。它不属于 API 启动或普通启动器；API 永不改写 `.env`。需要包含独立 B/C 策略键的 Host，且先构建目标 API：

```powershell
pnpm --filter @cat-cafe/shared build
pnpm --filter @cat-cafe/api build
node scripts/prepare-intranet-deployment.mjs --host-root "D:\ClowderAI"
```

`--host-root` 是已有 Host 源码根目录，包含 `package.json` 和 `packages/api/package.json`，不是项目工作目录、插件目录或安装 EXE 的目录。本版不自动接线 desktop 安装器。脚本可以从 D 工位运行并明确指定目标，正常启动仍使用目标原有入口。

负责人只执行一次，随后重启 API。普通重启和升级继续读取目标根 `.env`，无需用户每次设置终端变量。Windows 与 Bash 均读取该文件；有策略/日志路径的 `.env.local` 会拒绝准备，请先由负责人消除冲突。`.env.intranet.example` 只是两项策略的参考，不会被自动加载；公共 `.env.example` 继续由公共注册表检查保护。

## 写盘与保留规则

只给缺失键追加 B=`trusted-host`、C=`warn-bootstrap-root`、选定 `AUDIT_LOG_DIR` 和准备回执 ID。原有键优先，包括明确的 `strict`/`required`；原文件字节前缀、认证、端口和历史不覆盖。无效值、重复键、动态路径或链接路径会报错，负责人处理后重试；失败不会静默改用宽松配置。

写入目标为 `<host-root>/.env`；同目录临时文件 flush 后原子替换，替换前复读原文，遇到并发编辑拒绝。Windows 保留原 `.env` 的 DACL，其他平台保留原文件 mode。不执行 `icacls`、`takeown`、盘根提权或系统 ACL 修改。准备时请停止其他配置编辑；工具锁只协调本工具的并发调用，不能锁住任意外部编辑器。

准备状态与锁位于 `<host-root>/.cat-cafe/deployment-preparation.json` 和 `deployment-preparation.lock`，不存凭证。成功后重复执行不改 `.env`、不重复探针。失败留下已创建目录及追加过的事件以供诊断；不要删除日志或业务配置来恢复。崩溃残留锁可显式追加 `--recover-stale-lock` 重试，只保留并改名确认 PID 已退出的锁；活进程或身份不明时拒绝。

## 审计位置与一次探针

显式 `AUDIT_LOG_DIR` 优先，relative 路径按 API cwd 解析。旧 `<host-root>/packages/api/data/audit-logs` 已存在时保留，不因不可写而静默绕过。仅全新部署且没有旧位置时，调用目标 API 的 `resolveCatCafeDataRoot`（`CAT_CAFE_DATA_DIR` 或 `~/.cat-cafe`），选择其 `audit-logs`。这不迁移公共默认位置，也不替换 desktop 已设置的路径。

使用目标构建产物的真实 `EventAuditLog` 追加 `host.deployment.audit-readiness`，仅含 schemaVersion、preparationId、operation。它是准备探针，不伪装成配置变更；永久保留，不清理。相同 preparationId 在失败重试时先查询真实日志，已追加则不重复写入。普通启动不运行探针。

审计追加失败时不写 `.env`；修复日志目录后重新执行。追加已成功、配置写入失败时保留回执并重试同一准备。目标或策略改变需另行评估迁移，不能悄悄重定向旧日志。更改 `AUDIT_LOG_DIR` 必须重启 API，Hub 无法热改它，writer 构造后固定绑定位置。

## 策略边界与验收

B 只跳过 Windows 祖先信任，不跳过末级私有权限、NTFS、链接检查或启动前复验。C 只在 Windows+B 有效时允许已授权、已有 client 的纯引导目录变更在审计失败后保存；新增 client、改命令等仍需正常审计。管理接口仍要求直接本机 owner/Origin，不因内网配置向反代浏览器授权。`strict` 与启动器 `CAT_CAFE_STRICT_PROFILE_DEFAULTS` 无关。

负责人验收：第一次命令返回 prepared；第二次返回 unchanged；正常启动后诊断给出相同有效模式及实际日志目录；插件安装/保存、角色绑定和实际 MCP 调用通过；重启后路径及角色不丢失。CodeAgent 使用既有 `codeagent --acp` 配置，原有客户端 bypass 设置不被准备脚本新增或改动。检查成功不代表客户端认证、模型额度或原生 EPERM 全部正常。
