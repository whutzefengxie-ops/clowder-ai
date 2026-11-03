---
topics: [workspace, pull-request, windows, acceptance]
doc_kind: implementation-plan
created: 2026-11-03
---

# Issue #1809：统一 PR 阅读入口与失败后的操作

来源：[Issue #1809](https://github.com/zts212653/clowder-ai/issues/1809)；本线程用户消息 `0001793698641414-000293-c86bf0b2`。用户要求砚砚与鲸鲸共同讨论，一猫设计、一猫实施，准备 PR 合入 `next`，并做端到端验收。

设计与独立审查/验收：砚砚（codex）；实施与作者验证：鲸鲸（dsh）。主责任 Task `0001793698693722-000297-0faa152f` 留在原线程，不因分工复制托付。

基线：`upstream/next@6c2021d494b7fe0f7a5423868709d4ae99c097ed`。目标仓 `zts212653/clowder-ai`，PR base 为 `next`；个人 fork `whutzefengxie-ops/clowder-ai` 只作为 head carrier。实施前重读远端分支与在飞 PR 文件集。

## 目标、范围与证据

同一 GitHub PR 从聊天引用、作品列表、Workspace 首页及恢复的标签进入，都能按一致的权限契约显示变更；读取失败时，用户能重试或到 GitHub 查看，不面对一块要求选择不存在文件的空面板。

已验证：Windows 安装版非 Git 默认工作区 `project`，同一拥有者会话和同一 PR #1803，`chat-pull-request-changes` 返回 200、7 文件、完整 diff；`pull-request-changes` 返回 503/unavailable。前者保留拥有者校验并允许远程仓库，后者先查本地 `origin`。截图当时的实际请求未抓包，不能把当前复现路径写成截图点击路径的已验证事实。

当前根因条件是 **读取模式绑定 navigationOrigin + 非 Git/仓库不匹配**，代码没有 Windows 专用分支。Windows 是已实测的平台；Linux/macOS 同条件是否复现要由相应执行证据回答，不先贴 Windows-only 标签，也不把 macOS 未执行写成通过。

Architecture cell：Workspace PR reader / workbench navigation。Map delta：none。Why：修正现有读取模式选择并补齐现有错误态，不增加模块、状态仓或用户配置。

## 已定契约

1. `navigationOrigin` 只决定返回位置，不决定 GitHub PR 读取权限或是否要求本地 origin 匹配。聊天、`artifact-list`、`workspace-home-artifact` 均为同一内容阅读。
2. 具有有效 `threadId` 的 PR target 走现有 `/api/workspace/chat-pull-request-changes`。沿用 direct-human 身份和 thread.createdBy 校验，不能为统一入口而放宽 `/pull-request-changes` 的本地仓库校验。
3. 兼容已有 `threadId=null` 的本地 PR target：继续严格的旧读取契约。新 UI 入口缺少合法 thread/worktree 坐标时，不造默认会话、猜工作区、探测多个接口或回落到当前本地 diff；提供已解析 PR 的规范 GitHub URL 或明确不可用。
4. `worktreeId`、target 编码、PR 内容身份、读取预算、敏感路径过滤沿用现有契约。不为本次修复删除注册根校验或迁移持久布局 schema。
5. 同一 target 的成功结果应包含匹配的 repo/PR/root/thread 与 SHA；切 A→B、重试、关闭再恢复仍要拒绝迟到的 A 结果，不把旧 diff 当作 B 的内容。
6. 普通 HTTP(S) 网页继续走外部浏览器；BrowserPanel 继续只接收既有 localhost 预览。此次不扩成通用内嵌浏览器。

实施可在不改变以上契约的前提下简化具体参数。优先移除已经失去用途的 `chatSource` 透传，按 PR target 的会话坐标确定读取模式；不新增协议版本、用户开关或平台判断。

## 实施单元与验证

### 1. 先固定 RED，再统一入口

改动入口：`packages/web/src/components/workbench/F307WorkspaceDestinationOwnerSurface.tsx`、`workspace/useChangesDiff.ts`、`workspace/ChangesPanel.tsx`、`workspace/ChangesPanelV2.tsx` 及对应 tests。

RED 应证明同一有效会话 PR 在作品/首页来源下请求了错误的本地仓库端点；不能只断言生成了 surface。覆盖聊天、作品、首页、恢复后的来源，保留各自返回位置。旧 `threadId=null` 和普通本地 Changes 的请求保持原契约。新调用链不应重试另一个端点掩盖失败。

优先扩展 `workspace/__tests__/useChangesDiff-pr.test.tsx` 和 `workbench/__tests__/F307OwnerSurfaceRenderer.test.tsx`。后端扩展 `packages/api/test/workspace-chat-pull-request.test.ts`，验证非 Git 注册根不触发 git，以及无身份、非拥有者和 agent 不能读取。旧边界在 `workspace-pull-request-changes*.test.ts` 保持通过。

### 2. 补齐同一 PR 面板的失败态

改动：`workspace/PullRequestChangesStatus.tsx`、两个 ChangesPanel，以及已有 shell-copy。沿用现有 header/按钮样式与语义 token，不改布局结构。

失败时显示已有分类原因和可操作的重试、规范 GitHub 链接，保留返回来源。无数据且有错误时，diff 区不再提示“选择文件查看差异”。正常加载、真实空 PR、部分 diff 继续分别表达；刷新期间不泄漏上一目标的错误或 diff。复用已有刷新回调，不建立第二套状态。

### 3. Windows 实际产品路径与真实 GitHub 读取

作者在 feature worktree 自测后，砚砚在最终 exact HEAD 独立验收。未合入代码只在隔离 feature 环境；合入后若做 release acceptance，另用隔离的已合入 checkout。禁止替换当前安装程序、修改 runtime 配置、复用生产 Redis/SQLite/用户历史。

用独立 HOME、数据目录、端口和浏览器 profile，记录源码 SHA、Node/OS、端口/PID、数据目录及启动/停止状态。种子只包含测试拥有者会话、PR 引用和最小作品记录；可以使用现有受支持的测试数据入口，但成功路径不得 mock PR API、gh 输出或浏览器网络响应。

| 条件与操作 | 必须观察的真实结果 |
| --- | --- |
| Windows 非 Git 工作区，从聊天点击 PR，再从作品和首页打开同一 PR | 同一远程读取契约；网络 200；真实文件清单与可读 diff；实际 head SHA 与 GitHub 回读一致 |
| 返回来源、切走再回、页面刷新和关闭后恢复 PR 标签 | 返回到原入口；恢复后仍能读同一 PR；不会变成本地 Changes 或重新要求 origin |
| 有效 Git 工作区的 origin 为 fork，PR 属于上游 | 远程 PR 仍能读取；普通本地 Changes 未受影响 |
| 故意制造一次连接失败，再恢复连接并点击重试 | 可读错误、真实可点击的重试/GitHub 链接；恢复后成功显示；无“选择文件”误导文字 |
| 无身份/非拥有者；快速切换两个 PR | 权限拒绝且无 diff 泄漏；目标标签和内容身份一致，无迟到结果覆盖 |
| 普通外部链接、localhost 预览、classic/v2 展示抽样 | 网页仍外部打开；原预览可用；共享错误态按钮均可操作 |

真实样本可用 PR #1803；执行时记录 GitHub 当前 head/changed_files，不能永久硬编码 7 文件或旧 head。身份/权限故障适合 API 集成测试；网络故障可在浏览器测试中显式注入，但必须与未拦截网络的真实成功旅程分别记账。

Windows 全流程必须有截图、请求状态和断言记录。Linux 的同条件契约测试由 CI 补平台对照；若获得 macOS 实机再补实际旅程，未执行就保留未验证，不让 mocks 冒充实机验收。

### 4. 检查、审查与 next PR

仓库已核实的定向命令（依赖按该工位正常安装；测试文件由作者按新增场景补齐后列入 PR）：

```sh
pnpm --filter @cat-cafe/shared build
pnpm --filter @cat-cafe/web exec vitest run src/components/workspace/__tests__/useChangesDiff-pr.test.tsx src/components/workspace/__tests__/ChangesPanelV2.test.tsx src/components/workbench/__tests__/F307OwnerSurfaceRenderer.test.tsx
pnpm --filter @cat-cafe/api exec node --import tsx --test test/workspace-chat-pull-request.test.ts test/workspace-pull-request-changes.test.ts test/workspace-pull-request-changes-boundaries.test.ts
pnpm exec biome check packages/web/src/components/workbench/F307WorkspaceDestinationOwnerSurface.tsx packages/web/src/components/workspace/useChangesDiff.ts packages/web/src/components/workspace/ChangesPanel.tsx packages/web/src/components/workspace/ChangesPanelV2.tsx packages/web/src/components/workspace/PullRequestChangesStatus.tsx
git diff --check
```

真实 UI 脚本的文件名和命令由作者按最终 harness 填实，必须能从 PR 描述定位并复跑；不要只写“E2E passed”。现有 browser harness 可复用，不为本次任务另造一套服务管理器。若测试依赖编译 API，则运行该工位 `pnpm --filter @cat-cafe/api build`，记录环境/基线失败，不在生产运行测试。

作者提交 PR 到 `next`，附 RED/GREEN、真实 Windows E2E、平台限制、最终 HEAD 和检查结果。砚砚独立审查作者代码与验收证据；变更后按新 HEAD 重核。合并依赖当前 GitHub 保护规则和非作者审批，不能把聊天里的 review 当作 GitHub 正式 Approve。当前任务持续跟踪，只有真实合入才记录 merge SHA。

## 代价、回滚与范围止点

不增加常驻进程、运行时依赖、用户设置或正常操作的等待/审批。用户只在 PR 原有面板多获得必要的失败后操作；开发成本为一组入口/错误态回归和一套隔离 Windows 真实旅程，换来已复现的安装版可用性。

回滚为撤销本次 PR 的代码提交；没有数据迁移、TTL 变更或生产数据写入。PR 浏览器与安装版 build revision 为 null 是独立问题，本次不顺手修复。若发现其他打开路径问题，记录具体反例后判断是否同根因，不扩成全仓链接重构。
