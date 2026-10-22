---
feature_ids: []
topics: [windows, desktop, startup, junction, troubleshooting]
doc_kind: guide
created: 2026-10-22
tips_exempt: 首启自动恢复缺陷修复，沿用现有启动及日志入口，不新增用户操作。
---

# Windows 首启项目资源镜像恢复

关联 [Issue #1689](https://github.com/zts212653/clowder-ai/issues/1689)。本修复针对安装完成后，桌面在 `Project mirror readiness failed before API start` 阶段退出的问题；此时尚未启动 API，也未调用 agent client。

## 自动恢复的边界

桌面把安装目录中的只读资源映射到用户数据根下的 `project`，Windows 使用 NTFS junction。就绪检查覆盖以下三份实际会使用的资源：

```text
docs/harness-feedback/eval-domains/eval-design-gate.yaml
cat-cafe-skills/refs/shared-rules.md
cat-cafe-skills/custody-recognition/SKILL.md
```

插件分离后，旧 `plugins/github/plugin.yaml` 不再是 Host 首启的必需资源；安装目录仍有 plugins 时仍可映射该目录。

正常读取通过时直接继续启动。读取失败时，在原有有限就绪预算内区分安装源文件和项目镜像的错误，执行退避重试及受控的链接恢复；还可使用本次启动 API 所选的同一 Node 可执行文件，在继承当前用户权限的新进程中实际读取源文件和全部关键镜像。只有完整读取通过才允许启动后续服务。这不是跳过资源校验，也不以“Windows 负缓存”作为已证实根因。

恢复只处理已知资源目录中可确认的链接入口，不递归删除链接目标。已有真实目录、自定义文件、配置、角色、认证、Redis、SQLite 和会话历史保持原样。真实目录缺少必需资源、源文件确实缺失或持续无法读取时，仍明确拒绝启动，不通过覆盖用户文件、提权或修改系统盘 ACL 解决。

取消启动时同时停止本次的探针子进程；不会继续启动 API。代码不改变 ACP 的信任、审计、权限模式或客户端命令参数，内网包可继续保留其 CodeAgent 接入。

## 如何看日志

启动失败弹窗的“打开日志目录”指向当前实例实际目录。查看其中 `desktop.log`，搜索：

```text
Project mirror parent read failed
Project mirror readiness verified
Project mirror readiness failed before API start
failed to prepare mirror
Preserving existing non-link mirror
```

成功日志会标明读取验证路径：父进程、重试后的父进程，或实际 Node consumer。失败日志区分 `source` 和 `mirror`，并保留路径、`code`、`errno`、`syscall`，用于判断安装源文件问题还是项目镜像入口问题。`UNKNOWN` 本身不能确认 Windows 原始错误码或缓存机制。

| 日志结果 | 含义及处理 |
|---|---|
| parent reader 验证通过 | 普通启动路径，无需额外操作。 |
| bundled Node consumer 验证通过 | 当前桌面读取失败，但真正启动 API 的 Node 已完整读取源和镜像，自动继续。 |
| source 读取失败 | 保留对应安装路径和错误码，核查安装资源及实际运行账户。 |
| mirror 读取失败、source 正常 | 检查同次日志中的建链/重建信息、目标路径及真实目录保留提示。 |
| Preserving existing non-link mirror | 已有真实目录或不能安全确认类型的入口已保留，不自动覆盖。 |

反馈时附上发生时间、`projectRoot`、`User data dir`，以及对应 source/mirror 错误和恢复结果。用户名和企业路径可以脱敏，但保留路径层级及错误类型。

## 验证口径

回归需要覆盖首个读取失败、父进程持续失败而实际 Node 可读、docs 和 skills 两类镜像、旧/失效 junction、真实目录保护、源缺失、持久失败、取消和超时后的探针回收。

故障注入回归证明恢复行为，正常安装后的实测证明打包接线与启动流程；二者分别记录。它们不等同于已在企业文件系统环境重现 Windows 底层竞态，也不代表真实企业 CodeAgent 的端到端验收已经完成。
