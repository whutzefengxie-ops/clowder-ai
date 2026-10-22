---
feature_ids: []
related_features: [F241, F289]
topics: [pi, acp, sessions, recovery, diagnostics, issue-1704]
doc_kind: design
created: 2026-10-23
status: proposed
---

# 推荐设计：内置桥使用 Pi 原生持久化

## 目标与路线选择

用户继续使用已发现的内置 Pi 成员及自定义 LLM。完成首轮后，即使 ACP/Pi 进程退出或 Host 重启，也能恢复同一原生 session 和历史，并使用当前有效的 MCP。首轮异常应显示可核查的真实错误，不能被空内容或泛化提示掩盖。

| 路线 | 判断 |
| --- | --- |
| 在内置桥补齐 Pi 原生持久化/load | **推荐**。满足当前入口和内网安装边界；改动集中在 Pi 与受信启动参数，沿用已有 Host 会话契约 |
| 默认切换为独立 `clowder-pi-acp` | 可作对照；插件仓 #104 尚未合入/发布，不能据此假定企业机已可使用；本轮没有默认入口迁移授权 |
| 整体引入第三方适配器源码 | 当前不推荐。额外引入协议、分发和维护面；先借鉴精确恢复与测试，不重复拥有整套适配层 |
| 永不回收进程、失败时自动创建新 session | 不满足目标。进程退出仍丢上下文，且可能掩盖绑定错误 |

Architecture cell：既有原生客户端 / ACP 接入。Map delta：新增内置 Pi 原生会话存储与恢复边界；无新 UI 或顶层服务。Why：Pi 是模型上下文权威，Host 是成员、消息和调用权限权威，桥只负责协议与运行生命周期。

## 1. ID、存储与权威

建议新会话使用版本化原生 ID：`clowder-pi-v1-<uuid>`，ACP sessionId 与 Pi `get_state.sessionId` 相同。实施前普查 Host 将 ID 当不透明字符串消费的所有路径；Pi 1.3.0 支持自定义 `--session-id`，其他版本须做能力检查。

建议目录为 `<dataRoot>/native-sessions/pi/v1/<scopeHash>/<sessionId>/`，由 Host 向**已核实的内置桥**注入受信根和 scope；参数名称在 W0 固定，不能接收来自聊天正文的路径。

| 对象 | 权威、归属及生命周期 |
| --- | --- |
| `dataRoot` | 复用当前 `resolveCatCafeDataRoot()`：显式 `CAT_CAFE_DATA_DIR`，否则 HOME 下 `.cat-cafe`；不回落到 cwd/TEMP，不新增隐式根 |
| scope | 建议由稳定成员身份、原生 profile 身份和 accountRef（无显式账户时用原生 profile 标记）构成；不含 token、模型名或每次 invocationId；W0 固定跨重启语义 |
| 原生 JSONL | Pi 唯一写入和解释历史；Host 不重写、拼接、镜像或合成 Pi transcript |
| Host 消息/session 绑定 | 沿用现有持久化；原生恢复失败不清空、不替换绑定 |
| 运行互斥信息 | 只用于当前写者所有权，不作为历史索引或恢复真相；不保存 credentials |

Pi 默认生成的时间戳文件名可保留；在独占的单 session 目录中，按精确 ID 和文件头查找，拒绝多个候选。无需新增全局 JSON 映射数据库。新增目录须记录 owner、生命周期、根路径、兼容、备份及 census 消费方；使用现有窄范围 owner/权限机制保护新历史，不递归修改用户 HOME 或项目 ACL。

F289 的生产根切换仍暂停；不能依赖尚未合入的统一资产 resolver/catalog。本修复使用现有兼容 resolver 的窄注入接口，并在后续根切换时作为原生历史资产显式迁移。

## 2. 新建与精确恢复

新建建议流程：

