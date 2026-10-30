---
feature_ids: [F032, F127, F143, F161, F241]
topics: [ci, startup, develop, packaging]
doc_kind: implementation-plan
created: 2026-10-30
---

# PR #1748：CI 与 Windows 启动修复

本轮原始要求：“继续把 CI 和 Windows 打包的启动门禁问题修好，验证通过后更新当前 PR，目标分支保持 develop。完成CI后合入develop”。沿用既有 feature 与构建工位，不改生产环境，不关闭尚未完成的整份重构 Feature。

完成条件：当前代码的适用 GitHub CI 全绿；正常干净 Windows 构建通过原90秒启动分析、生成并核查最终安装物；非作者审查覆盖最终 PR 交付范围且无开放 P1/P2；远端 base 仍为 develop，满足检查后实际合入并回读 merge 结果。没有 Mac 和企业 CodeAgent 的边界保留，不以 CI smoke 代替原34项端到端验收。

实施顺序：保留远端与本地 RED → 按具体根因修复产品或过期夹具 → 定向验证并推动完整 CI → 干净发行构建与包内检查 → 独立 review、更新 PR 并合入 develop。需要时重用已有可信失败，不堆叠同义测试，不增加 skip、门禁豁免或延长启动时限。

已复现：成员创建前置提醒失败被误记为不确定写入；ACP 工厂拒绝后残留 active turn 阻止重试。修复分别把前置步骤移到写入意图落盘前、把工厂准备移到 turn 占用前。目录门禁通过将一个注册清理文件移入既有 lifecycle 目录解决。测试同步新的缺失终态失败语义、平台路径大小写、冻结参数和目录发布入口；超时测试使用真实内存执行 store，置换测试先绑定新会话执行边界再声明既有原生历史，不改变产品的未知旧会话拒绝规则。

Windows 诊断使用既有 e184 冻结程序及独立临时实例，90秒仍失败。仅用于诊断的逐路由标记将停顿定位在默认插件准备阶段，安装 journal 已记录多个 prepared 项，尚未到 HTTP 监听；该诊断运行不计验收通过。继续用明确的 listen 屏障验证初始插件安装与 HTTP 就绪的关系。

Architecture cell：identity-session / transport / runtime-host；Map delta：none；Why：沿用配置 writer、会话 provider、插件安装 journal、既有 Host listen 屏障和发行构建，不引入新持久对象或调度体系。
