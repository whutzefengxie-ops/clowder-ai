---
feature_ids: [F241]
topics: [acp, windows, plugins, compatibility]
doc_kind: plan
created: 2026-10-22
---

# 显式可信主机兼容模式

来源：PR #1677 内网验收反馈；用户明确选择「跳过祖先信任校验，审计失败告警后允许保存；保留鉴权和目录自身私有权限」，取代此前对该范围不降低安全性的限制。

## 契约

- 仅 Host 启动环境中的 `CAT_CAFE_TRUSTED_HOST_COMPATIBILITY=1` 启用；默认严格，插件配置不能自行打开。
- Windows bootstrap 不再以祖先 owner 或祖先 DACL 拒绝启动；仍验证本地真实 NTFS 卷、每级目录非 reparse、目录自身 owner 与受保护的私有 DACL，并在 spawn 前复验。此模式明确接受其他祖先拥有者替换路径的风险，不能称为完整信任校验。
- 仅插件配置保存：审计 append 失败可继续保存，服务日志和成功响应都携带警告，页面显示「配置已保存但审计失败」。配置校验、版本围栏、持久写入或 runtime 恢复失败仍正常失败；安装、启停、卸载、工具调用的审计准入保持原状。
- 默认严格模式和现有调用方的行为不变。关闭开关并重启 API 恢复严格模式；不迁移配置、不修 ACL、不删历史。已存在 ACP 进程随 API 重启关闭，不能继续复用旧信任模式。
- 检查界面如实区分严格/兼容结果。bootstrap 目录不是项目目录，也不覆盖 CodeAgent/OS 自身的权限策略。

## 实施与验证

1. 对 Windows 原生目录和 API 审计拒绝补 RED：未开关拒绝，开启可继续；坏自身 DACL、reparse、非本机写请求仍拒绝；审计失败和配置失败不可混淆。
2. 新增 Host 专属开关和有限兼容分支；抽出原有大文件中的路由契约、配置 handler 与 Web 保存 hook，编辑后的模块控制在 350 行内。
   环境变量注册表的既有 233 项纯数据分片，保持字段、次序和原本的默认值来源；通过序列化逐项比较核验不变，只新增此部署开关。
3. Web 检查结果和保存警告补行为测试；真实 HTTP 保存→回读→再次保存，以及本机 Windows bootstrap/spawn 复验；不把合成 ACP 当作真实 CodeAgent 验收。
4. 更新操作指南：设置环境变量、重启 API、检查→使用目录→保存→回读→发消息；说明审计目录 `AUDIT_LOG_DIR` 的正常修复路径和兼容边界。
5. 受影响 Node/Vitest、API build、Web 类型检查、格式检查与独立审查，再推送同一 PR 并消费新 HEAD CI。

格式化：`pnpm biome check --write <本次文件>`；构建：`pnpm --filter @cat-cafe/api build`；Web：`pnpm --filter @cat-cafe/web exec vitest run <本次测试>`。

Architecture cell：Host runtime policy；Map delta：显式部署策略控制两处已有准入，未新增持久状态或客户端权限。
