---
feature_ids: []
topics: [repository-sync, prototype, verification]
doc_kind: validation-report
created: 2026-10-10
tips_exempt: 独立原型验证记录，尚未挂载正式功能。
---

# 交互原型验证记录

本次交付是用户请求的高保真可交互原型，不是生产同步系统完成声明，也没有提交正式产品合入 PR。

原始需求：看到是否最新、两侧 commit ID、未合入的内部 PR、卡点与流程进展；在 feature worktree 实现。
技术依据：已接受的单向接收 v2 方案与上游 Issue #1582 讨论。
分支：`feat/repo-sync-prototype`；worktree：`worktrees/feat-repo-sync-prototype`。
预览：`http://127.0.0.1:5186`，仅绑定本机，与此 worktree 的 `server.mjs` 一致。

| 要求 | 实物与验证 |
| --- | --- |
| 判断是否最新 | 比较已接受上游版本与外部最新版本；main SHA 不同仍可最新 |
| 查看版本对应 | 总览三个版本卡；映射页来源提交、内部初始化与合并节点 |
| 未合入 PR 与卡点 | 主状态、待合入数量、当前对象、九步流程与恢复入口 |
| 正常审批路径 | 具体 PR URL 跳转；点击链接不改 main；平台合入后回读、核验、核对 Issue |
| 仓库与分支配置 | 可填写 GitHub / 内部 Git 地址、来源 / 目标分支、网页地址、认证配置引用、平台 CLI 与起始版本 |
| 配置状态因果 | 修改后重查；保存后等待初始化；初始化前不能同步；活动交付禁止替换绑定 |
| 绑定与页面隔离 | PR URL 携带绑定 ID；旧绑定页面不能操作新交付；旧合成映射与记录保留在 archives |
| 新交付不影响活动交付 | 外部更新进入队列，冻结目标保持不变 |
| 异常恢复 | 创建超时复用 PR；插件失败后重跑；核心偏移暂停；关单补齐不重复合入 |
| 真实用户输入 | 自定义中文 sentinel 备注进入日志，刷新后仍保留 |
| 命令使用边界 | Git 处理提交与分支，Issue／PR 标注平台适配器占位命令 |
| 响应式与键盘 | 1440／1024／768／390 宽无横向溢出；原生对话框 Escape 关闭 |

本轮命令及结果：

- `node --test packages/web/public/prototypes/repo-sync/state.test.mjs packages/web/public/prototypes/repo-sync/binding.test.mjs`：13 项通过，0 失败。配置相关测试先红后绿；覆盖地址凭据拒绝、检查后修改、未完成交付保护、快照 / 保留历史初始化以及初始化前不能同步。
- `node packages/web/public/prototypes/repo-sync/browser-check.cjs`：完整旅程通过，页面异常和 HTTP 错误均为 0；截图写入系统临时目录 `repo-sync-prototype-evidence`。
- `node packages/web/public/prototypes/repo-sync/binding-browser-check.cjs`：配置旅程通过。使用 fixture 外的仓库地址、release/2、delivery-main、完整 40 位 commit ID 与认证配置引用；验证总览 / 映射 / PR 页面反映自定义配置、刷新保留、编辑后检查失效及活动绑定保护。页面异常 / HTTP 错误均为 0，四种屏宽无横向溢出。截图位于系统临时目录 `repo-sync-binding-evidence`。
- 项目安装的 Biome 2.4.1 对 17 个 JS 模块执行 `check`：通过，无警告；4 个 HTML／CSS 执行关闭格式化的语法与 lint 检查：通过，无警告。CSS 保留紧凑声明以遵守文件行数硬限。
- `git diff --check`／暂存差异检查：通过。所有原型文件低于 350 行硬限；CSS 214 行超过 200 行提示线，仍低于硬限。
- `node scripts/check-capability-tips.mjs --changed-file packages/web/public/prototypes/repo-sync/README.md`：通过，另有 17 个原有目录引用警告。
- 不限定改动范围的 capability-tips 检查：20 个问题，均指向本分支基线已有的 Feature 文档，不涉及原型文件。未将其宣称为全仓通过。
- `node scripts/check-fallback-layers.mjs --base main`：执行成功，触发机械计数提示。核对后分别为输入／展示默认值、场景布尔判定、独立的本地存储与剪贴板异常处理；没有用多层兜底吞掉同步失败或自动覆盖基线。活动交付、版本与对象仍以单一状态对象为依据，不另建补偿状态源。

实际体验核对：原生主题 token、232px 功能导航、流程节点与操作结果相匹配；查看桌面、手机与映射截图。没有为此原型使用新的产品主壳。

Architecture cell：独立原型工作面，不新增生产同步服务或产品接口；Map delta：none。当前检出的仓库没有 skill 所列的 `check:architecture-ownership` 脚本，记录为缺失，不声称已运行该检查。

隔离范围：无真实 Git 执行、平台创建、凭据、Redis 或生产端口访问。所有操作仅修改本原型 localStorage 的合成状态。Git／平台、自动关单和受保护分支的真实能力仍需生产实现阶段验证。

运行说明：pnpm 启动包装在当前环境尝试下载不可达依赖；项目预览启动器在 Windows 无法记录进程身份。当前使用直接 Node 静态服务，不能承诺启动器托管或跨会话守护；需要重启时按 README 的 Node 命令运行。

状态：作者自检通过；未进行独立代码审查、未推送或合入 main。

本次交接调整：移除同步页审批弹窗；具体 PR 页模拟平台操作，并按 deliveryId 隔离审核记录。合入后核验、Issue 核对均标注程序自动，结果触发按钮仅在演示控制条。重新验证跨页通知、接受游标时机、顺序交付、刷新恢复及四种屏宽。

仓库配置扩展：预览服务白名单新增配置模块与样式；仍只监听本机，不提供仓库访问代理。输入格式校验是真实执行的；连接 / 权限 / 分支存在性 / 祖先关系 / 树一致性仅展示待接入检查项，初始化结果明确为模拟。内置短 SHA 与用户填写完整 SHA 分别保留，展示简写不会修改数据或复制值。作者自检并不代替独立审查。
