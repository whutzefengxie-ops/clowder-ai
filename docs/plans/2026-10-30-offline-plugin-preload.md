---
feature_ids: [F241]
topics: [plugins, offline, deployment, packaging, configuration]
doc_kind: plan
created: 2026-10-30
tips_exempt: 部署准备与首次安装接线，无新增日常用户入口；操作说明随本文交付。
---

# H6：离线插件预置的最小接线

基于已审固定客户端 Host 增量 `d4b054e646a9a5b8cb2b6fab12326f7a9d9739c7` 新建工作树，继续使用用户指定角色基础。目标是交付安装包带匹配插件的能力，不把目录复制或 enabled 字段当成真实注册。不包含企业 Release provider，也不把本机协议 fixture 称为真实 CodeAgent。

## 实现约定

1. 复用 `prepareInitialPluginInstallation` 的同一 journal、首次安装判断、重试、owner 变更围栏和卸载 tombstone。仅增加可选的本地 pinned release 元数据源；不为离线另造状态机，不伪造官方 catalog URL。
2. 本地 bundle 为只读元数据和实际 tgz：精确 pluginId、packageName、version、SHA-512 SRI、相邻 archive 文件名及初始 enabled 意图。元数据在边界严格校验，文件名不能逃逸 bundle 根。
3. 使用 Manager composition 中同一个 LocalPluginPackageAdmission（包括完整性、quarantine、配置 reconcile、lifecycle），并传入 expectedDigest/expectedPackage；身份和摘要在 inventory 写入前校验。通过旧 inventory/配置入口启用，不扩大 grants、不启动模型。
4. 显式 `CAT_CAFE_OFFLINE_PLUGIN_BUNDLE` 绝对路径优先；发行 profile 可声明默认 bundle 相对安装运行根的资源路径。选中离线源后，缺失、损坏或重试失败只进入现有延后/重试诊断，不回落到公共 catalog/network。
5. 公共 profile 未选择离线源时保持已有官方首次安装行为。现有 inventory/journal/卸载记录胜过默认值，不在普通升级时重装、改绑或覆盖已保存配置。中断后的重试仍用 journal 原 pin；包变化不能静默漂移版本。
6. 打包准备入口只向显式构建 staging 输出 immutable 归档和 bundle 元数据；从实际 tgz 提取标识并计算摘要，不把企业 binary、端点、凭据或用户连接配置塞入包。输出可以放到部署 API 的 `offline-plugins/` 后一同进入现有安装闭包；不写运行数据根。

## 验证

- 原首次安装套件完整回归；本地源在 catalog 读取被禁止时也可走同一 journal，覆盖部分失败/重试、owner 停用、卸载、已有安装和 pin 漂移。
- 实际 CodeAgent tgz 经 Manager 正式接纳并注册；默认一个贡献，保存特殊连接后两角色独立 ACP fixture 会话、重启和修正失败配置恢复。模型/真实 MCP/企业验收另记。
- 元数据未知键/相对逃逸/重复标识/错误 digest/错误身份拒绝；无公共源 fallback、无隐式授权。
- 发行投影只保留选择的离线资源值；新环境键只在启动读取，CI 纳入对应生产测试。
- 配对 H5 的只读策略在最终组合树验证；内网旧 owner 文件桥和现有身份/数据根不得丢失。新 EXE 需用户另行要求打包时再交付，本阶段不借旧包冒充。

## 打包者与使用者的操作

打包者先部署完整 API staging（包含依赖和 dist），再执行：

```powershell
node scripts/prepare-offline-plugin-bundle.mjs "G:/build/runtime/packages/api/offline-plugins" "G:/delivery/clowder-ai-codeagent-0.1.0-beta.2.tgz"
```

命令要求绝对输出目录，生成按 SHA-512 命名的 tgz 与 bundle.json；相同输入重复执行幂等，不覆盖不同 bundle/归档。只指向构建 staging，不能指向已有实例数据根。归档从真实包提取身份并算摘要，Host 首启还会再次校验全部包。此准备步骤依赖源码工作树 Node 24、已安装的仓库依赖和 tar；不是内网最终用户要执行的命令。

发行数据的**选中 profile** 增加 `"offlinePluginBundle": "packages/api/offline-plugins/bundle.json"`。投影后随完整 runtime 资源进入现有安装闭包；运行根由 desktop 的 CAT_CAFE_RUNTIME_ROOT 指定，API 源码启动从入口定位，不使用用户选中的业务项目 cwd。特殊部署可一次设置 CAT_CAFE_OFFLINE_PLUGIN_BUNDLE 绝对路径，显式路径优先；空值/相对值报配置错误，不回落联网。公共 profile 不设置此字段时维持原官方首次安装流程。

普通内网用户无需准备 bundle 或设置变量：安装包预置同一个插件；首次准备完成后在原插件设置入口查看状态。零配置 ready 的静态 CodeAgent 可启用并注册，但不请求模型；缺配置/授权的插件仍显示待设置。CodeAgent 原生程序、登录和企业网络由现场提供。升级时已有 inventory、配置、停用和卸载记录优先，bundle **不是自动升级通道**；旧安装若已存在插件记录，需通过现有安装入口显式补装新插件，不偷偷改变旧绑定。

## 本地证据与边界

- 已观察 RED：原流程在三项离线场景仍调用被禁止的 catalog。接线后原在线 10 项 + 离线状态机 3 项全部通过。
- 生产 admission 两项通过：路径选择，包身份/摘要拒绝、journal pin 不漂移、失败后恢复、停用/卸载保持、零 catalog 请求。
- 构建/元数据三项通过：严格 schema、profile 范围、真实归档 hash、重复准备及不同输出保护。
- 实际 `@clowder-ai/codeagent@0.1.0-beta.2` tgz 的离线安装→默认注册→双 ACP fixture 会话/续聊→非法保存修正→停用/启用→运行时重建回读通过，SHA-256 为 `83c3a06bb2a1d9501a4fea34bd82a4adf562f75bd9143635f5392c16ecbddf9e`。测试 catalog 请求直接抛错，未回落网络。
- API/shared 类型编译及 env registry/example 检查通过。测试使用作者独立临时项目，原生进程关闭后回收，无生产 Redis/端口/配置修改。

本片不包含安装器新 EXE、内网旧 owner 文件兼容桥、所有发行身份参数化或企业 Release provider。与独立 H5 策略的组合验收另行记录。企业 binary 本机不可用且用户已明确由现场验收；fixture 不证明真实 CodeAgent 模型/MCP/A2A 或安装包首装。PR 提交与独立审查状态见后续记录，不能将本地通过等同公共已合入。
