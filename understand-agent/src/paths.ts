import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const AGENT_ROOT = path.resolve(here, "..");
export const REPO_ROOT = path.resolve(AGENT_ROOT, "..");
export const CLAUDE_LOCAL_ROOT = path.join(REPO_ROOT, "claude-local");
export const CLAUDE_CONFIG_DIR = path.join(CLAUDE_LOCAL_ROOT, ".claude_config");
export const CLAUDE_LOCAL_ENV = path.join(CLAUDE_LOCAL_ROOT, ".env");
export const MARKETPLACE_JSON = path.join(CLAUDE_LOCAL_ROOT, ".claude-plugin", "marketplace.json");
export const PLUGIN_ROOT = path.join(REPO_ROOT, "understand-anything-plugin");
export const PLUGIN_MANIFEST = path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json");
export const DASHBOARD_DIR = path.join(PLUGIN_ROOT, "packages/dashboard");
