import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { AGENT_ROOT } from "./paths.js";

const MAX_LOG_BYTES = 30 * 1024 * 1024;
const LOG_PATH = path.join(AGENT_ROOT, "data", "agent.log");

export interface LogEntry {
  ts: string;
  kind: "session.start" | "session.end" | "sdk" | "server" | "error";
  message: string;
  data?: unknown;
}

const emitter = new EventEmitter();
let activeAgentRuns = 0;

function ensureLogDir(): void {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
}

function trimLogFile(): void {
  if (!fs.existsSync(LOG_PATH)) return;
  const size = fs.statSync(LOG_PATH).size;
  if (size <= MAX_LOG_BYTES) return;

  const keepBytes = Math.floor(MAX_LOG_BYTES * 0.9);
  const startOffset = size - keepBytes;
  const fd = fs.openSync(LOG_PATH, "r");
  const buffer = Buffer.alloc(keepBytes);
  fs.readSync(fd, buffer, 0, keepBytes, startOffset);
  fs.closeSync(fd);

  let trimAt = buffer.indexOf("\n");
  if (trimAt < 0) trimAt = 0;
  else trimAt += 1;

  const trimmed = buffer.subarray(trimAt);
  const notice: LogEntry = {
    ts: new Date().toISOString(),
    kind: "server",
    message: `Log trimmed to stay under ${MAX_LOG_BYTES} bytes (removed ${size - trimmed.length} bytes from the start).`,
  };
  fs.writeFileSync(LOG_PATH, trimmed);
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(notice)}\n`, "utf8");
  emitter.emit("entry", notice);
}

function appendEntry(entry: LogEntry): void {
  ensureLogDir();
  const line = `${JSON.stringify(entry)}\n`;
  fs.appendFileSync(LOG_PATH, line, "utf8");
  if (fs.statSync(LOG_PATH).size > MAX_LOG_BYTES) {
    trimLogFile();
  }
  emitter.emit("entry", entry);
}

export function appendLog(
  kind: LogEntry["kind"],
  message: string,
  data?: unknown,
): void {
  appendEntry({
    ts: new Date().toISOString(),
    kind,
    message,
    ...(data === undefined ? {} : { data }),
  });
}

export function summarizeSdkMessage(message: SDKMessage): string {
  switch (message.type) {
    case "assistant": {
      const parts: string[] = [];
      for (const block of message.message.content) {
        if (block.type === "text") {
          parts.push(block.text);
        } else if (block.type === "tool_use") {
          parts.push(`tool_use ${block.name} ${JSON.stringify(block.input).slice(0, 400)}`);
        } else {
          parts.push(block.type);
        }
      }
      return parts.join("\n");
    }
    case "user":
      return typeof message.message.content === "string"
        ? message.message.content
        : JSON.stringify(message.message.content).slice(0, 800);
    case "result": {
      const bits = [`result ${message.subtype}`];
      if ("result" in message && typeof message.result === "string") {
        bits.push(message.result.slice(0, 800));
      }
      if ("errors" in message && Array.isArray(message.errors) && message.errors.length > 0) {
        bits.push(JSON.stringify(message.errors).slice(0, 800));
      }
      return bits.join("\n");
    }
    case "system":
      return `system ${message.subtype}${"data" in message ? `: ${JSON.stringify(message.data).slice(0, 400)}` : ""}`;
    default:
      return JSON.stringify(message).slice(0, 1200);
  }
}

export function logAgentStart(info: {
  mode: string;
  projectPath: string;
  prompt: string;
}): void {
  activeAgentRuns += 1;
  appendLog("session.start", `Agent run started (${info.mode})`, info);
}

export function logAgentMessage(message: SDKMessage): void {
  appendLog("sdk", summarizeSdkMessage(message), message);
}

export function logAgentEnd(info: {
  ok: boolean;
  mode: string;
  projectPath: string;
  sessionId?: string;
  knowledgeGraphPath?: string;
}): void {
  activeAgentRuns = Math.max(0, activeAgentRuns - 1);
  appendLog(
    "session.end",
    info.ok
      ? `Agent run finished successfully (${info.mode})`
      : `Agent run failed (${info.mode})`,
    info,
  );
}

export function logAgentError(error: unknown, context?: Record<string, unknown>): void {
  activeAgentRuns = Math.max(0, activeAgentRuns - 1);
  appendLog(
    "error",
    error instanceof Error ? error.message : String(error),
    { ...(context ?? {}), stack: error instanceof Error ? error.stack : undefined },
  );
}

export function logServerEvent(message: string, data?: unknown): void {
  appendLog("server", message, data);
}

export function isAgentRunning(): boolean {
  return activeAgentRuns > 0;
}

export function getLogPath(): string {
  return LOG_PATH;
}

export function readLogEntries(limit = 5000): LogEntry[] {
  if (!fs.existsSync(LOG_PATH)) return [];
  const raw = fs.readFileSync(LOG_PATH, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  const slice = lines.length > limit ? lines.slice(-limit) : lines;
  const entries: LogEntry[] = [];
  for (const line of slice) {
    try {
      entries.push(JSON.parse(line) as LogEntry);
    } catch {
      entries.push({
        ts: new Date().toISOString(),
        kind: "server",
        message: line,
      });
    }
  }
  return entries;
}

export function formatLogEntry(entry: LogEntry): string {
  const prefix = `[${entry.ts}] ${entry.kind}`;
  const body = entry.message.replace(/\s+$/, "");
  return `${prefix}  ${body}`;
}

export function readLogText(limit = 5000): string {
  return readLogEntries(limit).map(formatLogEntry).join("\n");
}

export function getLogStats(): { size: number; path: string; running: boolean } {
  const size = fs.existsSync(LOG_PATH) ? fs.statSync(LOG_PATH).size : 0;
  return { size, path: LOG_PATH, running: isAgentRunning() };
}

export function subscribeLogs(listener: (entry: LogEntry) => void): () => void {
  const handler = (entry: LogEntry) => listener(entry);
  emitter.on("entry", handler);
  return () => emitter.off("entry", handler);
}

export function clearLogs(): void {
  ensureLogDir();
  fs.writeFileSync(LOG_PATH, "");
  appendLog("server", "Log cleared.");
}
