#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_LOCAL_ENV="$REPO_ROOT/claude-local/.env"

if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck disable=SC1090,SC1091
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
fi

if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@10.6.2 --activate >/dev/null 2>&1 || true
fi

if [[ -f "$CLAUDE_LOCAL_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$CLAUDE_LOCAL_ENV"
  set +a
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      export UNDERSTAND_AGENT_PORT="$2"
      shift 2
      ;;
    --host)
      export UNDERSTAND_AGENT_HOST="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--port PORT] [--host HOST]"
      echo ""
      echo "Environment variables (also read from claude-local/.env):"
      echo "  UNDERSTAND_AGENT_PORT      default: 8787"
      echo "  UNDERSTAND_AGENT_HOST      default: 127.0.0.1"
      echo "  UNDERSTAND_DASHBOARD_PORT  default: 5173"
      echo "  UNDERSTAND_DASHBOARD_HOST  default: 127.0.0.1"
      echo "  UNDERSTAND_GRAPH_DIR       default: repo root"
      echo ""
      echo "If the port is busy, start.sh stops the previous listener on that port automatically."
      exit 0
      ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        export UNDERSTAND_AGENT_PORT="$1"
        shift
      else
        echo "Unknown argument: $1" >&2
        exit 1
      fi
      ;;
  esac
done

export UNDERSTAND_AGENT_PORT="${UNDERSTAND_AGENT_PORT:-8787}"
export UNDERSTAND_AGENT_HOST="${UNDERSTAND_AGENT_HOST:-127.0.0.1}"
export UNDERSTAND_DASHBOARD_PORT="${UNDERSTAND_DASHBOARD_PORT:-5173}"
export UNDERSTAND_DASHBOARD_HOST="${UNDERSTAND_DASHBOARD_HOST:-127.0.0.1}"
export UNDERSTAND_GRAPH_DIR="${UNDERSTAND_GRAPH_DIR:-$REPO_ROOT}"

free_port_if_stale() {
  local port="$1"
  local pids
  pids="$(lsof -ti :"$port" 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  echo "Port $port is in use; stopping previous listener..."
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 0.5
  pids="$(lsof -ti :"$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

free_port_if_stale "$UNDERSTAND_AGENT_PORT"
free_port_if_stale "$UNDERSTAND_DASHBOARD_PORT"

if [[ ! -f "$REPO_ROOT/understand-anything-plugin/packages/core/dist/index.js" ]]; then
  echo "Building understand-anything core..."
  (cd "$REPO_ROOT" && pnpm --filter @understand-anything/core build)
fi

cd "$SCRIPT_DIR"
pnpm install
exec pnpm start
