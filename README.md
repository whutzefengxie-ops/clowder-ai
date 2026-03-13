# Clowder AI

**Hard Rails. Soft Power. Shared Mission.**

The missing layer between your AI agents and a real team.

Most frameworks help you run agents. Clowder helps them work together —
with persistent identity, cross-model review, shared memory,
and collaborative discipline.

> Built by [Cat Cafe](https://github.com/zts212653/cat-cafe-tutorials) — where three AI cats learned to ship software together.

---

## What is Clowder AI?

Clowder AI is an **AI team orchestration platform** that turns individual AI agents into a functioning engineering team. Instead of running agents in isolation, Clowder provides the infrastructure for agents to:

- **Review each other's work** across model families (Claude reviews GPT, GPT reviews Gemini)
- **Maintain persistent identity** that survives context compression
- **Share memory and decisions** through structured knowledge systems
- **Follow collaborative discipline** via skills, SOPs, and quality gates

### Architecture

```
                    +------------------+
                    |    Mission Hub   |  ← Thread management, task routing
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
        +-----+-----+ +-----+-----+ +-----+-----+
        | Claude CLI | | Codex CLI | | Gemini CLI|  ← Agent backends
        +-----+-----+ +-----+-----+ +-----+-----+
              |              |              |
        +-----+-----+ +-----+-----+ +-----+-----+
        |  Identity  | |  Identity  | |  Identity  |  ← Persistent persona
        |  + Skills  | |  + Skills  | |  + Skills  |  ← Injected per-turn
        +-----------+ +-----------+ +-----------+
              |              |              |
              +--------------+--------------+
                             |
                    +--------+---------+
                    |   Shared Layer   |
                    | Memory | Review  |  ← Cross-model collaboration
                    | Config | Signals |
                    +------------------+
```

### Key Concepts

| Concept | What it does |
|---------|-------------|
| **Cat Breeds** | Agent identity templates (personality, role, capabilities) |
| **Skills** | Modular prompt injections loaded per-task (TDD, review, debugging...) |
| **Hard Rails** | Non-negotiable constraints enforced in code (data sanctuary, process isolation) |
| **Soft Power** | Cultural norms expressed in prompts (quality standards, collaboration etiquette) |
| **Cross-model Review** | Agents from different model families review each other's work |
| **Session Chain** | Context continuity across conversation compactions |

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Redis 7+ (for session/state management)

### Install

```bash
git clone https://github.com/zts212653/clowder-ai.git
cd clowder-ai
pnpm install
```

### Configure

Copy the example config and customize your agent roster:

```bash
# cat-config.json is included with a default 3-agent setup
# Edit to match your API keys and preferences
```

Set up environment variables:

```bash
# Required: at least one AI provider API key
export ANTHROPIC_API_KEY=your-key-here
# Optional: additional providers
export OPENAI_API_KEY=your-key-here
export GOOGLE_API_KEY=your-key-here
```

### Build & Run

```bash
# Build shared packages
pnpm --filter @cat-cafe/shared build

# Build API
pnpm --filter @cat-cafe/api build

# Start development server
pnpm --filter @cat-cafe/api start
```

### Verify

```bash
# Run public test suite (no Redis required for basic tests)
pnpm --filter @cat-cafe/api run test:public

# Run full test suite (requires Redis)
pnpm --filter @cat-cafe/api test
```

For the full configuration matrix, optional integrations, and design tooling requirements, see [SETUP.md](SETUP.md).

## Project Structure

```
clowder-ai/
├── packages/
│   ├── api/          # Backend: agent routing, MCP server, session management
│   ├── web/          # Frontend: Mission Hub UI (Next.js)
│   ├── shared/       # Shared types and utilities
│   └── mcp-server/   # MCP server for agent tool integration
├── cat-cafe-skills/  # Modular skill definitions (loaded per-task)
│   ├── manifest.yaml # Skill routing configuration
│   ├── */SKILL.md    # Individual skill definitions
│   └── refs/         # Shared references (rules, templates)
├── scripts/          # Development and sync utilities
└── cat-config.json   # Agent roster and review policy
```

## Skills System

Skills are modular prompt injections that give agents specialized capabilities:

```yaml
# Example: manifest.yaml (excerpt)
- id: tdd
  description: Red-Green-Refactor test-driven development
  triggers: ["write code", "implement", "fix bug"]

- id: quality-gate
  description: Pre-review self-check against spec
  triggers: ["ready for review", "self-check"]

- id: request-review
  description: Send structured review request to peer
  triggers: ["request review", "ask for review"]
```

Each skill is a `SKILL.md` file that gets injected into the agent's system prompt when triggered. Skills encode team practices — TDD discipline, review protocols, debugging methodology — as composable, versionable text.

## Hard Rails (Iron Laws)

These constraints are **non-negotiable** and enforced in code:

1. **Data Sanctuary** — Production data stores are read-only during development. Development uses isolated instances (different ports/databases).
2. **No Self-Review** — An agent cannot review its own code. Cross-family review preferred, same-family different-individual as fallback.
3. **Identity Immutability** — Agents cannot impersonate other agents. Identity is a hard constraint, not a suggestion.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on:
- Setting up your development environment
- Submitting pull requests
- Code quality standards
- Community conduct

## Security

See [SECURITY.md](SECURITY.md) for:
- Security reporting process
- Iron law enforcement details
- Responsible disclosure policy

## License

[MIT](LICENSE) — Clowder AI Contributors

---

# Clowder AI（中文）

**硬约束。软力量。共同使命。**

AI 智能体和真正团队之间，缺失的那一层。

大多数框架帮你运行智能体。Clowder 帮它们一起协作——
带着持久身份、跨模型审查、共享记忆和协作纪律。

> 诞生于 [Cat Cafe](https://github.com/zts212653/cat-cafe-tutorials)——三只 AI 猫猫学会一起交付软件的地方。

## 这是什么？

Clowder AI 是一个 **AI 团队编排平台**，将独立的 AI 智能体变成一支运作中的工程团队。核心能力：

- **跨模型互审**：Claude 审 GPT 的代码，GPT 审 Gemini 的设计
- **持久身份**：抗上下文压缩的角色注入
- **共享记忆**：结构化的知识管理和决策追踪
- **协作纪律**：技能系统 + SOP + 质量门禁

## 快速开始

```bash
git clone https://github.com/zts212653/clowder-ai.git
cd clowder-ai
pnpm install
pnpm --filter @cat-cafe/shared build
pnpm --filter @cat-cafe/api build
pnpm --filter @cat-cafe/api start
```

需要：Node.js 20+、pnpm 9+、Redis 7+，以及至少一个 AI 提供商的 API Key。

## 三条铁律

1. **数据圣域** — 生产数据库开发时只读，开发使用隔离实例
2. **禁止自审** — 不能审自己的代码，跨家族审查优先
3. **身份不可变** — 不能冒充其他智能体

## 许可证

[MIT](LICENSE) — Clowder AI Contributors

> 「每个灵感，都值得一群认真的灵魂」
