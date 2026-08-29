import { access, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { LoopSpec, ProjectSpec } from './types';

export interface SkillPackageAssetPlan {
  projectId: string;
  /** Absolute package mount root. */
  root: string;
  /**
   * false when the declared mount root does not exist (for example a CI
   * checkout without local mounts). Declared assets are then unreachable and
   * package loops stay out of discovery; a present mount with missing files
   * is a hard error instead.
   */
  available: boolean;
  declaredLoopIds: Set<string>;
  declaredAgentNames: Set<string>;
  /** loopId -> absolute loop spec path inside the package. */
  loops: Map<string, string>;
  /** basename -> absolute agent/harness path inside the package. */
  agents: Map<string, string>;
}

export async function resolveSkillPackageAssets(
  projectRoot: string,
  project: ProjectSpec
): Promise<SkillPackageAssetPlan | undefined> {
  const assets = project.background?.integration?.assets;
  const background = project.background;
  if (!assets || !background) return undefined;

  const root = path.resolve(projectRoot, background.mount);
  const plan: SkillPackageAssetPlan = {
    projectId: project.id,
    root,
    available: false,
    declaredLoopIds: new Set(Object.keys(assets.loops ?? {})),
    declaredAgentNames: new Set(
      (assets.agents ?? []).map((relativePath) => packageBasename(relativePath))
    ),
    loops: new Map(),
    agents: new Map()
  };
  if (!(await fileExists(root))) return plan;
  plan.available = true;
  const packageRoot = await realpath(root);
  plan.root = packageRoot;

  for (const [loopId, relativePath] of Object.entries(assets.loops ?? {})) {
    plan.loops.set(loopId, await requirePackageFile(packageRoot, relativePath, `loop ${loopId}`, project.id));
  }
  for (const relativePath of assets.agents ?? []) {
    const file = await requirePackageFile(packageRoot, relativePath, 'agent', project.id);
    plan.agents.set(packageBasename(relativePath), file);
  }
  return plan;
}

export async function resolveSkillPackageAssetsForLoop(
  workspaceRoot: string,
  loop: LoopSpec
): Promise<SkillPackageAssetPlan | undefined> {
  const entries = await loadProjectEntries(workspaceRoot);
  const matches = entries.filter(({ project }) => project.id === loop.handoff.project);
  if (matches.length > 1) {
    throw new Error(`Project id is ambiguous for skill package resolution: ${loop.handoff.project}`);
  }
  const entry = matches[0];
  return entry ? resolveSkillPackageAssets(entry.projectRoot, entry.project) : undefined;
}

export interface SkillPackageLoopDiscovery {
  declaredIds: Set<string>;
  paths: string[];
  pathsById: Map<string, string>;
}

export async function discoverSkillPackageLoops(workspaceRoot: string): Promise<SkillPackageLoopDiscovery> {
  const entries = await loadProjectEntries(workspaceRoot);
  const declaredIds = new Set<string>();
  const pathsById = new Map<string, string>();

  for (const entry of entries) {
    const declarations = entry.project.background?.integration?.assets?.loops ?? {};
    for (const loopId of Object.keys(declarations)) {
      if (declaredIds.has(loopId)) {
        throw new Error(`Skill package loop is declared by multiple projects: ${loopId}`);
      }
      declaredIds.add(loopId);
    }

    const plan = await resolveSkillPackageAssets(entry.projectRoot, entry.project);
    if (!plan?.available) continue;
    for (const [loopId, loopPath] of plan.loops) pathsById.set(loopId, loopPath);
  }

  return { declaredIds, paths: [...pathsById.values()].sort(), pathsById };
}

export async function findSkillPackageLoopSpec(
  workspaceRoot: string,
  loopId: string
): Promise<string | undefined> {
  const discovery = await discoverSkillPackageLoops(workspaceRoot);
  if (!discovery.declaredIds.has(loopId)) return undefined;
  const loopPath = discovery.pathsById.get(loopId);
  if (!loopPath) {
    throw new Error(`Skill package mount unavailable for declared loop: ${loopId}`);
  }
  return loopPath;
}

export function resolveSkillPackageAgentPath(
  plan: SkillPackageAssetPlan | undefined,
  fileName: string
): string | undefined {
  if (!plan) return undefined;
  const name = packageBasename(fileName);
  if (!plan.declaredAgentNames.has(name)) return undefined;
  if (!plan.available) {
    throw new Error(`Skill package mount unavailable for declared agent: ${name}`);
  }
  const file = plan.agents.get(name);
  if (!file) throw new Error(`Skill package agent declaration is unresolved: ${name}`);
  return file;
}

interface ProjectEntry {
  project: ProjectSpec;
  projectRoot: string;
}

async function loadProjectEntries(workspaceRoot: string): Promise<ProjectEntry[]> {
  const projectsRoot = path.join(workspaceRoot, 'projects');
  let projectDirs;
  try {
    projectDirs = (await readdir(projectsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return [];
    throw error;
  }

  const entries: ProjectEntry[] = [];
  for (const projectDir of projectDirs) {
    const projectRoot = path.join(projectsRoot, projectDir);
    const projectPath = path.join(projectRoot, '.loop', 'project.yaml');
    if (!(await fileExists(projectPath))) continue;
    entries.push({
      projectRoot,
      project: YAML.parse(await readFile(projectPath, 'utf8')) as ProjectSpec
    });
  }
  return entries;
}

function packageBasename(relativePath: string): string {
  return path.posix.basename(relativePath.replaceAll('\\', '/'));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function requirePackageFile(
  root: string,
  relativePath: string,
  what: string,
  projectId: string
): Promise<string> {
  const file = path.resolve(root, relativePath);
  const lexicalRelative = path.relative(root, file);
  if (lexicalRelative === '..' || lexicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(lexicalRelative)) {
    throw new Error(`skill package ${what} escapes package root for project ${projectId}: ${relativePath}`);
  }
  if (!(await fileExists(file))) {
    // Fail closed: the mount is present, so a broken declaration is drift, not a missing environment.
    throw new Error(`skill package ${what} is declared but missing for project ${projectId}: ${relativePath}`);
  }
  const canonicalFile = await realpath(file);
  const canonicalRelative = path.relative(root, canonicalFile);
  if (canonicalRelative === '..' || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)) {
    throw new Error(`skill package ${what} escapes package root for project ${projectId}: ${relativePath}`);
  }
  if (!(await stat(canonicalFile)).isFile()) {
    throw new Error(`skill package ${what} is declared but not a file for project ${projectId}: ${relativePath}`);
  }
  return canonicalFile;
}
