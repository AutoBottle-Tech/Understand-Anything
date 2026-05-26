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

## Stop the server

```bash
./understand-agent/stop.sh
```

Or:

```bash
pnpm stop:agent
```

This kills whatever is listening on the agent port (`8787` by default) and dashboard port (`5173` by default). `start.sh` also frees those ports automatically before launching, so you usually only need `stop.sh` when you want to shut down without restarting.

Custom ports:

```bash
UNDERSTAND_AGENT_PORT=8790 UNDERSTAND_DASHBOARD_PORT=5174 ./understand-agent/stop.sh
```

The server prints both URLs when it starts:

```
understand-agent API:  http://127.0.0.1:8787
Control UI:            http://127.0.0.1:8787/
Understand Anything UI: http://127.0.0.1:5173/?token=...
```

Open the **Control UI** at `http://127.0.0.1:8787/` to pick projects, browse folders, save new projects, and run `/understand` without curl.

Open the **Dashboard UI** in your browser to explore the knowledge graph after analysis completes.

**Important:** the dashboard needs a completed analysis first. If you see `No knowledge graph found. Run /understand first.`, run `POST /understand` on the active project (see Projects below), then refresh the dashboard.

Set a stable token in `claude-local/.env` with `UNDERSTAND_ACCESS_TOKEN` (default: `understand-local-dev-token`). When using `understand-agent`, the token is injected automatically and the paste gate is disabled (`UNDERSTAND_DISABLE_TOKEN=1`). Disable auto-open with `UNDERSTAND_DASHBOARD_OPEN=false`.

## Projects

Projects are stored in `understand-agent/data/projects.json` (gitignored). Each project points at a codebase root; Understand Anything writes artifacts to `<project-path>/.understand-anything/`.

On first start, a default project is registered for this repo (`understand-anything`).

### List projects

```bash
curl -s http://127.0.0.1:8787/projects
```

### Register a new project

```bash
curl -s http://127.0.0.1:8787/projects \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "My Other App",
    "path": "/path/to/other/repo",
    "activate": true
  }'
```

Setting `"activate": true` switches the dashboard to that project and restarts the UI server.

### Activate an existing project

```bash
curl -s -X POST http://127.0.0.1:8787/projects/my-other-app/activate
```

### Analyze a project

Use `projectId` (preferred) or `projectPath` on agent calls:

```bash
curl -s http://127.0.0.1:8787/understand \
  -H 'Content-Type: application/json' \
  -d '{ "projectId": "understand-anything", "full": false }'
```

After analysis completes, refresh the dashboard to load the new graph.

## Port and host

| Service | Default | Env var |
|---------|---------|---------|
| Agent API | `http://127.0.0.1:8787` | `UNDERSTAND_AGENT_PORT`, `UNDERSTAND_AGENT_HOST` |
| Dashboard UI | `http://127.0.0.1:5173/?token=...` | `UNDERSTAND_DASHBOARD_PORT`, `UNDERSTAND_DASHBOARD_HOST` |
| Graph source | active project path | set via Projects API; legacy fallback `UNDERSTAND_GRAPH_DIR` |

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
| `projectPath` | No | Directory to analyze (default: active project) |
| `projectId` | No | Registered project id (preferred over `projectPath`) |
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
| `projectPath` | No | Project root (default: active project) |
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
| `projectPath` | No | Project root (default: active project) |
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
