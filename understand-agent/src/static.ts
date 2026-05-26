import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { AGENT_ROOT } from "./paths.js";

const PUBLIC_DIR = path.join(AGENT_ROOT, "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function serveStatic(urlPath: string, res: http.ServerResponse): boolean {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return false;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  res.end(fs.readFileSync(filePath));
  return true;
}
