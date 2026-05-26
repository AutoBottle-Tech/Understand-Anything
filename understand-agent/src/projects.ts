import fs from "node:fs";
import path from "node:path";
import { AGENT_ROOT, REPO_ROOT } from "./paths.js";

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRegistry {
  activeProjectId: string | null;
  projects: Record<string, ProjectRecord>;
}

export interface ProjectStatus {
  hasKnowledgeGraph: boolean;
  knowledgeGraphPath: string;
  metaPath: string;
}

const REGISTRY_PATH = path.join(AGENT_ROOT, "data", "projects.json");
const DEFAULT_PROJECT_ID = "understand-anything";

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

function uniqueId(base: string, projects: Record<string, ProjectRecord>): string {
  if (!projects[base]) return base;
  let i = 2;
  while (projects[`${base}-${i}`]) i += 1;
  return `${base}-${i}`;
}

function loadRegistry(): ProjectRegistry {
  if (!fs.existsSync(REGISTRY_PATH)) {
    return { activeProjectId: null, projects: {} };
  }
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8")) as ProjectRegistry;
}

function saveRegistry(registry: ProjectRegistry): void {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
}

export function ensureDefaultProject(): ProjectRegistry {
  const registry = loadRegistry();
  if (Object.keys(registry.projects).length > 0) {
    if (!registry.activeProjectId && registry.projects[DEFAULT_PROJECT_ID]) {
      registry.activeProjectId = DEFAULT_PROJECT_ID;
      saveRegistry(registry);
    }
    return registry;
  }

  const now = new Date().toISOString();
  registry.projects[DEFAULT_PROJECT_ID] = {
    id: DEFAULT_PROJECT_ID,
    name: "Understand Anything",
    path: REPO_ROOT,
    createdAt: now,
    updatedAt: now,
  };
  registry.activeProjectId = DEFAULT_PROJECT_ID;
  saveRegistry(registry);
  return registry;
}

export function listProjects(): ProjectRecord[] {
  const registry = ensureDefaultProject();
  return Object.values(registry.projects).sort((a, b) => a.name.localeCompare(b.name));
}

export function getActiveProject(): ProjectRecord {
  const registry = ensureDefaultProject();
  const activeId = registry.activeProjectId ?? DEFAULT_PROJECT_ID;
  const project = registry.projects[activeId];
  if (!project) {
    throw new Error(`Active project "${activeId}" is not registered.`);
  }
  return project;
}

export function getProject(id: string): ProjectRecord {
  const registry = ensureDefaultProject();
  const project = registry.projects[id];
  if (!project) {
    throw new Error(`Unknown project id: ${id}`);
  }
  return project;
}

export function getProjectStatus(projectPath: string): ProjectStatus {
  const root = path.resolve(projectPath);
  const knowledgeGraphPath = path.join(root, ".understand-anything", "knowledge-graph.json");
  const metaPath = path.join(root, ".understand-anything", "meta.json");
  return {
    hasKnowledgeGraph: fs.existsSync(knowledgeGraphPath),
    knowledgeGraphPath,
    metaPath,
  };
}

export function createProject(name: string, projectPath: string, activate = true): ProjectRecord {
  const resolved = path.resolve(projectPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Project path does not exist or is not a directory: ${resolved}`);
  }

  const registry = ensureDefaultProject();
  const id = uniqueId(slugify(name), registry.projects);
  const now = new Date().toISOString();
  const record: ProjectRecord = {
    id,
    name: name.trim() || path.basename(resolved),
    path: resolved,
    createdAt: now,
    updatedAt: now,
  };

  registry.projects[id] = record;
  if (activate) {
    registry.activeProjectId = id;
  }
  saveRegistry(registry);
  return record;
}

export function setActiveProject(id: string): ProjectRecord {
  const registry = ensureDefaultProject();
  const project = registry.projects[id];
  if (!project) {
    throw new Error(`Unknown project id: ${id}`);
  }
  registry.activeProjectId = id;
  project.updatedAt = new Date().toISOString();
  saveRegistry(registry);
  return project;
}

export function resolveProjectPath(options: {
  projectId?: string;
  projectPath?: string;
}): ProjectRecord {
  if (options.projectId) {
    return getProject(options.projectId);
  }
  if (options.projectPath) {
    const resolved = path.resolve(options.projectPath);
    const registry = ensureDefaultProject();
    const existing = Object.values(registry.projects).find(
      (project) => path.resolve(project.path) === resolved,
    );
    if (existing) return existing;
    return createProject(path.basename(resolved), resolved, false);
  }
  return getActiveProject();
}
