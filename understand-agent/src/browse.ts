import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface BrowseEntry {
  name: string;
  path: string;
}

export interface BrowseResult {
  ok: true;
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
}

function defaultBrowseRoot(): string {
  const home = os.homedir();
  const github = path.join(home, "Documents", "GitHub");
  if (fs.existsSync(github) && fs.statSync(github).isDirectory()) {
    return github;
  }
  return home;
}

function listDirectories(dirPath: string): BrowseEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(dirPath);
  } catch {
    return [];
  }

  const entries: BrowseEntry[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const fullPath = path.join(dirPath, name);
    try {
      if (fs.statSync(fullPath).isDirectory()) {
        entries.push({ name, path: fullPath });
      }
    } catch {
      // skip unreadable entries
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return entries;
}

export function listBrowsePath(requestedPath?: string): BrowseResult {
  const root = path.resolve(requestedPath?.trim() || defaultBrowseRoot());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  const parentDir = path.dirname(root);
  const parent = parentDir !== root ? parentDir : null;

  return {
    ok: true,
    path: root,
    parent,
    entries: listDirectories(root),
  };
}