1. Host 提供固定 scope；桥分配版本化 ID，独占创建目录并取得写者所有权。
2. 真实 Pi 以 `--mode rpc --session-id <id> --session-dir <ownedDir>` 启动，去掉 `--no-session`，加载当次 MCP extension。
3. `get_state` 回读 native ID、sessionFile、cwd 和配置，只有身份一致才返回 `session/new`。
4. Pi 的文件是惰性落盘：无 prompt 的创建/探测可能只有 sessionFile 路径而没有文件；不能将该路径当作历史已经写盘的证据。

冷恢复建议流程：

1. 验证 ID 格式、受信 scope、绝对根及目录归属；拒绝路径穿越、越界 reparse/junction、重复候选及不属于该成员的文件。
2. 取得互斥，精确找到已存在的 Pi JSONL；有界读取 header，核对 `type/session version/id/cwd`。不自行实现 Pi 的历史迁移；交由受支持 Pi 校验内容。
3. 使用**已验证存在的绝对文件**启动 `--session <path>`，或经验证的 `switch_session`；禁止按部分 ID、全 HOME 搜索或跨项目自动 fork。
4. 若使用 `switch_session`，必须检查 `{cancelled:true}`；随后 `get_state` 回读同一原生 ID/文件/cwd、非 streaming 状态及配置，成功后才发布恢复结果。
5. 真实历史必须进入恢复后的 provider messages；仅返回旧 ID、成功握手或重新注入聊天摘要均不算恢复。

**不能用 `--session-id` 的“缺失则新建”语义实现 load。** 文件缺失、损坏、版本不支持、scope/cwd 不符及权限失败都须保留历史并明确失败，不自动新建、清空 ID 或改用默认模型。

`loadSession:true` 只能随完整实现与能力门槛一起开启。保留现有 close/cancel 语义，新增 load 不扩展尚不支持的 HTTP/SSE MCP 或受限执行策略。

## 3. 生命周期、并发与故障

以下为运行状态，不另建持久化状态表；能从原生文件和运行句柄推导的状态直接推导。

| 状态/事件 | 预期不变量 |
| --- | --- |
| 分配后、首次落盘前 | 可发首轮；跨进程若没有文件则明确不可恢复，不凭路径猜测历史存在 |
| 活跃 | 同 session 至多一个 Pi 写者、一个 prompt；同桥并发 load 合并或明确拒绝 |
| `agent_settled` | 本轮终止边界；prompt admission 和 `agent_end` 不等于模型任务完成 |
| close / 空闲池回收 | 关闭已确认归属的子进程与临时 MCP extension；原生 JSONL 永久保留 |
| 进程退出 / Host 重启 | 活跃绑定失效；新进程经精确 load 接续；不需要维持永生进程 |
| 恢复中 | 未验证完成前不得 prompt 或向 Host 宣称绑定成功 |
| 文件缺失/不兼容 | 返回可定位失败；应用消息、原生残留和旧绑定保留供诊断 |

跨进程写者互斥是开启冷恢复的先决条件。W0 必须验证既有 Host ownership/调用串行化是否覆盖双 Host、桥崩溃而 Pi 子进程仍活着等情况；不足时在 Pi 范围补充可验证的锁/lease。禁止仅凭父 PID 消失、锁文件超时或 mtime 过期抢占。所有权判定须包含进程出生身份和实际写者生命周期；无法证明安全时拒绝第二写者。

保持现有 30 分钟池 TTL 和 cwd/MCP 绑定校验。测试可注入短 TTL 触发真实 eviction，产品不取消回收，也不放宽通用 `AcpSessionBindingError`。

Host 的 native defaults 可能以无 prompt 的 `session/new` 探测后 close；不得伪造对话、发模型请求或污染用户原生默认列表。若清理 provisional 空目录，只允许核验归属后的空目录移除；未知内容及任何 JSONL 保留。

## 4. MCP、模型、凭据与 Windows 启动

