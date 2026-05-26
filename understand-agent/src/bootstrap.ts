import fs from "node:fs";
import path from "node:path";
import {
  CLAUDE_CONFIG_DIR,
  CLAUDE_LOCAL_ROOT,
  MARKETPLACE_JSON,
  PLUGIN_MANIFEST,
  PLUGIN_ROOT,
} from "./paths.js";

const PLUGIN_ID = "understand-anything@understand-anything";

function readPluginVersion(): string {
  const raw = fs.readFileSync(PLUGIN_MANIFEST, "utf8");
  const match = raw.match(/"version"\s*:\s*"([^"]+)"/);
  if (!match) {
    throw new Error(`Cannot read plugin version from ${PLUGIN_MANIFEST}`);
  }
  return match[1]!;
}

export function writeClaudeLocalSettingsLocal(): void {
  fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true });
  const settingsLocal = {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    extraKnownMarketplaces: {
      "understand-anything": {
        source: {
          source: "file",
          path: MARKETPLACE_JSON,
        },
      },
    },
    enabledPlugins: {
      [PLUGIN_ID]: true,
    },
  };
  fs.writeFileSync(
    path.join(CLAUDE_CONFIG_DIR, "settings.local.json"),
    `${JSON.stringify(settingsLocal, null, 2)}\n`,
  );
}

export function syncPluginCache(): string {
  const version = readPluginVersion();
  const cacheDir = path.join(
    CLAUDE_CONFIG_DIR,
    "plugins",
    "cache",
    "understand-anything",
    "understand-anything",
    version,
  );

  fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.cpSync(PLUGIN_ROOT, cacheDir, { recursive: true });

  const symlinkPath = path.join(CLAUDE_LOCAL_ROOT, ".understand-anything-plugin");
  fs.rmSync(symlinkPath, { recursive: true, force: true });
  fs.symlinkSync(PLUGIN_ROOT, symlinkPath);

  return cacheDir;
}

export function bootstrapClaudeLocal(): void {
  if (!fs.existsSync(MARKETPLACE_JSON)) {
    throw new Error(`Missing marketplace: ${MARKETPLACE_JSON}`);
  }
  writeClaudeLocalSettingsLocal();
  syncPluginCache();
}
