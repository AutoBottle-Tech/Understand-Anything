#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_LOCAL_ENV="$REPO_ROOT/claude-local/.env"

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
    --dashboard-port)
      export UNDERSTAND_DASHBOARD_PORT="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--port PORT] [--dashboard-port PORT]"
      echo ""
      echo "Stops understand-agent and the dashboard UI by freeing their ports."
      echo ""
      echo "Environment variables (also read from claude-local/.env):"
      echo "  UNDERSTAND_AGENT_PORT      default: 8787"
      echo "  UNDERSTAND_DASHBOARD_PORT  default: 5173"
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
export UNDERSTAND_DASHBOARD_PORT="${UNDERSTAND_DASHBOARD_PORT:-5173}"

kill_port() {
  local label="$1"
  local port="$2"
  local pids
  pids="$(lsof -ti :"$port" 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    echo "$label: nothing listening on port $port"
    return 0
  fi

  echo "$label: stopping process(es) on port $port ($pids)..."
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 0.5
  pids="$(lsof -ti :"$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi

  if lsof -ti :"$port" >/dev/null 2>&1; then
    echo "$label: failed to free port $port" >&2
    return 1
  fi
  echo "$label: port $port is free"
}

kill_port "understand-agent" "$UNDERSTAND_AGENT_PORT"
kill_port "dashboard" "$UNDERSTAND_DASHBOARD_PORT"