每次新建或恢复均使用本次 `mcpServers` 建立临时 extension，并沿用稳定 credential-file 刷新机制；不把旧 invocation token、callback secret 或完整 env 写入原生索引。同 session 的 server/tool 命名须跨重启稳定并避免冲突，不能继续依赖每次随机 prefix 而不核对原生历史中的工具身份。结构/权限变更沿用现有绑定校验，不能借冷恢复绕过。需验证冷恢复后的真实 MCP 可读写及 token 轮换，而非只检测工具名存在。

Pi 的 `models.json`、`auth.json` 与继承环境仍按现有账户/profile 边界使用；`auth.json={}` 不代表没有凭据。模型和 thinking 配置沿现有 Host/native policy，不强设 provider，也不自动复制认证文件。

受信状态根/scope 必须进入实际启动上下文及池签名。修改 Windows bootstrap matcher 时只接纳准确内置入口及固定参数；保持 ACL/owner 校验，外部任意命令不能借此绕过审计。记录真实子进程 argv/可执行路径；`Get-Command pi` 的结果不能代替 Host 的 PATH/PATHEXT 解析证据。

## 5. 首轮空响应：修转换、保错误、核现场

建立 prompt 级输出分类，覆盖多个 assistant/tool 事件：非空白文本或可用 tool_use/tool_result 为可用输出；thinking、usage、状态、空 delta 和空 assistant 结束均不算。分类与“终止事件已经到达”分开表示。

优先修复已见代码缺陷：空 delta 不得设置“已流出有效文本”并阻断 final content 回填；仅 final 文本、流式文本和最终快照须正确对账，不能丢文本或重复追加。保留合法工具完成但无末尾文本的成功场景。

| 情况 | 行为契约 |
| --- | --- |
| 有输出且正常 settled | 正常完成；保留既有流式顺序 |
| 无输出、上游明确错误 | 优先保留脱敏错误及阶段，不能改写成泛化空响应 |
| 无输出、正常空完成 | 传输可以正常终止，但不能记录为“产生了有效回复”；真实 Host 仍给 `empty_response`，不注入占位文本规避检查 |
| 仅 thinking / usage | 仍走无可用输出判定；给出安全诊断元数据 |
| RPC 拒绝 / handled / cancel / 进程退出 | 各自保留语义；不一律改成空响应或自动重试 |

诊断白名单：Host/bridge/Pi 版本、阶段、请求关联 ID、事件类别计数、stopReason、错误类别及必要的脱敏短摘。stderr 先脱敏再截断并限长；不记录完整 env、请求正文、原始 stderr、凭据文件内容或用户目录。复用现有 sanitizer 和错误承载；如必须增加映射，只限准确 Pi 诊断契约并补 Host 端测试。

复用 fork PR #14 已有 Pi 检测与测试意图，重新核对其 Host errorCode，不整包复制 DSH/账户逻辑。企业机首次空响应是否由上游空完成、启动 shim、版本兼容或转换遗漏触发仍未确认；必须以现场同版本事件链判定，不能预设模型或 ACP 是根因。

## 6. 旧会话、回退与禁止项

旧 UUID 来自内存桥，且 Pi 使用 `--no-session`：仍存活的旧进程可继续按原规则复用；进程退出后原生历史不存在。保留应用记录，沿已有显式新会话操作继续。不得批量重写旧绑定、从应用聊天反向伪造 Pi JSONL，或声称恢复了原工具上下文。

回退代码时保留所有新原生文件、Host 消息和绑定。旧二进制可能不能理解版本化 ID，因此写入新会话后的回退不承诺继续恢复；应明确显示版本/能力限制并可重新部署修复版接续。不得为让旧版跑通而删除数据。未发生新格式写入前可按现有包回退流程恢复程序。

不接受：仅改能力声明、静默换 session、关闭 TTL、全局放宽恢复失败、自动切桥/切模型/复制凭据、变更 UI 入口，或凭合成测试关闭企业机空响应问题。
