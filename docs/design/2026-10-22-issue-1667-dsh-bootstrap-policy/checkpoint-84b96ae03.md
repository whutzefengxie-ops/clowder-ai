---
feature_ids: []
topics: [windows, acp, dsh, bootstrap, security, issue1667, pr1669]
doc_kind: implementation-checkpoint
created: 2026-10-22
reviewer: codex
reviewer_model: gpt-6.1-sol
reviewed_head: 84b96ae03464673777963017616a401eb23b1500
status: incomplete
tips_exempt: 局部修复确认与续办，原授权不变，不新增等待门禁
---

# 检查点 84b96ae03：三个具体反例已修，W2 全流程尚未完成

本地和 GitHub PR #1669 起审时均确认 `84b96ae03464673777963017616a401eb23b1500`，PR 仍为 OPEN。可以继续池生命周期、F4、W4/W6 及 W2 剩余工作，无需再请求批准。这是局部反例关闭，整项仍未验收。

## 上一检查点三条反例的复验

1. **reader 的内部引用已隔离。** 单独用例在明确 mock 目录准入的条件下运行真实 store/matcher，先以正常 argv 匹配成功，再分别修改 `getPolicy()` 和 `getActivePolicies()` 返回的嵌套对象；内部记录保持 acp，额外 `--patch` 被拒绝。这证明 reader/argv 行为，不冒充原生目录成功准入。
2. **Everyone FullControl 已拒绝。** Windows 原生 fixture 的目录 owner 设为当前 token SID，protected DACL 内明确加入 Everyone FullControl，通过 icacls 保存的 SDDL 确认 WD/FA ACE。实际 loader 返回空，并明确拒绝于 `unsafe Allow ACL`，不是被另一个前置错误偶然拦截。
3. **既有继承 ACL 不再自动改权。** 原生 fixture 确认目录启用继承后，实际 writer 返回 `protected private DACL` 拒绝；调用前后保存的完整 DACL descriptor 相同。该具体自动修权反例已关闭。

原生 fixture 的 manifest 由真实 writer 在单独子进程中生成，该子进程只为准备有效内容而 mock 目录准入；实际拒绝测试没有 mock 验证器。因为提升权限的创建者可能使新目录 owner 为 Administrators，fixture 明确设置当前 token SID，以确保测试达到目标 ACE/DACL 分支。所有这些权限变更都只发生于 runner 新建的临时 HOME。

## P1：首次使用缺失父目录的创建路径未接好

真实首次使用 probe 确认 `HOME/.clowder-ai` 不存在，然后调用 `persistPolicies()`。实现传入 `ensureWindowsAcpBootstrapDirectories(storagePath, storagePath, ...)`，其中 storagePath 是 `HOME/.clowder-ai/acp-policies`。

这个 helper 的契约是 immediate parent 已存在；它对不存在的 `.clowder-ai` 执行 GetAttributes，首次导入返回创建失败。此 probe 已实际复现，错误引用的正是不存在的父目录。

需要把受控根与策略子目录的创建关系接正确，安全创建必要父目录或选择已支持的受保护持久根，覆盖首次使用。不能先 mkdir 普通目录后改权限，也不能自动修复既有不可信对象。不要把两个相同 leaf 参数的 helper 调用当成任意层级目录 provisioning。

本机 Temp 祖先可能还会被正确拒绝；probe 不要求在不可信 Temp 下必须授权。测试专门断言不能因未准备 immediate parent 而先解引用不存在的路径。修好此关系后仍应验证真正的信任条件，不能放宽权限检查来得到成功。

## P1：目录 helper 尚未覆盖策略文件本身的信任

当前验证器只对目录执行原生校验，随后 manifest 直接 `readFileSync`，tmp/backup 继续按路径写入/rename。没有 manifest/tmp/backup 自身的 file owner/DACL、reparse/物理身份及重开/替换验证；这仍是此前 W2 存储边界的开放项。目录可信不能直接替代既有文件可信。

本轮没有原生文件攻击 fixture，不把这项静态缺口当成已运行的 exploit 或通过项。应在完整受控导入路径补齐，并以受保护存储完成导入→独立进程重载→撤销→再重载的成功对照，再覆盖异常与中断。独立维护进程的授权变更如何到达既有 host 仍需验证。

## 独立运行证据与限度

当前源码从 git show 固定上述 SHA，包含真实目录 helper 的快照；只重写模块 URL，并用 Node 去除 TypeScript 类型。

- reader 单测：**1 test，1 pass，exit 0**，明确 mock 目录准入。
- 原生存储 probe：**3 tests，2 pass，1 fail，exit 1**；两项 PASS 是上面的原生 ACL 拒绝与 descriptor 不变；FAIL 为首次缺失父目录。
- 合计 **4 项，3 通过、1 失败**，没有取消或跳过；不与前几个检查点累计伪造覆盖率。

```powershell
node .tmp/review-pr1669-84b96ae03/prepare-checkpoint.mjs
node packages/api/scripts/with-test-home.mjs node --experimental-test-module-mocks --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-84b96ae03/reader-unit.test.mjs
node packages/api/scripts/with-test-home.mjs node --test G:/AIwork/clowder-ai/worktrees/feat-issue-1667-dsh-bootstrap-policy/.tmp/review-pr1669-84b96ae03/native-storage.test.mjs
```

材料在 `.tmp/review-pr1669-84b96ae03/`；reader 终态为 `reader-unit.log`，最终原生 probe 为 `native-storage-specific.log`。首次原生 fixture 先被 Administrators owner 拦截，修正测试 owner 后重新运行并确认目标 ACL 分支；不能把前置错误当成 Everyone 拒绝的证明。

未访问真实 HOME 策略库、历史、账号或生产 Redis；未改实际用户/runtime ACL；未启动真实 DSH。本轮未重跑完整 build，也未取得真实普通用户/内网机器成功使用证据。构建与基础单测 claim 不能替代完整 W2 操作验收。

## 继续原范围

本轮三个具体修复可以从开放反例中移除。W2 上述创建、文件信任和实际受控导入/跨进程操作仍须完成；此前未改动的池生命周期、F4、W4/W6 同样继续。可在原授权内顺序推进，不必每个检查点停下来等 reviewer。完整可做范围齐备后回传真实精确 HEAD 和终态证据；若受外部条件阻塞，给出准确调用与错误。

不进入合入、部署或 Issue 关闭。
