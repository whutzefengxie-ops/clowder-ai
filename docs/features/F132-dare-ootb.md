---
feature_ids: [F132]
related_features: [F050, F113]
topics: [dare, installation, onboarding, external-agent]
doc_kind: spec
created: 2026-03-23
---

# F132: 狸花猫开箱即用（DARE Out-of-the-Box）

> **Status**: spec | **Owner**: Ragdoll | **Priority**: P1

## Why

当前安装 Clowder AI 后，狸花猫 (@dare) 需要 4 步手动配置才能使用：
1. 单独 clone DARE 仓库
2. 在 `.env` 配置 `DARE_PATH`
3. 手动在 DARE venv 中安装 Python 依赖（openai、httpx[socks] 等）
4. 手动修改 bootstrap binding 从 `skip` 改为 `enabled`

铲屎官原话："我想要安装猫猫就有狸花猫，安装完后，只需要配置 api_key 就能使用了"

## What

### Phase A: 服务层修复 + 路径解析

1. **`DEFAULT_DARE_PATH` 从项目根解析** — 使用 `import.meta.url` / `__dirname` 从 API 包路径向上找到项目根再拼 `vendor/dare-cli/`，不绑定进程 `cwd`
2. **DareAgentService venv python 修复** — 优先使用 DARE repo 的 `.venv/bin/python`（macOS），接口预留 Windows `.venv/Scripts/python.exe`
3. **smoke test 同步更新** 默认路径

### Phase B: 安装器集成 + 默认启用

1. **installer clone-if-missing** — `scripts/install.sh` 中加 `git clone https://github.com/clowder-labs/Deterministic-Agent-Runtime-Engine vendor/dare-cli/`；已存在时 skip（幂等，不 auto-pull）
2. **installer venv setup** — clone 后创建 `.venv` + `uv pip install -r requirements.txt`
3. **默认启用 dare bootstrap** — `provider-profiles.ts` 的 bootstrapBindings 把 dare 从 `{enabled: false, mode: 'skip'}` 改为启用（沿用现有 `oauth|api_key|skip` mode 体系，不新增 mode）
4. **安装器接入 client-auth 流程** — 安装时调用 `client-auth set --client dare`，沿用现有认证入口引导 API Key 配置

## Acceptance Criteria

### Phase A（服务层修复 + 路径解析）
- [ ] AC-A1: `DEFAULT_DARE_PATH` 从项目根解析到 `vendor/dare-cli/`，不依赖进程 `cwd`
- [ ] AC-A2: DareAgentService 优先使用 `vendor/dare-cli/.venv/bin/python`
- [ ] AC-A3: dare-smoke.test.js 使用新的默认路径，测试通过
- [ ] AC-A4: venv python 查找提取为 helper，macOS 先实现，Windows 留接口

### Phase B（安装器集成 + 默认启用）
- [ ] AC-B1: `scripts/install.sh` clone-if-missing + skip-if-exists（幂等）
- [ ] AC-B2: `scripts/install.sh` 自动创建 venv + 安装 DARE 依赖
- [ ] AC-B3: 新安装默认启用 dare bootstrap binding（沿用现有 mode 体系）
- [ ] AC-B4: 安装器通过现有 client-auth 流程引导 dare API Key 配置
- [ ] AC-B5: 全新安装后仅配 API Key 即可使用狸花猫（端到端验证）

## Dependencies

- **Related**: F050（External Agent Onboarding — DARE 是首个 F050 契约的实践）
- **Related**: F113（One-Click Deploy — 安装体验优化方向一致）

## Risk

| 风险 | 缓解 |
|------|------|
| `vendor/dare-cli/` 目录丢失或损坏 | installer 检测 + 重新 clone |
| Python/uv 环境差异（macOS/Linux） | 安装脚本做平台检测 + 清晰错误提示 |
| DARE 上游破坏性更新 | clone 时不锁定版本，但 smoke test 会捕获回归 |

## Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | DARE repo 来源 | ✅ 直接 clone org repo `clowder-labs/Deterministic-Agent-Runtime-Engine`（KD-4） |
| OQ-2 | Windows 适配 | ⏸️ macOS 先做，Windows 只留接口不落地（KD-5） |
| OQ-3 | 是否支持固定 upstream ref | ⬜ 非阻塞，不做也不挡这轮 |

## Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | installer `git clone`（非 submodule） | 铲屎官决定：直接 clone 最新代码 | 2026-03-23 |
| KD-2 | 复用 client-auth/provider-profiles 链路，不造第二套 | 砚砚 review：现有能力已有，避免重复初始化逻辑 | 2026-03-23 |
| KD-3 | Python 依赖安装放在显式 installer，不放 npm postinstall | 砚砚 review：隐式副作用太重，失败面大 | 2026-03-23 |
| KD-4 | DARE 直接 git clone org repo `clowder-labs/Deterministic-Agent-Runtime-Engine` | 铲屎官决定 | 2026-03-23 |
| KD-5 | Windows 适配后续再做，macOS first | 铲屎官决定 | 2026-03-23 |
| KD-6 | bootstrap mode 沿用现有 `oauth\|api_key\|skip`，不新增 `client-auth` mode | 砚砚 Design Gate：现有契约只有三种 mode | 2026-03-23 |
| KD-7 | `vendor/dare-cli/` 已存在时 skip，不 auto-pull | 砚砚 Design Gate：安装器必须幂等 | 2026-03-23 |
| KD-8 | `DEFAULT_DARE_PATH` 从项目根解析，不绑 `cwd` | 砚砚 Design Gate：进程 `cwd` 在服务里会跑偏 | 2026-03-23 |

## Timeline

| 日期 | 事件 |
|------|------|
| 2026-03-23 | 立项。铲屎官提出需求，砚砚 review 收敛方案 |
| 2026-03-23 | Design Gate 通过。砚砚拆实施计划（Task 0-4） |

## Review Gate

- Phase A: 缅因猫 review（服务层改动 + 测试覆盖）
- Phase B: 缅因猫 review + 铲屎官验收（端到端安装体验）

## Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **Feature** | `docs/features/F050-a2a-external-agent-onboarding.md` | DARE 是首个外部 agent 接入实践 |
| **Feature** | `docs/features/F113-one-click-deploy.md` | 安装体验优化 |
| **Thread** | `thread_mn2q199272wucy08` | 立项讨论：狸花猫呼叫 + 方案探索 + 砚砚 review + Design Gate |
