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

behavior：新增同步状态与界面；data：新私有台账，不迁移或清空现有存储；security：可信检查命令、无 shell 拼接、地址不含凭据、localhost Host/Origin/令牌及长度保护；contract：Git/gh 只读 GitHub与内部 Git；irreversible：仅条件创建候选分支，平台合入由人执行。

未连接真实内网，未验证 CodeHub CLI、真实审批保护/自动关单、实际插件或依赖。支持普通 merge 或候选 fast-forward；平台特有 merge queue 等不同拓扑暂停。LFS/子模块显式阻断。Git tree 一致不等于应用可运行。

公开材料只有通用源码、合同和合成证据。配置、台账、原始日志、会议纪要、人员信息、本机路径和凭据不进入 PR。归档截图 `docs/evidence/repo-sync/shared-issue-git.png` 只含虚构仓库的 SHA 和对象编号。

Architecture cell：外置 repo-sync；Map delta：独立包，不接应用 Host、不迁移核心服务生命周期。当前 checkout 没有 architecture-ownership 检查脚本，计划和 README 记录职责供上游审查。
