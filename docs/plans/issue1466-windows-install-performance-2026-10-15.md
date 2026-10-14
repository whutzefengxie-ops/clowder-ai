---
feature_ids: [F155, F229, F320]
topics: [onboarding, windows, installer, performance]
doc_kind: implementation-plan
created: 2026-10-15
---

# PR #1519 Windows 安装耗时与可观测性

来源：用户实际安装 `29f590622` 时停留在解压界面；要求当前 worktree/PR 继续优化、重新打包并验证真实安装和首次启动。API 归档实测 243900ms、Web 149040ms；2.19GB Setup 的四个主要归档共 270492 个条目。这些数字不是优化后的结果。

## 结果与边界

- Windows 冻结生产依赖仅物化一份公共 hoisted tree，包自己的 node_modules 保留，Node 原生模块版本、私有 peer、workspace 模块和锁文件不变。Mac 继续原布局。
- Windows Electron 只提供壳；API/Web/MCP/文档等由同一安装根提供，避免 resources 再复制一次。
- 每个归档有条目数、字节数、校验和清单。解压开始、周期心跳、成功、失败立即落盘；安装界面消费同一个进度事件，不凭时间伪造完成。
- 不延长 API120秒期限、不修改 Defender 配置，不把热启动/单测通过冒充冷启动改善。
- 原实例 marker、数据根、角色 ID、历史消息、CLI 认证和引导回执不迁移。新增公共 node_modules 也属于替换边界，删除前拒绝其中的资料根（含目录别名）。

## 实施与验证

1. 先补共享依赖实际解析、私有覆盖/peer、移动后使用、未知目录拒绝的 RED；再改 Windows exporter、安装器/portable/CI 载体和边界。
2. 补解压中间事件、失败事件、归档损坏/不完整的 RED；实现带清单的 Node tar 打包、进度和 Inno stdout callback。
3. 使用 `node --test desktop/frozen-runtime-export.test.mjs desktop/extract-runtime-archive.test.cjs desktop/instance-data-boundary.test.js desktop/instance-upgrade.test.js` 等受影响检查。格式化使用 `pnpm biome format --write <本次文件>`，终态检查依据 package.json 的 `pnpm check`。
4. 新的独立安装根/资料根/HOME/Redis/三端口；记录 Setup SHA/源版本、每个阶段和总耗时。实际执行 Setup，确认解压日志持续变化、退出码、API ready、Web 可用和首次自动引导；首次启动失败必须保留失败日志并继续分析，不能自动重试后宣布成功。
5. 自有实例创建角色和历史后执行同目录升级，不重复首装参数，完整退出/启动并回读 marker、偏好、角色/消息。生产和用户当前正在安装的目录不作为破坏性试验对象。
6. 独立 reviewer 检查最终差异；PR 分开记录单测、实际安装、首次启动、升级保留，未验收内容继续列出。

状态生命周期：Setup 拥有逐归档解压；每次运行有独立 runId，start → progress → complete/failed。条目计数表示已读取条目，完成须等待写入及入口校验；中断留下最后心跳，不写 complete。进度只允许更新本安装的界面和日志。归档清单不含用户认证或历史。

Architecture cell: Windows offline installer / frozen runtime exporter。
Map delta: Windows 公共依赖从三份包内复制改为同一安装根一份；不改变 agent adapter、凭据 owner 或持久数据 owner。
