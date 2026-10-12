---
feature_ids: []
topics: [repo-sync, validation, recovery]
doc_kind: note
created: 2026-10-12
---

# 作者验证记录

来源：Issue #1582 新版合同、维护者回复、用户确认“一个 PR 完整交付，内部先按 Git 路径”。原型与执行器均在同一 feature 分支。此记录是作者自检，不代表独立代码审查或真实内部平台验收。

## 合同覆盖

| 合同 | 实现与证据 |
| --- | --- |
| U1 完成但共享 Issue 保持 open，U2 才 closed | 原型场景、真实 Git 两笔旅程、接收条件单测 |
| 合入后未保存游标先恢复原交付 | 重建 Receiver 后查询 main；同一 delivery、Issue/PR、冻结候选继续 |
| 源对象保留、两侧 main SHA 可不同 | 独立快照与 U0 衔接、U1/U2；tree、来源/上一内部版本/候选祖先与 base/head 核验 |
| 候选可恢复且不覆盖竞争写入 | 私有 ref 固定候选；空 expected-ref 条件创建；不同 SHA 拒绝 |
| 推送发生但回执未保存／推送未发生 | 先回读 ref，相同复用；不存在时重试原候选，不陷入查询循环 |
| 代码已接受但元数据失败 | 保留游标和 active delivery，仅补记录；缺少/错误映射、提前关单、应关未关暂停 |
| 台账与并发 | 原子替换、绑定与必要字段检查、损坏台账暂停、单写锁、所有写入进程退出后才可显式解锁 |
| 来源发现 | main 顺序而非 PR 时间；实际 merge SHA 与边界；rebase 连续范围；不明确来源暂停；ClosedEvent 证明关单 |
| 界面 | 大步骤与子步骤、× 与错误码、具体 PR/Issue 页面、逐笔审计与 commit 对应、桌面/手机 |

## 已运行

- `node --test packages/repo-sync/test/*.test.mjs`：17 项通过，包含真实虚构 Git 仓的接管、连续接收、重启恢复、图重写拒绝、分支竞争保护。
- `node --test packages/web/public/prototypes/repo-sync/*.test.mjs`：45 项通过。
- Git 工作台 `test/browser-check.mjs`：两笔完整旅程通过。平台模拟合入执行真实 Git，随后恢复游标；U1 open、U2 closed；应关未关显示 ×；无页面 JS 错误。
- 原型 7 条浏览器旅程：旧 6 条配置/接管/审计/响应式/异常旅程，加共享 Issue/合入中断旅程均通过。既有旅程验证 1440/1024/768/390 屏宽。
- Biome 检查通过；所有文件低于 350 行，少量超过 200 行警告线。
- 只读真实 GitHub 探测：公开 main commit 对应 PR 与实际 merge SHA、关闭关联查询、Issue ClosedEvent 查询契约可用。后两次样本为空列表，只证明查询可执行，不宣称覆盖全部真实关闭行为。
- 私有 ref 补充检查：同一 U1/U2 旅程通过，候选 SHA 与 delivery ref 一致。
- capability-tips 定向检查通过，保留仓库原有的 17 条引用警告。

Fallback 机械扫描以 `upstream/main` 为基线：net +167，26 个文件达到逐文件阈值。逐项核对后，命中主要是布尔条件、可选演示参数、初次安装默认值和显式错误处理；真实台账损坏、来源不明、图核验失败均暂停，没有改为默认成功。界面从同一 active delivery/接受游标投影，没有增加并行进度游标；库与 HTTP 层错误标签不同，但没有通过下一条写路径绕过失败。

## RED 与检查修正

共享 Issue 原先会在 U1 关闭，合入中断场景原先缺失；行为测试先失败，修复后通过。分支竞争测试发现普通推送可能更新同名 ref，条件创建后拒绝；未发生推送时原先停留在结果不明，修复后可重试；有效 JSON 缺少游标原先被读入，修复后拒绝且保留原文件。

Windows 沙盒阻止 Git for Windows 的 sh 与 localhost 连接，改在授权的独立测试环境运行。浏览器检查曾漏填模拟平台必填备注，并在新增嵌套详情后使用不唯一的 summary 定位；修正后通过。探测命令的 `--input` 不能配 `--paginate`；实现采用 `-f/-F` 分页，真实回读通过。

## 风险与边界

首次上游 CI：Lint 发现原型 4 个压缩 CSS 未格式化。已按仓库 Biome 规则格式化，将长样式按原顺序拆为职责独立的样式表；拆分前后规则拼接逐字一致，并补静态资源白名单，文件均低于 350 行。Windows 失败位于未改动的 `opencode-model-id-request.test.js` 临时目录清理 `rmSync`，EPERM；对应测试与工作流同上游基线，未与本功能混改，另行复跑核对。

