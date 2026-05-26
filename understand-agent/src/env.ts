import fs from "node:fs";
import dotenv from "dotenv";
import {
  CLAUDE_CONFIG_DIR,
  CLAUDE_LOCAL_ENV,
  PLUGIN_ROOT,
} from "./paths.js";
import { bootstrapClaudeLocal } from "./bootstrap.js";

const STRIP_EXACT = new Set(["TERM_PROGRAM", "TERM_PROGRAM_VERSION"]);
const STRIP_PREFIXES = ["VSCODE_", "ELECTRON_"];

export function loadClaudeLocalEnv(): NodeJS.ProcessEnv {
  bootstrapClaudeLocal();

  if (fs.existsSync(CLAUDE_LOCAL_ENV)) {
    dotenv.config({ path: CLAUDE_LOCAL_ENV });
  }

  const env: NodeJS.ProcessEnv = { ...process.env };

  for (const key of Object.keys(env)) {
    if (STRIP_EXACT.has(key) || STRIP_PREFIXES.some((p) => key.startsWith(p))) {
      delete env[key];
    }
  }

  env.TERM_PROGRAM = "xterm";
  env.CLAUDE_CONFIG_DIR = CLAUDE_CONFIG_DIR;
  env.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL ?? "https://api.minimax.io/anthropic";
  env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY ?? env.MINIMAX_API_KEY ?? "";
  env.ANTHROPIC_MODEL = env.ANTHROPIC_MODEL ?? "MiniMax-M2.7";
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? "MiniMax-M2.7";
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? "MiniMax-M2.7";
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "MiniMax-M2.7";
  env.API_TIMEOUT_MS = env.API_TIMEOUT_MS ?? "3000000";
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ?? "1";
  env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS ?? "1";
  env.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;
  env.UNDERSTAND_ACCESS_TOKEN =
    env.UNDERSTAND_ACCESS_TOKEN ?? "understand-local-dev-token";

  delete env.ANTHROPIC_AUTH_TOKEN;

  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      "Missing MINIMAX_API_KEY. Add it to claude-local/.env before starting understand-agent.",
    );
  }

  return env;
}

export async function withClaudeLocalEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env;
  const isolated = loadClaudeLocalEnv();
  process.env = isolated;
  try {
    return await fn();
  } finally {
    process.env = saved;
  }
}
