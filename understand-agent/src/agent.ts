import fs from "node:fs";
import path from "node:path";
import {
  query,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { PLUGIN_ROOT } from "./paths.js";
import { withClaudeLocalEnv } from "./env.js";

export type AgentMode = "understand" | "explain" | "chat";

export interface RunAgentRequest {
  projectPath: string;
  mode: AgentMode;
  target?: string;
  prompt?: string;
  full?: boolean;
  language?: string;
  sessionId?: string;
}

export interface RunAgentResult {
  ok: boolean;
  text: string;
  sessionId?: string;
  knowledgeGraphPath?: string;
}

function resolveProjectPath(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Project path does not exist or is not a directory: ${resolved}`);
  }
  return resolved;
}

function buildPrompt(req: RunAgentRequest, projectPath: string): string {
  switch (req.mode) {
    case "understand": {
      const flags = [
        req.full ? "--full" : "",
        req.language ? `--language ${req.language}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return [
        "You are running as the Understand Anything agent.",
        `Project root: ${projectPath}`,
        `Run the /understand skill${flags ? ` with flags: ${flags}` : ""}.`,
        "Follow the skill instructions completely: scan, analyze, assemble the knowledge graph, and write `.understand-anything/knowledge-graph.json`.",
        "When finished, summarize what was analyzed and where artifacts were written.",
      ].join("\n");
    }
    case "explain": {
      if (!req.target) {
        throw new Error("explain mode requires target (file path or symbol)");
      }
      return [
        "You are running as the Understand Anything agent.",
        `Project root: ${projectPath}`,
        `Run the /understand-explain skill for: ${req.target}`,
        req.prompt ? `Additional question: ${req.prompt}` : "",
        "If the knowledge graph is missing, run /understand first.",
        "Return a clear explanation suitable for someone new to the codebase.",
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "chat":
      if (!req.prompt) {
        throw new Error("chat mode requires prompt");
      }
      return [
        "You are running as the Understand Anything agent with the understand-anything plugin loaded.",
        `Project root: ${projectPath}`,
        "Use plugin skills (/understand, /understand-explain, /understand-dashboard, etc.) when they fit the request.",
        "",
        req.prompt,
      ].join("\n");
    default:
      throw new Error(`Unknown mode: ${req.mode satisfies never}`);
  }
}

function collectText(messages: SDKMessage[]): { text: string; sessionId?: string; ok: boolean } {
  const parts: string[] = [];
  let sessionId: string | undefined;
  let ok = false;

  for (const message of messages) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          parts.push(block.text);
        }
      }
    }
    if (message.type === "result") {
      ok = message.subtype === "success";
      if ("result" in message && typeof message.result === "string") {
        parts.push(message.result);
      }
      if ("session_id" in message && typeof message.session_id === "string") {
        sessionId = message.session_id;
      }
    }
  }

  return { text: parts.join("\n").trim(), sessionId, ok };
}

export async function runAgent(req: RunAgentRequest): Promise<RunAgentResult> {
  const projectPath = resolveProjectPath(req.projectPath);
  const prompt = buildPrompt(req, projectPath);

  return withClaudeLocalEnv(async () => {
    const messages: SDKMessage[] = [];

    for await (const message of query({
      prompt,
      options: {
        cwd: projectPath,
        model: process.env.ANTHROPIC_MODEL,
        permissionMode: "bypassPermissions",
        settingSources: ["user"],
        plugins: [{ type: "local", path: PLUGIN_ROOT }],
        skills: "all",
        allowedTools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob", "Skill", "Agent"],
        resume: req.sessionId,
        maxTurns: 200,
      },
    })) {
      messages.push(message);
    }

    const { text, sessionId, ok } = collectText(messages);
    const graphPath = path.join(projectPath, ".understand-anything", "knowledge-graph.json");

    return {
      ok,
      text,
      sessionId,
      knowledgeGraphPath: fs.existsSync(graphPath) ? graphPath : undefined,
    };
  });
}