behavior：新增同步状态与界面；data：新私有台账，不迁移或清空现有存储；security：可信检查命令、无 shell 拼接、地址不含凭据、localhost Host/Origin/令牌及长度保护；contract：Git/gh 只读 GitHub与内部 Git；irreversible：仅条件创建候选分支，平台合入由人执行。

未连接真实内网，未验证 CodeHub CLI、真实审批保护/自动关单、实际插件或依赖。支持普通 merge 或候选 fast-forward；平台特有 merge queue 等不同拓扑暂停。LFS/子模块显式阻断。Git tree 一致不等于应用可运行。

公开材料只有通用源码、合同和合成证据。配置、台账、原始日志、会议纪要、人员信息、本机路径和凭据不进入 PR。归档截图 `docs/evidence/repo-sync/shared-issue-git.png` 只含虚构仓库的 SHA 和对象编号。

Architecture cell：外置 repo-sync；Map delta：独立包，不接应用 Host、不迁移核心服务生命周期。当前 checkout 没有 architecture-ownership 检查脚本，计划和 README 记录职责供上游审查。

## 双模式增量验证（2026-10-12）

对照用户确认的两类仓库：continuous 的逐 PR / Issue 接收合同保持；version 增加按 tag 的单次内容升级，允许声明的内部文件差异。仍在原 feature worktree / PR #1586，独立运行，不接应用 Host 或生产仓。

新增版本测试最初在真实 Git 基线登记处失败（BASELINE_MISMATCH），证明旧实现拒绝内部 README 和目录差异；实现后绿色。最终 `node --test packages/repo-sync/test/*.test.mjs` 为 29/29 通过，包含原模式的全部回归。

- 内部独立快照接管、目录和整个文件保留、README 非重叠修改自动合并；一个版本只产生一个内部内容更新候选 / PR，无 Issue 映射，不重放上游 Fixes 消息。
- 连续 v2 / v3 接收，允许路径中的内部后续提交核验，tag 对象和 commit 冻结，回退、tag 在检查期间及合入后移动均阻断。
- 文本冲突路径 ×、重启保留原交付、非法路径请求不丢失原冲突、人工合并后复用交付身份；二进制冲突通过一侧选择保持准确 blob SHA。
- 上游新增内部目录同名路径明确阻断；未声明核心变化拒绝接管，交付中未知 main 提交不推进游标。
- 检查失败不推送；推送成功但回执中断时回读复用同一分支；实际合入 tree 被修改则不接受。已发布候选不允许撤销，未发布撤销保留审计并重新分配交付身份。
- 模式 / 路径规则持久化和绑定校验；危险、重叠或通配路径拒绝，已启用绑定不能切换模式或偷偷更换规则。

浏览器执行 `test/browser-check.mjs` 与 `test/version-browser-check.mjs`：原模式两笔接收旅程、版本自动合并完整旅程、版本冲突人工解决完整旅程，共 3 条旅程通过。覆盖设置选择与保存、tag 选择、候选分支、具体 PR 页面、真实 Git 平台模拟合入、版本登记及 390px 移动端（无横向溢出、失败子步骤 ×）。截图全部来源于虚构仓和平台编号。

验证发现并修复三项具体问题：Windows MAX_PATH 导致长标签 ref 无法创建（缩短对象目录与本地 ref，完整绑定仍以 SHA 和 owner marker 校验）；裸仓 update-index 删除条目要求工作树（显式指向工具私有索引工作目录）；快速保存配置后填写基线可能被刷新覆盖（提交期间禁用表单控件，显示完成确认，浏览器检查消费该确认）。

Biome `check packages/repo-sync` 检查 48 个文件，零错误 / 警告；`git diff --check` 通过，新增与修改源码均低于 350 行硬限。新增 Git 合同 CI 在 Windows / Ubuntu 使用 Node 24 运行所有真实 Git 用例；远端结果以 PR 当前 HEAD 的检查为准。

版本模式仅核验已检查候选和正常平台 merge / fast-forward；不读取平台审批结果，不自动合入。标签必须可从配置的来源分支历史证明，非连续版本暂停。真实内网、实际插件 / 构建及平台审批仍需使用方验证。源码、通用文档与合成截图公开；私有配置、台账、真实文本、Git 原始错误和内网资料不公开。作者验证不是独立审查或合入批准，PR 保持待维护者审查。
