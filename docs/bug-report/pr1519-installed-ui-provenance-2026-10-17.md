---
feature_ids: [F155, F229, F320]
topics: [onboarding, desktop, git-provenance, shell-presentation]
doc_kind: bug-report
created: 2026-10-17
---

# PR #1519：安装界面与提交来源核对

## 用户报告与当前结论

用户在 `http://localhost:5342/` 看到的界面与之前基于新版 UI 验证的 PR #1519 不同，并怀疑历史提交 `c00ffa0c`（`chore: sync fork with upstream through #1267`）错误覆盖了代码。

本次核验没有发现该提交回退 Web 界面的证据。它的**整棵 Git 文件树与其上游父提交完全相同**。实际安装页面加载本轮 PR 构建，但在不带 `shell` 参数、没有新版界面偏好的新 origin 中显示 `classic`。同一个构建在另一个实例中选择 `v2` 后，可以显示新版主界面、自动协作演示和一键配置入口。

这只解释已经观察到的经典/新版差异，不能代替对用户指出的其他页面、成员显示和交互问题逐项验收。尚未收到用户对新版对照页的确认，不能把全部界面问题标记为解决。

## Git 历史核验

| 提交 | 时间 | 父提交 / 作用 | 核验结果 |
| --- | --- | --- | --- |
| `c00ffa0c7297f4ad4aee56348ef0ed0b31acbcdf` | 2026-08-04 | 合并 fork 的 `80782c58b` 与上游 `041190ca7`（#1267） | tree 为 `374b47aff8a38fb16aa190266e251de36133527a`，与第二父提交完全相同；不是本轮新建提交 |
| `2374ca5c7` | 2026-09-10 | 将上游 `6b6fbbaa8` 合入 fork | tree 为 `767ad0f2a63b85728fe701d3beb60f8b37f6e8a0`，也与第二父提交完全相同 |
| `361a57ccd` | 2026-09-22 | 首次 onboarding 功能提交，父提交为 `2374ca5c7` | PR #1519 在当天创建；前两条同步提交是分支继承的 fork 历史 |
| `a18ba5184` | 2026-10-16 | 本轮合并最新 `upstream/main` | 合入的上游为 `814f63bddbed2e3aa835b0bb5da612b89c266e67` |
| `197867241ae89c45ba33990189cae016d02c26a5` | 2026-10-17 | 生产 API/Web 构建输入 | 安装文件 stamp、页面公开 revision、原构建输出一致 |
| `bc056a20157192a89134bad561b924af7ca2fe2b` | 2026-10-17 | 包装与桌面版本调整至 1.14.0 | 相对 runtime 构建没有 packages/scripts 源码差异 |

现场命令：

```powershell
git rev-parse 'c00ffa0c^{tree}' 'c00ffa0c^2^{tree}'
git diff c00ffa0c^2 c00ffa0c --quiet
git rev-parse '2374ca5c7^{tree}' '2374ca5c7^2^{tree}'
git merge-base upstream/main HEAD
git merge-base --is-ancestor upstream/main HEAD
```

`c00ffa0c` 不在当前上游主线的祖先中，因此被 GitHub 列在 PR 的 fork 独有提交中；这与当前文件是否保留旧代码是两件事。PR 创建早于本轮排查，不是本轮把 HEAD 切回 8 月。该提交在第一父提交上表现为 13 个文件变化，涉及测试基线、调用跟踪及 Windows 启动脚本，没有 Web 文件；在第二父提交上**没有任何文件差异**。

未找到当日保留的本地会话中针对该 SHA 的操作记录，因此不臆测当时人的动机；Git 与 GitHub 记录能证明它执行了 fork 同步，不能证明它是本次用户报告的回归原因。

已创建保护引用 `backup/pr1519-before-provenance-audit-20261017` 指向核验开始时的 `bc056a201`。未执行 reset、revert、rebase 或强制推送。

## 当前安装内容与最新 main

工作树为 `G:\AIwork\clowder-ai\worktrees\feat-onboarding-first-run`，分支为 `feat/onboarding-first-run`。重新 fetch 后，上游 main 与 GitHub PR base 均为 `814f63bdd...`；它是当前 PR HEAD 的祖先。

最新 main 以下新版界面生产文件与当前分支逐字一致：

- `packages/web/src/components/shell/WorldRail.tsx`
- `packages/web/src/components/ChatContainerHeader.tsx`
- `packages/web/src/components/ThreadSidebar/ThreadSidebarV2Header.tsx`
- `packages/web/src/app/shell-v2.css`

与上游的主要相关净差异是本 PR 的引导、成员配置、配置诊断、历史工具输入修复以及呈现偏好首屏解析保护；不能仅根据提交列表中的旧日期判断安装载体。

安装版 `5342` 的 Web 进程实际入口位于本轮 `clean-install/app`，API 连接 `3342`。页面 DOM 公开值为：

```json
{
  "revision": "197867241ae89c45ba33990189cae016d02c26a5",
  "apiOrigin": "http://localhost:3342",
  "shell": null
}
```

