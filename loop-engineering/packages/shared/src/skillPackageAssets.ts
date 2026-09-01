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
  const declarationsById = new Map<string, string>();

  for (const entry of entries) {
    const declarations = entry.project.background?.integration?.assets?.loops ?? {};
    const plan = await resolveSkillPackageAssets(entry.projectRoot, entry.project);
    for (const loopId of Object.keys(declarations)) {
      const relativePath = declarations[loopId];
      const packageRoot = plan?.root ?? path.resolve(entry.projectRoot, entry.project.background?.mount ?? '.');
      const declarationPath = path.resolve(packageRoot, relativePath);
      const declarationKey = declarationPath;
      const previousPath = declarationsById.get(loopId);
      if (previousPath && previousPath !== declarationKey) {
        throw new Error(`Skill package loop is declared by multiple projects: ${loopId}`);
      }
      declaredIds.add(loopId);
      declarationsById.set(loopId, declarationKey);
    }

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

interface ProjectSourceRecord {
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

  const records: ProjectSourceRecord[] = [];
  for (const projectDir of projectDirs) {
    const projectRoot = path.join(projectsRoot, projectDir);
    const projectPath = path.join(projectRoot, '.loop', 'project.yaml');
    if (!(await fileExists(projectPath))) continue;
    const project = YAML.parse(await readFile(projectPath, 'utf8')) as ProjectSpec;
    records.push({ projectRoot, project });
  }

  const catalogs = new Map(
    records
      .filter(({ project }) => project.role === 'catalog')
      .map((record) => [record.project.id, record]),
  );
  const standaloneIds = new Set(
    records.filter(({ project }) => isStandaloneProject(project)).map(({ project }) => project.id),
  );
  const entries: ProjectEntry[] = [];
  for (const record of records) {
    const { projectRoot } = record;
    let project = record.project;
    if (isStandaloneProject(project) && project.catalogId) {
      const catalog = catalogs.get(project.catalogId);
      if (!catalog) throw new Error(`Standalone Project '${project.id}' references a missing catalog '${project.catalogId}'`);
      project = materializeStandaloneProject(project, catalog.project, catalog.projectRoot, projectRoot);
      entries.push({ projectRoot, project });
      continue;
    }
    if (project.kind !== 'ProjectGroup' || !project.children) {
      entries.push({ projectRoot, project });
      continue;
    }
    const declaredChildrenRoot = path.resolve(projectRoot, project.children.directory);
    if (!(await fileExists(declaredChildrenRoot))) continue;
    const childrenRoot = await resolveExistingWithin(projectRoot, declaredChildrenRoot, 'ProjectGroup children directory');
    const childDirectories = (await readdir(childrenRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const childDirectory of childDirectories) {
      const childRoot = path.join(childrenRoot, childDirectory);
      const childPath = path.join(childRoot, '.loop', 'project.yaml');
      if (!(await fileExists(childPath))) continue;
      const childConfigPath = await resolveExistingWithin(childRoot, childPath, 'ProjectGroup child configuration');
      const child = YAML.parse(await readFile(childConfigPath, 'utf8')) as ProjectSpec;
      if (child.kind !== 'Project' || child.parentGroup !== project.id) continue;
      if (standaloneIds.has(child.id)) continue;
      entries.push({
        projectRoot: childRoot,
        project: materializeChildProject(project, child, projectRoot, childRoot)
      });
    }
  }
  return entries;
}

function isStandaloneProject(project: ProjectSpec): boolean {
  return project.kind === 'Project' && project.role === 'standalone';
}

function materializeStandaloneProject(
  project: ProjectSpec,
  catalog: ProjectSpec,
  catalogRoot: string,
  projectRoot: string,
): ProjectSpec {
  const background = catalog.background
    ? { ...catalog.background, mount: rebasePath(catalogRoot, projectRoot, catalog.background.mount), integration: catalog.background.integration }
    : undefined;
  const discoverySkills = catalog.discoverySkills
    ? Object.fromEntries(Object.entries(catalog.discoverySkills).map(([id, value]) => [id, rebasePath(catalogRoot, projectRoot, value)]))
    : undefined;
  const skill = catalog.skill ? rebasePath(catalogRoot, projectRoot, catalog.skill) : undefined;
  return {
    ...catalog,
    ...project,
    kind: 'Project',
    role: 'standalone',
    catalogId: project.catalogId ?? catalog.id,
    parentGroup: project.parentGroup ?? catalog.id,
    skill: project.skill ?? skill ?? 'SKILL.md',
    ...(project.background ? {} : background ? { background } : {}),
    ...(project.discoverySkills ? {} : discoverySkills ? { discoverySkills } : {}),
    ...(project.sharedContext ? {} : catalog.sharedContext ? { sharedContext: catalog.sharedContext } : {}),
  };
}

function materializeChildProject(
  group: ProjectSpec,
  child: ProjectSpec,
  groupRoot: string,
  childRoot: string
): ProjectSpec {
  const background = group.background
    ? { ...group.background, mount: rebasePath(groupRoot, childRoot, group.background.mount) }
    : undefined;
  const discoverySkills = group.discoverySkills
    ? Object.fromEntries(Object.entries(group.discoverySkills).map(([id, value]) => [id, rebasePath(groupRoot, childRoot, value)]))
    : undefined;
  return {
    ...group,
    ...child,
    kind: 'Project',
    role: 'standalone',
    catalogId: child.catalogId ?? group.id,
    parentGroup: child.parentGroup ?? group.id,
    skill: child.skill ?? rebasePath(groupRoot, childRoot, group.skill),
    ...(child.background ? {} : background ? { background } : {}),
    ...(child.discoverySkills ? {} : discoverySkills ? { discoverySkills } : {})
  };
}

function rebasePath(fromRoot: string, toRoot: string, relativePath: string): string {
  return path.relative(toRoot, path.resolve(fromRoot, relativePath)) || '.';
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

async function resolveExistingWithin(root: string, candidate: string, label: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const canonicalCandidate = await realpath(candidate);
  const relativePath = path.relative(canonicalRoot, canonicalCandidate);
  if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error(`${label} escapes its ProjectGroup root`);
  }
  return canonicalCandidate;
}
