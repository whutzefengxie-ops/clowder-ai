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
- 生成归档限制并发为4，打包/解压CLI降低自己的CPU调度优先级，进度日志记录实际priority；不宣称CPU优先级等同磁盘I/O限速，也不凭安装后低占用证明所有应用卡顿已修复。
- 用户补充反馈：测试包额外的PowerShell启动器显窗并继承stdout；新验收包去掉该包装脚本，快捷方式直接运行产品GUI，后台child仍使用windowsHide。主题CSS404来自遗漏Web构建生成的public/vendor，冻结snapshot本身不含生成物；必须从同一Web构建携带public/.next，缺少核心CSS即拒绝打包。
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

## 2026-10-15 首次实物验收

实物源版本 `30891685a405ec6618c452246dbb9800b5c67f41`，已合入 main `7b6123077`；其后 `b148f26e3` 仅隔离测试的能力配置，不改变产品。Web构建来自 `63bcb3e73`，至实物版本的Web/API运行代码无差异，BUILD_ID为 `qLkWauL2ZgMPSj-pB4pOl`。

在独立安装根、资料根、HOME及5164/3164/6336端口执行实际Setup，未提前启动API，未重试首次启动：

| 检查 | 实测 |
| --- | --- |
| Setup | 1,430,136,711字节；SHA256 `1f1e0ba7afa074f93f182705b8093e47af9af369137feb3cb443392e78ada97d` |
| 首装 | 08:18:16—08:30:08，711288ms，退出码0 |
| 公共依赖 / API / Web / MCP / Electron解压 | 391179 / 169840 / 97518 / 9023 / 6613ms |
| 主要归档条目 | 107452；旧包270492 |
| 首次桌面启动 | 13732ms达到ready；Redis、SQLite、sessionHooks实际检查通过 |
| 初始角色 / 实际使用 | `/api/cats`为空；通过本实例API创建测试伙伴后，真实Claude返回`INSTALL_UPGRADE_OK`，用户消息和回复均已持久化 |
| 主题资源 | 十个全局CSS均有实际规则，页面背景有主题颜色；原生演示截图仍待Windows解锁后验收 |

旧包四个主要归档现场合计1140865ms，新包五个主要归档合计674173ms，单次现场记录下降约41%。这不是相同缓存/负载下的多次基准；首装仍接近12分钟，不能称作快速安装。没有复现旧API120秒失败，也没有证明所有其他应用卡顿均已消失。

57项受影响检查无跳过通过，另有独立review；这些证据与实际Setup分开记录。同目录覆盖升级、升级后角色/消息/偏好回读以及原生演示最终截图的结果，以本轮实物验收回执及PR更新为准，未完成前不宣称全部闭环。
