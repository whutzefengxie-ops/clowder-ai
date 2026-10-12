---
feature_ids: []
topics: [repo-sync, git]
doc_kind: guide
created: 2026-10-12
tips_exempt: 独立内部 Git 接收工具，不接应用 Host；操作说明随本包入口交付。
---

# 单向 Git 接收工具

外部 GitHub → 内部核心 Git 仓。既有仓库从上次接收的 U0 / 当前内部 I0 登记基线，之后按 main 实际落地范围接收。核心 tree 相同，上游原始对象保留；内部允许初始化衔接和正常接收 merge commit。所有数据保存在操作者指定的私有目录，不写回外部 GitHub。

本包实现真实 Git、持久台账、恢复和 localhost 工作台。内部只使用 Git：Issue/PR 在平台人工创建、审核、合入和核对，界面生成来源模板并登记链接。它不伪造 Git 创建 Issue/PR 的命令，不自动合入、不推 main，也不声称读取了平台审批或关单状态。

## 先体验

需要 Node 24+、Git。项目根目录执行：

```bash
node packages/repo-sync/examples/git-demo.mjs
```

打开 `http://127.0.0.1:5187/`。演示创建独立虚构的来源仓、内仓和台账，但提交、推送、合入、tree 与祖先核验全部执行真实 Git。两笔交付共用 Issue：第一笔接收后记录 open，第二笔完成才确认 closed。平台对象和审批由单独的模拟 PR 页面表示，不能作为真实平台能力证据。演示台账位于 gitignored `.cat-cafe/tmp/`，不清理已有数据。

纯流程原型仍位于 `packages/web/public/prototypes/repo-sync/`，其 5186 页面只执行合成状态模拟；不得把两个入口的证据混用。

## 接入实际仓库

1. 在核心仓之外保存私有 JSON 配置。下列地址、目录与命令都是示例，需要按内部环境设置；不要提交真实配置。

```json
{
  "sourceUrl": "https://github.com/example/core.git",
  "internalUrl": "git@codehub.example:team/core.git",
  "sourceBranch": "main",
  "targetBranch": "main",
  "stateDir": "D:/private/repo-sync-state",
  "commitClosureVerified": false,
  "checks": [{ "command": "node", "args": ["scripts/check-core-and-plugins.mjs"] }]
}
```

2. 使用 Git 自身的凭据管理和 `gh` 已有认证。外部读取仅使用 github.com 的只读 Git/API；不在配置、日志、HTML 中填写 Token、密码或带凭据 URL。`checks` 必须使用可信 executable 与 args，不能通过网页提交 shell 命令。检查在冻结候选的隔离工作目录运行；应覆盖核心、实际构建依赖及独立插件，工具核对检查没有修改核心文件或 HEAD。
3. 在测试项目核对内部平台关单行为：推分支、创建 PR、合入；编号不一致、初始化前旧历史、同号无关 Issue、多个交付共享 Issue。证明不会误关后才将 `commitClosureVerified` 设为 true。此声明来自使用方实测，工具不能仅凭 Git 验证平台行为。
4. 以完整 40 位 SHA 登记上次已经同步的 U0、当前内部 I0。I0 必须等于远端当前目标 HEAD；两者 tree 一致，U0 在上游交付历史中。接管只登记，不改变 main。

```bash
node packages/repo-sync/src/cli.mjs adopt private-config.json <U0> <I0>
node packages/repo-sync/src/cli.mjs serve private-config.json 5187
```

5. 在界面检查上游更新 → 发起下一笔 → 在平台创建/复用 Issue 并登记 → 检查并推候选 → 用模板创建内部 PR、登记具体地址 → 打开 PR 在平台正常审核合入 → 回来核验 Git 结果 → 在平台核对 Issue 状态并保存本笔记录。

GitHub 发现根据 first-parent main 顺序、commit→PR 查询与实际 merge SHA确定范围，区分 squash/rebase 的实际 main 对象。读取关闭关联和完整 Issue timeline，只有能绑定本笔落地 commit 的关闭事件才视为关闭证据；文本提及仅作普通关联。无法唯一归属主干提交、PR 边界不一致或元数据查询失败时暂停。首版不提供评论、附件、账户、里程碑的全量镜像。

## CLI 与恢复

```bash
node packages/repo-sync/src/cli.mjs discover private-config.json
node packages/repo-sync/src/cli.mjs start private-config.json
node packages/repo-sync/src/cli.mjs issue private-config.json <source-node-id> <internal-issue-id> <https-issue-url>
node packages/repo-sync/src/cli.mjs prepare private-config.json
node packages/repo-sync/src/cli.mjs pr private-config.json <https-pr-url>
node packages/repo-sync/src/cli.mjs recover private-config.json
node packages/repo-sync/src/cli.mjs receipts private-config.json observations.json
node packages/repo-sync/src/cli.mjs status private-config.json
```

观察文件为 `[{"sourceId":"来源稳定身份","internalId":"内部编号","state":"open或closed"}]`。它记录人工回读，不向平台发关单请求；映射不一致、应关未关或提前关闭时暂停。当前交付应写记录成功即 COMPLETE，普通关联或等待后续交付的 Issue 可以保持 open。

恢复始终先查 active delivery。候选推送意图先落盘，超时回读同名 ref：相同则复用，不同则暂停。创建候选分支使用空 expected-ref 条件，竞争写入会拒绝；不会覆盖现有分支。合入后核验 tree、原始目标/上一内部版本/冻结候选的可达性，以及实际接受 merge 的 base/head；核验通过才补写双游标。代码接受后元数据失败，仅补记录，不再推送或合入。工具未请求平台合入，因此“平台合入请求超时”需在平台自行查询；Git 工具负责随后对账。

台账用原子替换保存，单写锁覆盖 Git 和状态操作；不按 TTL 自动接管。旧执行器崩溃后，先核对执行器和它的 Git／检查子进程均已退出，再执行 `unlock private-config.json --confirm-no-writers`；仍存活或 PID 复用时拒绝解锁。这个标志是操作者确认，不是程序仅凭父 PID 推断所有子进程已退出。损坏台账直接暂停，不自动建空台账覆盖。当前实现针对进程中断，不承诺跨系统事务或掉电时所有文件系统的持久性。

## 验证与限制

```bash
node --test packages/repo-sync/test/*.test.mjs
```

Git 路径在虚构仓库验证；真实 CodeHub、审批保护、平台自动关单、实际插件及依赖环境仍需使用方接入验证。首版只支持 Git SHA-1 对象，检测到 LFS 声明或子模块则暂停；不把 Git tree 一致说成应用可运行。配置、台账、原始错误输出和内部对象不能发布到外部 PR/Issue；公开材料只包含源代码、通用合同和合成测试结论。
