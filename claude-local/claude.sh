#!/usr/bin/env bash
# Launch an isolated Claude Code session for Understand-Anything.
#
# All config, plugins, and state live under claude-local/ only.
# Does NOT modify ~/.claude, repo-root .claude/, or ~/.understand-anything-plugin.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_DIR="$SCRIPT_DIR/.claude_config"
PLUGIN_ROOT="$REPO_ROOT/understand-anything-plugin"
MARKETPLACE_JSON="$SCRIPT_DIR/.claude-plugin/marketplace.json"
ENV_FILE="$SCRIPT_DIR/.env"
PLUGIN_ID="understand-anything@understand-anything"

bootstrap_toolchain() {
  if [[ -z "${PNPM_BIN:-}" ]] && ! command -v pnpm >/dev/null 2>&1; then
    if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
      # shellcheck disable=SC1090,SC1091
      source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    elif [[ -x /opt/homebrew/bin/brew ]] && [[ -d "$(/opt/homebrew/bin/brew --prefix node 2>/dev/null)/bin" ]]; then
      export PATH="$(/opt/homebrew/bin/brew --prefix node)/bin:$PATH"
    fi
  fi

  if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@10.6.2 --activate >/dev/null 2>&1 || true
  fi

  if ! command -v pnpm >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    PNPM_BIN="npm exec --yes -- pnpm"
  elif command -v pnpm >/dev/null 2>&1; then
    PNPM_BIN="pnpm"
  else
    echo "pnpm not found on PATH." >&2
    echo "Install Node.js 22+ and pnpm, or run: corepack enable && corepack prepare pnpm@10.6.2 --activate" >&2
    exit 1
  fi
}

read_plugin_version() {
  if command -v node >/dev/null 2>&1; then
    node -p "require('$PLUGIN_ROOT/.claude-plugin/plugin.json').version"
  else
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
      "$PLUGIN_ROOT/.claude-plugin/plugin.json" | head -1
  fi
}

ensure_understand_anything_plugin() {
  local version cache_dir

  if ! command -v claude >/dev/null 2>&1; then
    return 0
  fi

  if ! CLAUDE_CONFIG_DIR="$CONFIG_DIR" claude plugin list 2>/dev/null \
    | grep -q "understand-anything@understand-anything"; then
    echo "Installing understand-anything plugin into claude-local..."
    CLAUDE_CONFIG_DIR="$CONFIG_DIR" claude plugin install "$PLUGIN_ID" --scope user
  fi

  version="$(read_plugin_version)"
  cache_dir="$CONFIG_DIR/plugins/cache/understand-anything/understand-anything/$version"

  echo "Syncing local understand-anything plugin into claude-local cache..."
  mkdir -p "$(dirname "$cache_dir")"
  rm -rf "$cache_dir"
  cp -R "$PLUGIN_ROOT" "$cache_dir"

  CLAUDE_CONFIG_DIR="$CONFIG_DIR" claude plugin enable "$PLUGIN_ID" >/dev/null 2>&1 || true
}

if [[ ! -d "$CONFIG_DIR" ]]; then
  echo "Missing Claude config directory: $CONFIG_DIR" >&2
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
elif [[ ! -f "$CONFIG_DIR/settings.local.json" ]]; then
  echo "Missing $ENV_FILE" >&2
  echo "Copy claude-local/.env.example to claude-local/.env and set MINIMAX_API_KEY." >&2
  exit 1
fi

export CLAUDE_CONFIG_DIR="$CONFIG_DIR"
export ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-https://api.minimax.io/anthropic}"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-${MINIMAX_API_KEY:-}}"
export ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-MiniMax-M2.7}"
export ANTHROPIC_DEFAULT_SONNET_MODEL="${ANTHROPIC_DEFAULT_SONNET_MODEL:-MiniMax-M2.7}"
export ANTHROPIC_DEFAULT_OPUS_MODEL="${ANTHROPIC_DEFAULT_OPUS_MODEL:-MiniMax-M2.7}"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="${ANTHROPIC_DEFAULT_HAIKU_MODEL:-MiniMax-M2.7}"
export API_TIMEOUT_MS="${API_TIMEOUT_MS:-3000000}"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="${CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:-1}"
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS="${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-1}"

if [[ -z "${ANTHROPIC_API_KEY}" ]]; then
  echo "ANTHROPIC_API_KEY / MINIMAX_API_KEY is not set." >&2
  echo "Add your key to claude-local/.env" >&2
  exit 1
fi

if [[ ! -f "$MARKETPLACE_JSON" ]]; then
  echo "Missing marketplace catalog: $MARKETPLACE_JSON" >&2
  exit 1
fi

cat > "$CONFIG_DIR/settings.local.json" <<EOF
{
  "\$schema": "https://json.schemastore.org/claude-code-settings.json",
  "extraKnownMarketplaces": {
    "understand-anything": {
      "source": {
        "source": "file",
        "path": "$MARKETPLACE_JSON"
      }
    }
  },
  "enabledPlugins": {
    "understand-anything@understand-anything": true
  }
}
EOF

# Skill fallback path, scoped to claude-local only (not ~/.understand-anything-plugin).
ln -sfn "$PLUGIN_ROOT" "$SCRIPT_DIR/.understand-anything-plugin"

# Avoid inheriting global Claude auth/env that would bypass claude-local settings.
unset ANTHROPIC_AUTH_TOKEN 2>/dev/null || true

while IFS= read -r name; do
  case "$name" in
    VSCODE_*|ELECTRON_*)
      unset "$name" 2>/dev/null || true
      ;;
  esac
done < <(compgen -e)
unset TERM_PROGRAM TERM_PROGRAM_VERSION 2>/dev/null || true
export TERM_PROGRAM=xterm

if [[ ! -f "$PLUGIN_ROOT/packages/core/dist/index.js" ]]; then
  bootstrap_toolchain
  echo "Building understand-anything plugin..."
  if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
    echo "Installing dependencies..."
    (cd "$REPO_ROOT" && $PNPM_BIN install)
  fi
  (cd "$REPO_ROOT" && $PNPM_BIN --filter @understand-anything/core build)
fi

ensure_understand_anything_plugin

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found on PATH." >&2
  echo "Install Claude Code: https://code.claude.com/docs/en/setup" >&2
  exit 1
fi

cd "$REPO_ROOT"
exec env CLAUDE_CONFIG_DIR="$CONFIG_DIR" \
  claude --dangerously-skip-permissions --model "${ANTHROPIC_MODEL}" "$@"
