import http from "node:http";
import path from "node:path";
import { REPO_ROOT } from "./paths.js";
import { loadClaudeLocalEnv } from "./env.js";
import { runAgent, type RunAgentRequest } from "./agent.js";
import { getDashboardInfo, startDashboard } from "./dashboard.js";

const env = loadClaudeLocalEnv();
Object.assign(process.env, env);

function resolvePort(raw: string | undefined): number {
  const port = Number(raw ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid UNDERSTAND_AGENT_PORT: ${raw ?? "(empty)"}`);
  }
  return port;
}

const PORT = resolvePort(process.env.UNDERSTAND_AGENT_PORT);
const HOST = process.env.UNDERSTAND_AGENT_HOST ?? "127.0.0.1";
const GRAPH_DIR = path.resolve(process.env.UNDERSTAND_GRAPH_DIR ?? REPO_ROOT);

interface JsonBody {
  projectPath?: string;
  target?: string;
  prompt?: string;
  full?: boolean;
  language?: string;
  sessionId?: string;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

async function readJson(req: http.IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonBody;
}

function defaultProjectPath(body: JsonBody): string {
  return path.resolve(body.projectPath ?? GRAPH_DIR);
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  const dashboard = getDashboardInfo();

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "understand-agent",
      host: HOST,
      port: PORT,
      apiUrl: `http://${HOST}:${PORT}`,
      dashboardUrl: dashboard?.url ?? null,
      dashboardGraphDir: dashboard?.graphDir ?? GRAPH_DIR,
      claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
      defaultProject: GRAPH_DIR,
    });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 404, { ok: false, error: "Not found" });
    return;
  }

  try {
    const body = await readJson(req);
    const projectPath = defaultProjectPath(body);
    let agentReq: RunAgentRequest;

    switch (url.pathname) {
      case "/understand":
        agentReq = {
          projectPath,
          mode: "understand",
          full: body.full,
          language: body.language,
          sessionId: body.sessionId,
        };
        break;
      case "/explain":
        agentReq = {
          projectPath,
          mode: "explain",
          target: body.target,
          prompt: body.prompt,
          sessionId: body.sessionId,
        };
        break;
      case "/chat":
        agentReq = {
          projectPath,
          mode: "chat",
          prompt: body.prompt,
          sessionId: body.sessionId,
        };
        break;
      default:
        sendJson(res, 404, { ok: false, error: "Not found" });
        return;
    }

    const result = await runAgent(agentReq);
    sendJson(res, result.ok ? 200 : 500, {
      ...result,
      dashboardUrl: getDashboardInfo()?.url ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

async function main(): Promise<void> {
  console.log("Starting Understand Anything dashboard...");
  const dashboard = await startDashboard(GRAPH_DIR);

  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use on ${HOST}.`);
      console.error(`Set a different port: UNDERSTAND_AGENT_PORT=8790 ./understand-agent/start.sh`);
      console.error(`Or stop the existing process: lsof -i :${PORT}`);
      process.exit(1);
    }
    throw error;
  });

  server.listen(PORT, HOST, () => {
    console.log("");
    console.log(`understand-agent API:  http://${HOST}:${PORT}`);
    console.log(`Understand Anything UI: ${dashboard.url}`);
    console.log(`Graph directory:       ${dashboard.graphDir}`);
    console.log("");
    console.log("  GET  /health");
    console.log('  POST /understand  { "projectPath": "...", "full": false, "language": "en" }');
    console.log('  POST /explain     { "projectPath": "...", "target": "src/foo.ts" }');
    console.log('  POST /chat        { "projectPath": "...", "prompt": "..." }');
    console.log("");
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
