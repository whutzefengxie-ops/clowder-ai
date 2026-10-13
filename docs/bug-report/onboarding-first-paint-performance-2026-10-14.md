---
feature_ids: [F171, F155, F322]
topics: [onboarding, shell, hydration, performance]
doc_kind: bug-report
created: 2026-10-14
tips_exempt: Repairs the existing first-use journey and adds local diagnostic logs; no new user capability.
---

# #1466 首屏切换与引导跳转性能

用户反馈：空白实例先显示经典欢迎页，再换新版首页；完整引导跳转卡顿。附件三份均为静态 PNG，用户授权自行录制/使用日志分析。本记录区分实际取证与尚未验证的部分。

## 根因与归属

1. `useShellPresentation` 的服务端快照默认 classic，AppShell 在 passive effect 才将 URL 的 v2 写入浏览器偏好。页面与轨道各自读取旧值，形成经典 → 新版切换。修改前这两个文件与同步的 main 相同。已用首次 layout effect 观察到 classic 的失败测试，修复为当前导航意图在首次 render 生效，并将同一个结果提供给轨道与页面；用户在同一 URL 上主动修改偏好仍生效。
2. 新的 v2 首屏渲染暴露了身份缓存的 hydration 问题：另一个边界在头像水合前完成配置读取，客户端首字从服务端 M 变为首，触发 React 放弃该边界并重新绘制。`useCoCreatorConfig` 改用固定服务端快照和订阅缓存，补充真实 hydrateRoot 回归；不使用 suppressHydrationWarning 隐藏错误。
3. 本 PR 的演示/首页创建入口使用普通 a，会整页重载并重建客户端。改为 Next Link 的站内导航，保持文档和会话初始化连续。
4. 验收实例是 Next dev。日志记录首页首次编译 24.7 秒，设置页首次编译 8.7 秒；已热页面返回 55–123 毫秒。实际开发版诊断读取脚本解码体积 91,777,129 字节，TTFB 468ms、客户端初始化观察点 1795ms。不能把这些开发态耗时包装成发布版性能，也不能以预热一次声称首次访问已修好。

## 分段取证

- 会话 API 首次 3ms；模板 API 17ms 中位数 / 26ms 最大值。
- 原生工具认证发现 10 次记录：中位数 2303ms / 最大 3354ms。这里是真实 CLI 检查，不属于演示模型等待，也不能改成读取文件后就宣称可用。
- 演示打开至挂载 33ms；九个预置阶段停留 2.6–5.5 秒，实际计时偏差 0–15ms。停留用于阅读与协作节奏，不计为路由卡顿。
- 新增 `[onboarding-performance]`：入口到挂载/检测完成、文档 time origin、各演示阶段 planned/elapsed/late。`?diagnostics=onboarding` 额外记录首次页面资源与初始化观察点。均为本地日志，不记录角色身份、提示词、认证或远端遥测。

## 验证与部署边界

- 经典与新版偏好、导航、保留未发送草稿、文档语言、浮动窗口回归已通过；首屏首次绘制与身份 hydrateRoot 均观察 RED → GREEN。
- 本轮相关首启/shell 37 文件 152 项通过；后续身份与引導定向回归 19 项通过。正式构建及实页最终耗时仍在验证中，不将当前记录当作最终性能验收。
- 继续同一 feature worktree / PR #1519；现有生产、5150 与用户 5152 数据保留。正式性能复验使用独立构建目录；API/Web 的 revision stamps 应对应真实构建，禁止绕过部署一致性保护。
