import http from "node:http";
import path from "node:path";
import { listBrowsePath } from "./browse.js";
import { loadClaudeLocalEnv } from "./env.js";
import { runAgent, type RunAgentRequest } from "./agent.js";
import { getDashboardInfo, restartDashboard, startDashboard } from "./dashboard.js";
import {
  createProject,
  ensureDefaultProject,
  getActiveProject,
  getProject,
  getProjectStatus,
  listProjects,
  resolveProjectPath,
  setActiveProject,
  type ProjectRecord,
} from "./projects.js";
import { serveStatic } from "./static.js";

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

interface JsonBody {
  projectId?: string;
  projectPath?: string;
  path?: string;
  name?: string;
  activate?: boolean;
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

function projectPayload(project: ProjectRecord) {
  return {
    ...project,
    status: getProjectStatus(project.path),
  };
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  const dashboard = getDashboardInfo();
  const activeProject = getActiveProject();

  if (req.method === "GET" && url.pathname === "/health") {
    const status = getProjectStatus(activeProject.path);
    sendJson(res, 200, {
      ok: true,
      service: "understand-agent",
      host: HOST,
      port: PORT,
      apiUrl: `http://${HOST}:${PORT}`,
      dashboardUrl: dashboard?.url ?? null,
      dashboardGraphDir: dashboard?.graphDir ?? activeProject.path,
      activeProject: projectPayload(activeProject),
      claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/projects") {
    sendJson(res, 200, {
      ok: true,
      activeProjectId: ensureDefaultProject().activeProjectId,
      projects: listProjects().map(projectPayload),
    });
    return;
  }

  const projectActivateMatch = url.pathname.match(/^\/projects\/([^/]+)\/activate$/);
  if (req.method === "POST" && projectActivateMatch) {
    const project = setActiveProject(decodeURIComponent(projectActivateMatch[1]!));
    const dashboardInfo = await restartDashboard(project.path);
    sendJson(res, 200, {
      ok: true,
      project: projectPayload(project),
      dashboardUrl: dashboardInfo.url,
      message: statusMessage(project),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/browse") {
    try {
      sendJson(res, 200, listBrowsePath(url.searchParams.get("path") ?? undefined));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 400, { ok: false, error: message });
    }
    return;
  }

  if (req.method === "GET" && serveStatic(url.pathname, res)) {
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 404, { ok: false, error: "Not found" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/projects") {
    const body = await readJson(req);
    if (!body.path) {
      sendJson(res, 400, { ok: false, error: "POST /projects requires path" });
      return;
    }
    const project = createProject(body.name ?? path.basename(body.path), body.path, body.activate ?? true);
    const dashboardInfo =
      body.activate === false ? getDashboardInfo() : await restartDashboard(project.path);
    sendJson(res, 201, {
      ok: true,
      project: projectPayload(project),
      dashboardUrl: dashboardInfo?.url ?? null,
      message: statusMessage(project),
    });
    return;
  }

  try {
    const body = await readJson(req);
    const project = resolveProjectPath({
      projectId: body.projectId,
      projectPath: body.projectPath,
    });
    let agentReq: RunAgentRequest;

    switch (url.pathname) {
      case "/understand":
        agentReq = {
          projectPath: project.path,
          mode: "understand",
          full: body.full,
          language: body.language,
          sessionId: body.sessionId,
        };
        break;
      case "/explain":
        agentReq = {
          projectPath: project.path,
          mode: "explain",
          target: body.target,
          prompt: body.prompt,
          sessionId: body.sessionId,
        };
        break;
      case "/chat":
        agentReq = {
          projectPath: project.path,
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
    const refreshed = getProject(project.id);
    let dashboardUrl = getDashboardInfo()?.url ?? null;
    if (result.ok && result.knowledgeGraphPath) {
      const active = getActiveProject();
      if (active.id !== project.id) {
        setActiveProject(project.id);
        dashboardUrl = (await restartDashboard(project.path)).url;
      }
    }
    sendJson(res, result.ok ? 200 : 500, {
      ...result,
      project: projectPayload(refreshed),
      dashboardUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: message });
  }
}

function statusMessage(project: ProjectRecord): string {
  const status = getProjectStatus(project.path);
  if (status.hasKnowledgeGraph) {
    return `Dashboard now viewing ${project.name}. Knowledge graph is ready.`;
  }
  return `Dashboard now viewing ${project.name}. No knowledge graph yet — run POST /understand with projectId "${project.id}".`;
}

async function main(): Promise<void> {
  const activeProject = getActiveProject();
  const status = getProjectStatus(activeProject.path);

  console.log("Starting Understand Anything dashboard...");
  const dashboard = await startDashboard(activeProject.path);

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
    console.log(`Control UI:            http://${HOST}:${PORT}/`);
    console.log(`Understand Anything UI: ${dashboard.url}`);
    console.log(`Active project:        ${activeProject.name} (${activeProject.id})`);
    console.log(`Project path:          ${activeProject.path}`);
    console.log("");
    if (!status.hasKnowledgeGraph) {
      console.log("No knowledge graph yet for the active project.");
      console.log(`Run: curl -s http://${HOST}:${PORT}/understand -H 'Content-Type: application/json' -d '{"projectId":"${activeProject.id}"}'`);
      console.log("");
    }
    console.log("  GET  /              Control UI (project picker + run analysis)");
    console.log("  GET  /health");
    console.log("  GET  /browse?path=  Browse folders for new projects");
    console.log("  GET  /projects");
    console.log('  POST /projects      { "name": "...", "path": "/path/to/repo", "activate": true }');
    console.log("  POST /projects/:id/activate");
    console.log('  POST /understand    { "projectId": "...", "full": false, "language": "en" }');
    console.log('  POST /explain       { "projectId": "...", "target": "src/foo.ts" }');
    console.log('  POST /chat          { "projectId": "...", "prompt": "..." }');
    console.log("");
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
