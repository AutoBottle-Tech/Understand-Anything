# understand-agent

HTTP server that runs **Understand Anything** via the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview). It reuses the isolated **`claude-local/`** configuration (MiniMax API, plugin cache, settings) and does not modify `~/.claude` or repo-root `.claude/`.

## What it does

- Loads API keys and model settings from `claude-local/.env`
- Syncs the local `understand-anything-plugin` checkout into `claude-local/.claude_config/plugins/cache/`
- Accepts HTTP requests and runs Claude with Understand Anything skills (`/understand`, `/understand-explain`, etc.)
- Starts the **Understand Anything dashboard UI** (Vite) and prints the tokenized URL on startup
- Writes analysis artifacts under `<projectPath>/.understand-anything/` (e.g. `knowledge-graph.json`)

## Prerequisites

- Node.js 22+ and pnpm 10 (via nvm/corepack is fine)
- `claude-local/.env` with `MINIMAX_API_KEY` set (copy from `claude-local/.env.example`)
- Built plugin core (`pnpm --filter @understand-anything/core build` — `start.sh` runs this if needed)

## Start the server

From the repo root:

```bash
./understand-agent/start.sh
```

Or via pnpm:

```bash
pnpm start:agent
```

The server prints both URLs when it starts:

```
understand-agent API:  http://127.0.0.1:8787
Understand Anything UI: http://127.0.0.1:5173/?token=...
```

Open the **UI URL** in your browser to explore the knowledge graph. The token is included automatically — you do not need to paste it into the gate. Run `POST /understand` via the API first if `.understand-anything/knowledge-graph.json` does not exist yet.

Set a stable token in `claude-local/.env` with `UNDERSTAND_ACCESS_TOKEN` (default: `understand-local-dev-token`). Disable auto-open with `UNDERSTAND_DASHBOARD_OPEN=false`.

## Port and host

| Service | Default | Env var |
|---------|---------|---------|
| Agent API | `http://127.0.0.1:8787` | `UNDERSTAND_AGENT_PORT`, `UNDERSTAND_AGENT_HOST` |
| Dashboard UI | `http://127.0.0.1:5173/?token=...` | `UNDERSTAND_DASHBOARD_PORT`, `UNDERSTAND_DASHBOARD_HOST` |
| Graph source | repo root | `UNDERSTAND_GRAPH_DIR` |

Agent API port examples:

| Method | Example |
|--------|---------|
| `claude-local/.env` | `UNDERSTAND_AGENT_PORT=8790` |
| Environment | `UNDERSTAND_AGENT_PORT=8790 ./understand-agent/start.sh` |
| CLI flag | `./understand-agent/start.sh --port 8790` |

Dashboard UI port: set `UNDERSTAND_DASHBOARD_PORT=5174` in `claude-local/.env` or the environment.

If the port is already in use, `./understand-agent/start.sh` stops the previous listener on that port automatically. To use a different port without stopping anything else:

```bash
UNDERSTAND_AGENT_PORT=8790 ./understand-agent/start.sh
```

Manual cleanup if needed:

```bash
lsof -i :8787
kill <pid>
```

## API

All `POST` bodies are JSON. `Content-Type: application/json` required.

### `GET /health`

Check that the server is running.

```bash
curl -s http://127.0.0.1:8787/health
```

Response includes `apiUrl`, `dashboardUrl`, `dashboardGraphDir`, `host`, `port`, `claudeConfigDir`, and `defaultProject`.

### `POST /understand`

Run the full Understand Anything analysis on a codebase (same as the `/understand` skill).

```bash
curl -s http://127.0.0.1:8787/understand \
  -H 'Content-Type: application/json' \
  -d '{
    "projectPath": "/path/to/repo",
    "full": false,
    "language": "en"
  }'
```

| Field | Required | Description |
|-------|----------|-------------|
| `projectPath` | No | Directory to analyze (default: this repo root) |
| `full` | No | Force full rebuild (`true` / `false`) |
| `language` | No | Output language (ISO code or name, e.g. `ja`, `zh-TW`) |
| `sessionId` | No | Resume a previous SDK session |

### `POST /explain`

Deep-dive explanation of a file or symbol (same as `/understand-explain`). Requires an existing knowledge graph unless the agent runs `/understand` first.

```bash
curl -s http://127.0.0.1:8787/explain \
  -H 'Content-Type: application/json' \
  -d '{
    "projectPath": "/path/to/repo",
    "target": "understand-agent/src/server.ts",
    "prompt": "How does port configuration work?"
  }'
```

| Field | Required | Description |
|-------|----------|-------------|
| `projectPath` | No | Project root (default: repo root) |
| `target` | Yes | File path or `path:symbol` |
| `prompt` | No | Extra question for the explanation |
| `sessionId` | No | Resume a previous session |

### `POST /chat`

Free-form request with the Understand Anything plugin loaded; Claude can invoke plugin skills as needed.

```bash
curl -s http://127.0.0.1:8787/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "projectPath": "/path/to/repo",
    "prompt": "Summarize the architecture and suggest an onboarding tour."
  }'
```

| Field | Required | Description |
|-------|----------|-------------|
| `projectPath` | No | Project root (default: repo root) |
| `prompt` | Yes | User message |
| `sessionId` | No | Resume a previous session |

## Response shape

Successful agent runs return JSON like:

```json
{
  "ok": true,
  "text": "Agent summary and logs…",
  "sessionId": "optional-session-id-for-resume",
  "knowledgeGraphPath": "/path/to/repo/.understand-anything/knowledge-graph.json"
}
```

Errors return `{ "ok": false, "error": "…" }` with HTTP 400/500.

## Architecture

```
understand-agent/
├── start.sh           # bootstrap + launch
├── src/
│   ├── server.ts      # HTTP routes
│   ├── agent.ts       # Claude SDK + skill prompts
│   ├── env.ts         # claude-local/.env → process env
│   └── bootstrap.ts   # plugin sync into claude-local cache
└── README.md

claude-local/          # isolated Claude config (not ~/.claude)
├── .env               # MINIMAX_API_KEY, UNDERSTAND_AGENT_PORT, …
└── .claude_config/    # settings, plugins, sessions
```

## Related

- Interactive Claude session: `./claude-local/claude.sh`
- Plugin source: `understand-anything-plugin/`
- Dashboard after analysis: `/understand-dashboard` (in Claude) or `pnpm dev:dashboard`
