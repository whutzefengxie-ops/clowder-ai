---
feature_ids: [F241]
topics: [acp, windows, plugins, compatibility]
doc_kind: guide
created: 2026-10-22
---

# Windows 可信主机兼容模式

适用于管理员已认可本机所有账户与存储环境，愿意接受祖先目录被其他账户替换的风险，但企业镜像的 owner / ACL 无法满足完整信任检查的部署。默认严格模式不变。

## 开启和操作

在运行 **Host API** 的电脑上，由启动 Host 的同一个账户，在启动 API 前设置：

```powershell
$env:CAT_CAFE_TRUSTED_HOST_COMPATIBILITY = '1'
```

然后从**同一个终端**按[Host 操作指南](./acp-client-plugin-user-guide.md)启动 API。已运行的 API 必须正常停止再启动；仅刷新网页或重启 Web 不生效。
也可在部署所使用的 `.env` 中加入 `CAT_CAFE_TRUSTED_HOST_COMPATIBILITY=1`，按原启动流程重启 API。该开关不允许通过插件、成员配置或 Hub 环境变量编辑接口修改。

1. Host 本机浏览器以所有者身份进入「设置 → 插件 → ACP 客户端目录」。
2. CodeAgent 的引导目录先留空，点「检查引导目录」。应显示「兼容模式检查通过（已跳过祖先信任校验）」及完整路径。
3. 点「使用此目录」，再「保存配置」。显示审计告警时，配置已保存，但该次审计未记录成功。
4. 退出并重新进入配置页，确认路径持久存在；再给绑定该 client 的角色发消息。

自动位置若已有损坏的私有 ACL，保留原目录，改填**尚不存在的专用末级目录**，例如 `D:\ClowderACP-Private`；其父目录 `D:\` 必须存在。Host 只会创建新的私有目录，不修补已有文件夹的 ACL。不要把共享项目根、盘根或普通已有文件夹当作私有引导目录。

无需执行 `takeown`、移除 Authenticated Users 的盘根授权或修改系统盘权限。`D:` 是相对当前 D 盘工作位置的路径；填写时使用 `D:\...` 完整路径。

## 调整了哪些限制

| 检查 | 兼容模式 |
| --- | --- |
| Windows 祖先 owner / 祖先 ACL 信任 | 跳过，接受祖先替换风险 |
| 引导目录自身的当前用户 owner、受保护私有 DACL | 保留；不安全的已有目录仍拒绝 |
| 实际本地 NTFS 卷、每级非 reparse / junction、SUBST 验证 | 保留 |
| spawn 前复验 | 保留，使用同一 Host 策略 |
| 插件配置保存前审计追加失败 | 告警后继续保存，页面保留警告 |
| 配置校验、版本围栏、实际写入/恢复失败 | 保留失败，不能显示成已保存 |
| 登录、owner、本机访问、Origin/CSRF、受限角色权限 | 保留 |
| 插件安装、更新、启停、卸载及工具调用审计 | 保留原准入要求 |

插件管理本身仍只允许直接本机访问。内网另一台电脑上的浏览器不能因此获得管理权限；这里的目录始终属于运行 Host 的电脑。

## 审计告警怎样处理

`Plugin audit log is unavailable` 表示保存前的审计追加失败，不是引导目录检查失败。默认目录为 API 工作目录下 `data/audit-logs`；也可用 `AUDIT_LOG_DIR` 指向运行 API 的账户能够正常追加的专用目录。

兼容模式允许保存，同时显示「配置已保存，但插件审计写入失败」。审计目录恢复可用后，下次明确保存会重新尝试审计，不会永久缓存旧失败；成功时不再返回该警告。
若后续还要安装或启停插件，仍须修复审计目录。不要通过反复修改盘根 ACL 或把审计目录指向只读安装目录处理。

## CodeAgent 的 EPERM

检查通过只证明当前 Host 策略下的引导目录可用。`prompt_failure: EPERM` 还可能发生于真实项目、客户端 HOME/认证、会话建立、MCP 或客户端自身的权限策略。
此模式不能绕过 Windows 或 CodeAgent 自身返回的错误。先确认配置保存并回读成功，再区分 `ACP initialize: agent ready`、`ACP newSession starting/completed` 和客户端 stderr。
本机验证使用合成 ACP fixture；没有真实 CodeAgent，也没有连接原企业机器，不能把本机结果当作 CodeAgent 内网验收通过。

## 恢复严格模式

将启动环境或部署 `.env` 中的开关删去或设为 `0`，正常重启 API。配置和历史保留；严格模式会重新验证既有引导目录，祖先不合格时再次拒绝。只修改当前 PowerShell 的环境不会影响已经运行的 API。
