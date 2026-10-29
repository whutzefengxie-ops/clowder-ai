---
feature_ids: [F241]
topics: [host, acp, windows, deployment, configuration, validation]
doc_kind: implementation-acceptance
created: 2026-10-30
---

# 持久 Host 策略读取：独立切片与验证

本切片实现三端交付合同 H5，基于用户指定基础 `99d68baa82e2d27ffde176df76f8d8eed6eb897e` 新建 `feat/persistent-acp-host-policy` 工作树。与固定客户端配置的 Host fork PR #16 分开；不修改原基础或原内网工作树，不迁移内网旧文件，不包含 H6 离线插件预置或新的 EXE。

## 交付行为

- 复用已有 deployment profiles，新增可选 `hostPolicy`，只接受 `bootstrapMode`/`auditMode`。公共未配置时 strict/required 不变；构建投影只保留选中发行的策略值。
- owner 文件 > 环境新键/旧 exact-one > 发行预设 > 公共默认，逐键解析。有效 strict 或非 Windows 仍屏蔽受限审计例外；目录自身私有权限、本机管理/鉴权和原 root-only 条件不变。
- API 启动只读 `CAT_CAFE_HOST_POLICY_FILE` 指定的绝对路径；未指定不猜 cwd，缺失继承，空对象继承，非法/不可读输入在监听前失败。接受 Windows 编辑器常见 UTF-8 BOM；不输出坏 JSON 的原始文本。
- 桌面默认传递 `<实际 userDataDir>/host-policy.json`，普通部署显式环境路径优先。隔离实例始终用自身路径，避免继承另一部署的策略文件。API/普通启动不创建、不回写该文件或 `.env`，不修改 process.env。
- 启动安装一份冻结快照，祖先信任和审计准入均从中读取；更改文件不热变，完整重启才生效。日志报告逐键来源、实际 owner 文件路径、请求/有效模式和屏蔽原因。
- 原 `.env`、环境与已验证内网配置继续保留；旧 `intranet-host.json` 的只读桥由发行侧沿用，不能据本公共切片宣称已完成内网合包。审计目录不迁移，不改系统盘/祖先 ACL、原生 HOME 或业务历史。

用户操作见 `docs/ops/acp-trusted-host-compatibility.md`。普通内网使用发行预设即可长期生效；管理员要覆盖时从桌面 `User data dir` / API `ACP_HOST_POLICY.ownerFile` 找到实际位置，手动配置一次后重启，无需每次终端设置变量。CLI 可继续用原 `.env` 两键或显式文件路径。

## 验证记录

| 检查 | 结果与边界 |
| --- | --- |
| RED → GREEN | 先观察 owner/preset 优先级 2 项、发行投影 1 项、桌面路径 1 项的语义失败，再实现；隔离路径新增反例也先失败后修复。夹具缺端口错误已纠正，未作为 RED 证据 |
| 编译 | `pnpm --filter @cat-cafe/api build` 与后续 API incremental tsc 通过，含 shared/MCP 编译；不声称打了新 EXE |
| 新文件与进程 | 普通 Node `.test.js` 已进入递归公共测试选择；6/6：文件严格验证/字节保留、优先级、冻结消费者、真实隐藏子进程改文件/重启及生产 API 非法配置启动拒绝 |
| 旧 B/C 矩阵 | `acp-host-policy-matrix.test.ts` 4/4；旧 exact-one 与新键、非法值、非 Windows 和诊断语义保持 |
| Bootstrap/审计回归 | 10 文件集合 55 tests，51 pass、4 skip、0 fail。skip 为已有 DSH 审核安装/显式数据卷夹具未提供；未以 skip 作为原生验证通过 |
| 桌面环境 | 原 isolation 测试 + 独立 `host-policy-env.test.js` 合计 11/11，含默认/显式路径、隔离路径及既有原生 HOME/数据隔离 |
| 发行投影 | 独立 `deployment-host-policy.test.mjs` 通过；不继续扩大已有超长测试文件；共享字段校验与活动发行去除未选值有行为保护 |
| 注册/模板 | `pnpm check:env-registry` 10/10、`pnpm check:env-example` 4/4；新路径键不可热改、需重启 |
| 原部署集合 | 原脚本+桌面集合初次 21 pass/1 fail/10 skip；Unix launcher 失败在未修改的基础工作树同样复现，本机 bash 指向缺失 ext4.vhdx 的 WSL。未修改 WSL/系统设置，也未把整组报为全绿 |
| 格式/差异 | 定向 Biome 和 `git diff --check`；只格式化本次 TypeScript/新测试，不因 CRLF 重写周边文件 |

Linux CI 的既有 ACP policy 步骤加入文件/进程/发行投影测试；Windows/macOS smoke 加入桌面策略路径测试。新测试文件均低于 350 行；已有大文件只保留必要接线，未借机重构。

本机证据保存在任务 artifacts 的 `codeagent-plugin-extension-20261030/policy-*`、`persistent-policy-red.log`、`deployment-policy-red.log`、`desktop-policy-red.log`。所有子进程是测试拥有的隐藏 Node，已退出；未启动额外长期服务或连接生产 Redis。独立审查及 PR 状态以实际后续记录为准，本文不自行签署批准。
