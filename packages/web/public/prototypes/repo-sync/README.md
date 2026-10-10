---
feature_ids: []
topics: [repository-sync, prototype, journey]
doc_kind: demo-contract
created: 2026-10-10
tips_exempt: 独立交互原型，尚未挂载正式功能或能力目录。
---

# 单向交付接收：交互原型

依据：上游 Issue #1582 的 v2 讨论；指定上游版本初始化，内部只接受外部交付，核心文件树一致，允许初始化与接收合并提交，两侧 main SHA 不必相同。

- demo_kind: journey_validation
- delivery_lane: internal_product_gate
- 主判断：用户能否直接辨认是否最新、版本对应关系、未合入 PR 与当前卡点，并在等待／失败后继续同一笔交付。
- visual_source_of_truth: packages/web/src/app/theme-tokens.css、console-tokens.css；components/settings/SettingsShellV2.tsx 的 232px 导航、工作面及细分隔线。
- native_elements: 直接加载当前 worktree 的原生主题 token，沿用设置功能页的导航／工作面结构。
- surface: 单功能原型；独立预览，不声称已挂载真实应用 Host，也不替代产品主壳。
- stylized_elements: 仅流程图、版本桥和演示控制；演示控制可以隐藏。
- truth_label: 全部仓库、SHA、Issue、PR、命令结果都是合成数据；实际 Git、平台 CLI、网络及后端未接入。

界面分层：接受版本总览 → 活动交付流程 → 来源／内部对象映射 → 等待或阻塞原因 → 执行记录。是否最新比较 acceptedUpstream 与 latestUpstream，不比较内部 main SHA；代码最新但元数据未补齐仍显示未完成。

| 动作 | 状态后果 | 证据 |
| --- | --- | --- |
| 同步下一笔 | 冻结目标并准备候选，内部 main 不变化 | state.test.mjs / browser-check.cjs |
| 继续执行 | 创建模拟 Issue、分支、PR，逐步推进 | 相同交付 ID／对象 ID |
| 打开内部 PR | 跳到具体 PR 模拟地址，本动作不代表审批和合入 | browser-check.cjs 的 popup URL 与 main 不变断言 |
| 平台模拟合入 | 在独立 PR 页写备注，同步总览回读结果 | fixture 外 sentinel、跨页通知与刷新恢复 |
| 合入后自动核验 | main 已变化，但核验通过前不推进接受游标 | state.test.mjs |
| 自动核对 Issue 状态 | 普通关联不关闭；核对有关闭义务的正确映射 | phaseDetails / 独立流程节点 |
| 核对创建超时 | 复用已存在 PR，不重复建单 | ID 前后相同 |
| 插件修复后重跑 | 检查恢复，main 仍待审批 | 插件失败场景 |
| 补齐 Issue 状态 | 不重复合入，完成元数据 | 代码最新但关单待补齐场景 |
| 外部新增交付 | latestUpstream 前进，冻结目标不变 | 并发新交付场景 |

原型使用 localStorage 保存合成操作、审批备注及场景；不保存凭据。重置仅覆盖此原型合成状态，不连接生产数据。

职责：人工只在内部平台按正常流程审核／合入 PR。准备、比对、映射、模板文档、检查、结果读取与完成登记由程序执行，不依赖 Agent。Agent 可选辅助生成可读变更说明或解释失败，不能替代版本核验、关闭依据和审批。当前没有接入模型。

九步流程将“合入后核验”和“Issue 状态核对”分开。正式系统由事件／轮询自动推进，用户无需点击验收；原型在演示控制条提供模拟结果按钮。PR 地址 `/internal/demo/core/pull/<id>` 是本地模拟，不是实际内部平台；落地时使用适配器返回的真实 URL。

命令展示中的 Git 命令表示 Git 传输；Issue／PR 使用 `repo-sync` 适配器占位命令，明确未实现。标准 Git 本身不提供创建 Issue／PR 的接口。

界面 commit ID 为合成的短 SHA。首次独立快照接收在候选分支连接初始化历史，再合入目标上游版本；普通接收不重复连接。界面搬运阶段包含候选对象与内部分支推送，不表示直接推送上游 head 替换内部 main。

运行：`node packages/web/public/prototypes/repo-sync/server.mjs`，默认只绑定 127.0.0.1:5186。服务只提供原型文件与指定主题 CSS，不暴露整个仓库。

单元验证：`node --test packages/web/public/prototypes/repo-sync/state.test.mjs`。
浏览器旅程：`node packages/web/public/prototypes/repo-sync/browser-check.cjs`；使用可用 Playwright 和安装的 Chrome，产物落入系统临时目录。

声明边界：真实网络方向、Git 对象、平台审批与自动关闭需独立实现和验证；此原型证明 UI 状态与用户动作的因果，不证明生产同步能力。