`shell: null` 表示未挂新版 `data-shell="v2"`，并非缺少该新版代码。安装目录的 API/Web `.build-commit` 都是上述 revision；安装版的 `BUILD_ID`、Next CSS、`public/vendor/app/shell-v2.css` 与本轮真实构建输出 SHA-256 相同，HTTP CSS 请求成功。

## 已确认的界面模式差异

`shell-presentation.ts` 在本 PR 与最新 main 中都遵循同一默认值：浏览器未保存 `cat-cafe:shell-presentation` 时回退 `classic`。偏好按 origin 保存，旧端口或旧 Electron profile 的 `v2` 选择不会自动进入新隔离实例。此前不少验收地址显式使用 `?shell=v2`；本轮 `5342/` 没有该参数。

不能用全局强制 `v2` 修补验收差异，因为用户此前明确要求保留经典版用户的界面选择，创建成员不能暗中切换界面。

本次在**另一个作者空实例**运行同一构建，以显式 `?shell=v2&lang=zh` 验证新版主界面；未改动用户正在操作的 `5342` 的界面偏好、成员或历史：

| 页面 | API / Redis | 实际 revision | 呈现 |
| --- | --- | --- | --- |
| `http://localhost:5342/` | 3342 / 6342 | `197867241...` | classic |
| `http://localhost:5362/?shell=v2&lang=zh` | 3362 / 6362 | `197867241...` | v2 |

新版实际显示“我的 Café”、新版首页与输入区域、自动播放的 mock A2A 演示、右侧渐进成果和创建成员入口。对照截图属于**已安装 Web 资源在内置浏览器中的渲染**，不是原生 Electron 窗口截图。原生窗口启动来自独立日志证据。

![同一安装构建显式选择 v2 后的新版首页](pr1519-ui-provenance/same-build-v2.png)

## 1.14.0 载体与实际安装验证

安装包为 `ClowderAI-Setup-1.14.0-pr1519-bc056a201-Isolated.exe`，包装源码为 `bc056a201...`，runtime 构建为 `197867241...`；二者 runtime 源码差异为空，没有改写已有构建 stamp。

- 大小：699085514 bytes。
- SHA-256：`6ADDC388FEBDEBF3F736F4B0CCF34604A79D1A01070026262BF200D60758D5BB`。
- 新编译 Electron EXE 的 `FileVersion` 为 1.14.0，ASAR 内 `package.json` 为 1.14.0。
- 新目录 `clean-version-b/app` 与 `instance` 首装前均不存在；未补入认证、角色或历史。真实安装 exit 0，耗时 **212835 ms**。
- 首次真正的 Electron 进程 `16600` 启动到 `renderer-visible` 为 **42960 ms**；API 健康与 Web 页面均可访问。
- 启动日志确认 `Checking for updates (current: 1.14.0, manual: false)`。该次原生更新网络请求记录 `Release fetch failed`，不能把网络失败当成在线更新检查通过。
- 另通过 GitHub API 读取实际 release 列表，将相同输入交给产品 `selectUpdateTarget`：1.14.0 的结果为 null。实际列表最新 tag 为 `v0.13.0`。测试版本未发布为正式 Release。
- 更新检查与外部 Node 入口回归共 36 项通过；版本字段没有增加行为分支。

首装此前另一候选测得 58655 ms，本轮 212835 ms；本轮依赖归档 verify 阶段约 95 秒。因此安装耗时**仍有明显波动，不能宣称稳定加速已经闭环**。首次启动约 40–43 秒也不是完整冷盘基准。

## 真实调用与数据边界

在此前用户明确授权的 `clean-install/instance/home` 中，只补缺失的 Pi 认证与连接文件。通过真实页面一键创建单个 Pi 伙伴后，发送“请只回复‘42’，不要调用工具”，实际回复 42，API 历史回读为 completed。该证据来自本轮先前的 0.10.1 桌面壳候选，其 API/Web 与 1.14.0 包内容连续；不能称为 1.14.0 原生 GUI 的真实调用。

用户随后在 5342 主动操作该环境，因此没有为本次版本核对停机或覆盖其安装，也不把操作期间的角色变化归因于安装器。新 `clean-version-b` 只验证无认证首装、启动与引导，不擅自复用仅授权给旧目标的 Pi 凭据。

交付默认目录 `clean-user` 尚未创建，保留为用户真正的零角色、零会话起点。安装器的独立 AppId、目录、数据根、端口与 `UsePreviousAppDir=no` 等设置阻止沿用作者验收目录；不改原生产实例。

## 剩余验收

1. 用户指出的其他界面差异需要绑定具体页面与预期，不能以经典/新版差异概括所有问题。
2. 不清除历史提交来掩盖问题；若发现错误冲突处理，按当前文件的具体净差异修复，并保留原审查锚点。
3. 安装稳定耗时、原生解压窗口拖动、新布局升级/中断恢复，以及原 issue 合同中的其他平台与客户端余项仍须分别验证；本报告不构成整项完成或独立审查通过。

原始证据保存在本轮 `artifacts/pr1519-verified-build-20261016` 外部证据目录：`package-receipt.json`、`pr-commits-provenance.json`、`clean-version-b/install.log`、`clean-version-b/install-receipt.json`、两实例的 startup/main 日志、`release-feed.json` 及浏览器截图。报告不包含认证内容或用户私有配置正文。
