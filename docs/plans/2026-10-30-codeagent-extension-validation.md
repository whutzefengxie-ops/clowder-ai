---
feature_ids: [F241]
topics: [codeagent, plugins, acp, validation, windows]
doc_kind: implementation-acceptance
created: 2026-10-30
---

# 固定 ACP 客户端插件配置：验证记录

范围为[三端分工](./2026-10-30-codeagent-host-plugin-intranet-scope.md)的 H1–H4 及 CodeAgent 独立插件。基础是用户指定角色重构 `99d68baa82e2d27ffde176df76f8d8eed6eb897e`；只消费其已有注册/会话/权限框架，未改原基础工作树。H5 持久 Host 策略和 H6 自动离线预置仍单独待交付，本文不把源码安装等同于 EXE 预置。

## 已运行证据

| 层 | 命令/入口 | 结果 |
| --- | --- | --- |
| RED：固定配置 | `client-library.test.js` 新用例 | 先观察到 4 个预期失败；实现后 10/10 通过 |
| RED：UI | Web `agent-client-identity.test.tsx` | 新增 2 项先失败；实现后共 3/3 通过 |
| RED：恢复 | `acp-bootstrap-config-recovery.test.js` + `client-library-lifecycle.test.js` | 固定对象 root-only 保存与无旧释放句柄的注册恢复，先观察 2 个语义失败后修复；初始测试夹具 ReferenceError 已纠正，未作为 RED 依据 |
| API 小回归 | 上述恢复/生命周期 + `client-library.test.js` | 41/41；后补固定目录元数据及真实刷新失败恢复用例，生命周期 6/6 |
| API 扩大回归 | 三个 `agent-session-contract*` 目录的所有 `.test.js` + root-only 恢复；`--test-concurrency=2` | 隔离进程显式 `CAT_CAFE_WINDOWS_ACP_BOOTSTRAP_MODE=trusted-host`：362/362，通过，无 skip |
| 严格模式诊断 | 同一扩大集合，未设置兼容模式 | 348 pass / 14 fail；失败均为 `client-library-home-capabilities` 的 Temp 祖先信任/工厂未准备，与基础验收记录所列同类 Windows 环境限制一致；不宣称该模式全绿 |
| 类型与格式 | API `tsc --incremental --pretty false`；Web `tsc --noEmit --pretty false`；本次文件 Biome；`git diff --check` | 通过；Biome 仍有警告级复杂度/既有非空断言，未为消警告扩范围 |
| 插件源码/产物 | CodeAgent Node package test；`pnpm pack --pack-destination <artifact>` → 解包 → `CODEAGENT_PACKAGE_DIR=<package> node --test test/package.test.mjs` | 源码及实际产物均通过；无运行依赖、原生 binary 或认证副本 |
| 生产 Host + 实际 tgz | `CODEAGENT_PLUGIN_ARCHIVE=<tgz>`，运行 `fixed-client-package.test.js` | 真实 Manager 安装/磁盘 inventory/配置/启用；双 ACP 子进程独立 session；续聊；非法保存后的修正恢复；停用阻断/重新启用；重建 runtime 后配置与注册恢复，全部通过 |
| 浏览器 | 隔离 API 4318 / 前端 4325，真实 `PluginManagerConfigurationSection`、真实包与 Manager routes、真实审计 writer；仅会话身份为测试夹具 | 显示固定 CodeAgent/id，一份连接，无添加/删除客户端；保存路径后生成真实配置与审计记录，刷新回读路径且 ID 不变；不是完整 Settings 导航/真实用户认证验收 |

API 测试由 `packages/api/scripts/with-test-home.mjs` 配合 `--import ./test/helpers/setup-cat-registry.js` 运行，`CAT_CAFE_DISABLE_SHARED_STATE_PREFLIGHT=1`，不连接生产 Redis。UI 命令为 `pnpm --filter @cat-cafe/web exec node scripts/run-with-node-env-test.mjs node ./node_modules/vitest/vitest.mjs run src/components/settings/plugin-manager/__tests__/agent-client-identity.test.tsx`。

## 证据边界与保留

产物候选为 `@clowder-ai/codeagent@0.1.0-beta.2`，本轮已验 tgz SHA-256 为 `83c3a06bb2a1d9501a4fea34bd82a4adf562f75bd9143635f5392c16ecbddf9e`。后续发布前仍需按最终提交核包字节；不能将版本号相同视为哈希相同。

执行端是明确命名的 `fake-acp-agent.mjs` 协议 fixture，通过 Host 正常命令覆盖引用外部脚本，未伪造 PATH 上的 CodeAgent。它证明 ACP wire/Host 插件链路，不证明企业 CodeAgent 模型、登录、MCP 真调用或角色协作；现有 `#tool` 只产生协议事件，不称为 Clowder MCP 调用。

真实企业 CodeAgent 由用户在内网验收，已按用户指示取消要求提供本机 binary。新内网 EXE、自动预置、完整 UI 导航、真实客户端 MCP/协作以及企业账号/代理/CA 尚未验证，不提前记为完成；基础重构其他残余以其自身验收记录为准。

本机证据集中于任务 artifacts 的 `codeagent-plugin-extension-20261030`：RED/GREEN/扩大回归日志、tgz、配置截图、测试实例台账。浏览器验证服务 PID 39204 已按完整命令行核归属后停止，4318/4325 已确认释放；测试配置、审计与截图保留在隔离目录。未修改系统盘/祖先 ACL、用户配置、原生客户端 HOME 或业务历史。
