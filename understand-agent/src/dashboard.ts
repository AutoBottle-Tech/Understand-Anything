import { execSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DASHBOARD_DIR, REPO_ROOT } from "./paths.js";

const DASHBOARD_URL_RE = /Dashboard URL:\s*(https?:\/\/[^\s]+)/;

export interface DashboardInfo {
  url: string;
  port: number;
  graphDir: string;
  token: string;
}

let dashboardProcess: ChildProcess | null = null;
let dashboardInfo: DashboardInfo | null = null;

function resolvePort(raw: string | undefined): number {
  const port = Number(raw ?? "5173");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid UNDERSTAND_DASHBOARD_PORT: ${raw ?? "(empty)"}`);
  }
  return port;
}

function freePort(port: number): void {
  try {
    const output = execSync(`lsof -ti :${port}`, { encoding: "utf8" }).trim();
    if (!output) return;
    for (const pid of output.split(/\s+/)) {
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {
        // ignore stale pid
      }
    }
  } catch {
    // port already free or lsof unavailable
  }
}

function buildDashboardUrl(host: string, port: number, token: string): string {
  const params = new URLSearchParams({ token });
  return `http://${host}:${port}/?${params.toString()}`;
}

function openBrowser(url: string): void {
  if (process.env.UNDERSTAND_DASHBOARD_OPEN === "false") {
    return;
  }
  try {
    if (process.platform === "darwin") {
      execSync(`open ${JSON.stringify(url)}`, { stdio: "ignore" });
    } else if (process.platform === "win32") {
      execSync(`start "" ${JSON.stringify(url)}`, { stdio: "ignore", shell: "cmd.exe" });
    } else {
      execSync(`xdg-open ${JSON.stringify(url)}`, { stdio: "ignore" });
    }
  } catch {
    // Browser open is best-effort.
  }
}

function waitForDashboardReady(child: ChildProcess, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks: string[] = [];

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    const scan = (text: string) => {
      chunks.push(text);
      if (DASHBOARD_URL_RE.test(chunks.join(""))) {
        finish();
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(text);
      scan(text);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      process.stderr.write(text);
      scan(text);
    });

    child.on("error", (error) => finish(error));
    child.on("exit", (code) => {
      if (!settled) {
        finish(new Error(`Dashboard exited before becoming ready (code ${code ?? "unknown"})`));
      }
    });

    const timer = setTimeout(() => {
      finish(new Error("Timed out waiting for Understand Anything dashboard"));
    }, timeoutMs);
  });
}

export function getDashboardInfo(): DashboardInfo | null {
  return dashboardInfo;
}

export async function startDashboard(graphDir: string = REPO_ROOT): Promise<DashboardInfo> {
  if (dashboardInfo) {
    return dashboardInfo;
  }

  const resolvedGraphDir = path.resolve(graphDir);
  if (!fs.existsSync(resolvedGraphDir)) {
    throw new Error(`Dashboard graph directory does not exist: ${resolvedGraphDir}`);
  }

  const host = process.env.UNDERSTAND_DASHBOARD_HOST ?? "127.0.0.1";
  const port = resolvePort(process.env.UNDERSTAND_DASHBOARD_PORT);
  const token = process.env.UNDERSTAND_ACCESS_TOKEN ?? "understand-local-dev-token";
  const url = buildDashboardUrl(host, port, token);

  freePort(port);

  if (!fs.existsSync(DASHBOARD_DIR)) {
    throw new Error(`Dashboard package not found: ${DASHBOARD_DIR}`);
  }

  const child = spawn(
    "pnpm",
    ["exec", "vite", "--host", host, "--port", String(port), "--open", "false"],
    {
      cwd: DASHBOARD_DIR,
      env: {
        ...process.env,
        GRAPH_DIR: resolvedGraphDir,
        UNDERSTAND_ACCESS_TOKEN: token,
        UNDERSTAND_AUTO_TOKEN: "1",
        UNDERSTAND_DISABLE_TOKEN: process.env.UNDERSTAND_DISABLE_TOKEN ?? "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  dashboardProcess = child;
  await waitForDashboardReady(child);

  dashboardInfo = {
    url,
    port,
    graphDir: resolvedGraphDir,
    token,
  };

  openBrowser(url);
  return dashboardInfo;
}

export async function restartDashboard(graphDir: string): Promise<DashboardInfo> {
  stopDashboard();
  return startDashboard(graphDir);
}

export function stopDashboard(): void {
  if (dashboardProcess && !dashboardProcess.killed) {
    dashboardProcess.kill("SIGTERM");
  }
  dashboardProcess = null;
  dashboardInfo = null;
}

process.on("SIGINT", stopDashboard);
process.on("SIGTERM", stopDashboard);
