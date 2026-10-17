---
feature_ids: [F155, F320]
topics: [onboarding, guide, persistence]
doc_kind: implementation-plan
created: 2026-10-17
---

# 新版首配到 F155 入口提醒的接线

来源：#1466 第8步要求真实主界面提醒成员/密钥、复用F155、不挡第一句话；用户要求完成完整旅程。上一轮已证实新版members创建路径不产生旧bootcamp状态，不能依赖旧触发器。

## 契约

- 沿用`UserPreferences.onboardingGuides`的严格reader/原子updater及session身份。为`first-run-entry-v1`增加pending回执，和collaboration-v1演示回执分键；不是第二个存储owner或引导引擎。
- 新的零角色草稿记录首次名单为空；已有草稿无法证明时不推断。非空名单、旧用户、零选择不登记提醒。部分创建/刷新仍保留原旅程身份。
- 首次创建前幂等登记pending。完成/关闭为终态，重复pending不能重新打开；演示完成记录、其他用户和未知配置原字保留。偏好损坏时503，不覆写成新用户。
- 主界面且已有角色、无演示/其他引导时才消费pending。复用F155 flow、overlay、完成/退出语义；离开页面或引擎异常不冒充用户已完成。非阻塞提醒不改变焦点、输入、发送或shell。
- flow只说明设置入口中的成员与密钥，用classic/v2共有的hub.trigger定位。不依赖用户保留pin，不新增侧栏入口，不改变pin默认策略或用户历史pin。
- 完成须F155服务端ACK；主动退出记录dismissed。个人回执保存失败显示非阻塞重试，刷新后允许重新提示，不静默吞掉写失败。

## 改动与验收

1. config-onboarding原owner增加entry读写路径，session-only，状态单调；RED为当前404，再验证用户隔离、损坏偏好字节不变及原演示接口兼容。
2. useNativeOnboarding补首次名单标记与登记；验证0/1/N、旧名单、旧草稿、部分失败、重试不重复创建，提醒不依赖模型调用。
3. 新的FirstRunEntryReminder组件消费回执并调用现有guideStore；ChatContainer仅接组件。单测覆盖在设置/演示中不触发、未登记不触发、其他引导不被顶掉、刷新恢复、完成ACK/退出/失败重试。
4. 调整已有first-run-entry YAML并校验registry/tag；已有非阻塞overlay测试继续保护键盘和点击。
5. 真实生产页面故障矩阵与新首配→返回主界面旅程；安装版另核实际F155定位与发送不被拦。新源码与旧0927安装包分开报告，未重新构建不得移植旧包验收结论。

保留No-Go：原Claude连接默认协议失败、适用平台实物验收及维护者正式review不因本项完成而关闭。此计划不授权修改用户CLI认证或清空任何历史。
