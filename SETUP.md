# Clowder AI Setup Guide

This guide covers the minimum configuration required to run Clowder AI locally, plus the optional tooling that unlocks the full experience.

## 1. Prerequisites

- Node.js 20+
- pnpm 9+
- Git
- At least one supported agent CLI installed:
  - Claude Code
  - Codex CLI
  - Gemini CLI
  - Antigravity
  - opencode

## 2. Minimum Runtime

The smallest usable local setup is:

1. Install dependencies
2. Provide one model API key
3. Start in memory mode

```bash
pnpm install
cp .env.example .env
# Add at least one provider key to .env
pnpm start:direct --memory
```

If you do not want to use `--memory`, provide a Redis instance and set `REDIS_URL`.

## 3. Required Configuration

Clowder AI expects:

- `API_SERVER_PORT`
- `FRONTEND_PORT`
- One or more provider keys:
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
  - `GOOGLE_API_KEY`

Optional but recommended:

- `REDIS_URL` for persistent local state
- `CAT_CONFIG_PATH` if you want to load a custom roster file

## 4. Design Tooling

### Pencil MCP (recommended)

If you want design tasks, UI iteration, screenshots, and design-to-code workflows to feel like the screenshots in our README, install a design-capable MCP.

We recommend **Pencil MCP**.

Without Pencil or an equivalent design MCP:

- Clowder AI still runs
- coding tasks still work
- design tasks degrade to plain text guidance and generic frontend output

If you skip Pencil, bring your own MCP or design workflow.

## 5. Optional Integrations

### Voice

Optional voice features may require:

- ASR provider
- TTS provider

If voice is not configured, Clowder AI still runs normally in text mode.

### Messaging / IM

Optional chat platform integrations may require additional credentials:

- Feishu
- Telegram
- GitHub notification polling

These are not required for local development.

## 6. Safe Local Ports

Do not assume the default runtime ports are free in your environment.

For isolated local runs, set explicit ports, for example:

```bash
API_SERVER_PORT=3003 FRONTEND_PORT=3004 pnpm start:direct --memory
```

## 7. Troubleshooting

### `pnpm check` fails after sync

Run:

```bash
pnpm check:fix
pnpm check
```

### Design output looks generic

You are probably missing Pencil MCP or another design-capable MCP.

### No persistent memory

This is expected when running with `--memory`.

## 8. What Is Not Included

The public Clowder AI repository does **not** include our private deployment topology, private endpoints, or internal memory services.

If a document references an internal-only system, treat it as historical context, not a required dependency.
