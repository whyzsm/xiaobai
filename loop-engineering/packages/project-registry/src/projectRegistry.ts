import path from 'node:path';
import { readdir, realpath } from 'node:fs/promises';
import {
  LoopSpec,
  ProjectRepository,
  ProjectRouteResolution,
  ProjectRouteSource,
  ProjectSpec
} from '../../shared/src/types';
import { pathExists, readYamlFile } from '../../shared/src/fs';

interface ProjectLocalPaths {
  background?: Record<string, string | { path?: string }>;
  repositories?: Record<string, string | { path?: string }>;
}

interface ProjectRegistryEntry {
  project: ProjectSpec;
  projectRoot: string;
  localPaths?: ProjectLocalPaths;
  childProjectIds?: string[];
}

interface ProjectMatch {
  entry: ProjectRegistryEntry;
  repository?: ProjectRepository;
  source: ProjectRouteSource;
  target?: string;
  matchedRemote?: string;
  matchedPath?: string;
}

export interface ProjectRouteRequest {
  targetProject?: string;
  targetRepository?: string;
  targetCwd?: string;
  targetRemote?: string;
}

export interface ResolvedProjectRoute {
  project: ProjectSpec;
  projectRoot: string;
  repository?: ProjectRepository;
  resolution: ProjectRouteResolution;
}

export async function resolveProjectRoute(
  workspaceRoot: string,
  loop: LoopSpec,
  request: ProjectRouteRequest = {}
): Promise<ResolvedProjectRoute> {
  const entries = await loadProjectRegistry(workspaceRoot);

  if (request.targetProject) {
    return buildRoute(
      requireSingleMatch(
        findProjectMatches(entries, request.targetProject, 'explicit-project'),
        'project',
        request.targetProject
      )
    );
  }

  if (request.targetRepository) {
    return buildRoute(
      requireSingleMatch(
        findRepositoryMatches(entries, request.targetRepository, 'explicit-repository'),
        'repository',
        request.targetRepository
      )
    );
  }

  if (request.targetCwd) {
    return buildRoute(
      requireSingleMatch(findCwdMatches(entries, request.targetCwd), 'cwd', request.targetCwd)
    );
  }

  if (request.targetRemote) {
    return buildRoute(
      requireSingleMatch(findRemoteMatches(entries, request.targetRemote, 'remote'), 'remote', request.targetRemote)
    );
  }

  throw new Error(
    `Loop ${loop.metadata.id} requires a target project or repository explicitly. Pass --target-project, --target-repository, --target-cwd, or --target-remote.`
  );
}

async function loadProjectRegistry(workspaceRoot: string): Promise<ProjectRegistryEntry[]> {
  const projectsRoot = path.join(workspaceRoot, 'projects');
  const projectDirs = (await readdir(projectsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const entries: ProjectRegistryEntry[] = [];
  for (const projectDir of projectDirs) {
    const projectRoot = path.join(projectsRoot, projectDir);
    const projectPath = path.join(projectRoot, '.loop', 'project.yaml');
    if (!(await pathExists(projectPath))) {
      continue;
    }

    const project = await readYamlFile<ProjectSpec>(projectPath);
    const localPathsPath = project.localPaths ? path.join(projectRoot, project.localPaths) : undefined;
    const localPaths = localPathsPath && (await pathExists(localPathsPath))
      ? await readYamlFile<ProjectLocalPaths>(localPathsPath)
      : undefined;
    const children = await loadChildProjectEntries(project, projectRoot, workspaceRoot, localPaths);
    entries.push({
      project,
      projectRoot,
      localPaths,
      ...(children.length > 0 ? { childProjectIds: children.map(({ project: child }) => child.id) } : {})
    });
    entries.push(...children);
  }

  return entries;
}

async function loadChildProjectEntries(
  group: ProjectSpec,
  groupRoot: string,
  workspaceRoot: string,
  groupLocalPaths?: ProjectLocalPaths
): Promise<ProjectRegistryEntry[]> {
  if (group.kind !== 'ProjectGroup' || !group.children) return [];
  const declaredChildrenRoot = resolveWithin(groupRoot, group.children.directory, 'ProjectGroup children directory');
  if (!(await pathExists(declaredChildrenRoot))) {
    throw new Error(`ProjectGroup '${group.id}' children directory is missing: ${path.relative(workspaceRoot, declaredChildrenRoot)}`);
  }
  const childrenRoot = await resolveExistingWithin(groupRoot, declaredChildrenRoot, 'ProjectGroup children directory');
  const childDirectories = (await readdir(childrenRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const entries: ProjectRegistryEntry[] = [];
  for (const directory of childDirectories) {
    const childRoot = path.join(childrenRoot, directory);
    const childPath = path.join(childRoot, '.loop', 'project.yaml');
    if (!(await pathExists(childPath))) continue;
    const childConfigPath = await resolveExistingWithin(childRoot, childPath, 'ProjectGroup child configuration');
    const child = await readYamlFile<ProjectSpec>(childConfigPath);
    if (child.kind !== 'Project') {
      throw new Error(`ProjectGroup '${group.id}' child '${directory}' must use kind: Project`);
    }
    if (child.parentGroup !== group.id) {
      throw new Error(`Project '${child.id ?? directory}' must declare parentGroup: ${group.id}`);
    }
    const expectedShared = typeof group.sharedContext === 'object'
      ? group.sharedContext.id
      : group.children.sharedContext ?? group.sharedContext;
    const actualShared = typeof child.sharedContext === 'string' ? child.sharedContext : child.sharedContext?.id;
    if (expectedShared && actualShared !== expectedShared) {
      throw new Error(`Project '${child.id ?? directory}' must reference shared context '${expectedShared}'`);
    }
    const localPathsPath = child.localPaths
      ? path.resolve(childRoot, child.localPaths)
      : group.localPaths
        ? path.resolve(groupRoot, group.localPaths)
        : undefined;
    const localPaths = localPathsPath && (await pathExists(localPathsPath))
      ? await readYamlFile<ProjectLocalPaths>(localPathsPath)
      : groupLocalPaths;
    entries.push({
      project: materializeChildProject(group, child, groupRoot, childRoot),
      projectRoot: childRoot,
      localPaths
    });
  }
  if (group.children.requireSingleRepository !== false) {
    for (const entry of entries) {
      if ((entry.project.repositories ?? []).length !== 1) {
        throw new Error(`Project '${entry.project.id}' must declare exactly one repository`);
      }
    }
  }
  return entries;
}

function materializeChildProject(
  group: ProjectSpec,
  child: ProjectSpec,
  groupRoot: string,
  childRoot: string
): ProjectSpec {
  const inheritedBackground = group.background
    ? {
        ...group.background,
        mount: rebasePath(groupRoot, childRoot, group.background.mount),
        integration: group.background.integration
      }
    : undefined;
  const inheritedDiscoverySkills = group.discoverySkills
    ? Object.fromEntries(
        Object.entries(group.discoverySkills).map(([id, value]) => [id, rebasePath(groupRoot, childRoot, value)])
      )
    : undefined;
  const inheritedSkill = group.skill ? rebasePath(groupRoot, childRoot, group.skill) : child.skill;
  return {
    ...group,
    ...child,
    kind: 'Project',
    root: child.root ?? '.',
    skill: child.skill ?? inheritedSkill ?? 'SKILL.md',
    ...(child.discoverySkills ? {} : inheritedDiscoverySkills ? { discoverySkills: inheritedDiscoverySkills } : {}),
    ...(child.background ? {} : inheritedBackground ? { background: inheritedBackground } : {}),
    ...(child.sharedContext ? {} : group.sharedContext ? { sharedContext: group.sharedContext } : {})
  };
}

function resolveWithin(root: string, relativePath: string, label: string): string {
  const resolved = path.resolve(root, relativePath);
  if (!containsPath(root, resolved)) throw new Error(`${label} escapes its ProjectGroup root`);
  return resolved;
}

async function resolveExistingWithin(root: string, candidate: string, label: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const canonicalCandidate = await realpath(candidate);
  if (!containsPath(canonicalRoot, canonicalCandidate)) {
    throw new Error(`${label} escapes its ProjectGroup root`);
  }
  return canonicalCandidate;
}

function rebasePath(fromRoot: string, toRoot: string, relativePath: string): string {
  const resolved = path.resolve(fromRoot, relativePath);
  return path.relative(toRoot, resolved) || '.';
}

function findProjectMatches(
  entries: ProjectRegistryEntry[],
  target: string,
  source: ProjectRouteSource
): ProjectMatch[] {
  return entries
    .filter((entry) =>
      [entry.project.id, entry.project.name, path.basename(entry.projectRoot)].some((alias) => sameAlias(alias, target))
    )
    .map((entry) => ({
      entry,
      source,
      target
    }));
}

function findRepositoryMatches(
  entries: ProjectRegistryEntry[],
  target: string,
  source: ProjectRouteSource
): ProjectMatch[] {
  const matches: ProjectMatch[] = [];
  for (const entry of entries) {
    if (entry.childProjectIds && entry.childProjectIds.length > 0) continue;
    for (const repository of entry.project.repositories ?? []) {
      const aliases = [repository.id, repository.name, repository.localPathKey].filter(
        (alias): alias is string => Boolean(alias)
      );
      if (aliases.some((alias) => sameAlias(alias, target)) || sameRemote(repository.remote, target)) {
        matches.push({
          entry,
          repository,
          source,
          target,
          matchedRemote: sameRemote(repository.remote, target) ? repository.remote : undefined
        });
      }
    }
  }
  return matches;
}

function findRemoteMatches(
  entries: ProjectRegistryEntry[],
  target: string,
  source: ProjectRouteSource
): ProjectMatch[] {
  const matches: ProjectMatch[] = [];
  for (const entry of entries) {
    if (entry.childProjectIds && entry.childProjectIds.length > 0) continue;
    for (const repository of entry.project.repositories ?? []) {
      if (sameRemote(repository.remote, target)) {
        matches.push({
          entry,
          repository,
          source,
          target,
          matchedRemote: repository.remote
        });
      }
    }
  }
  return matches;
}

function findCwdMatches(entries: ProjectRegistryEntry[], targetCwd: string): ProjectMatch[] {
  const cwd = path.resolve(targetCwd);
  const matches: ProjectMatch[] = [];

  for (const entry of entries) {
    if (entry.childProjectIds && entry.childProjectIds.length > 0) continue;
    const projectRootMount = path.resolve(entry.projectRoot, entry.project.root);
    if (containsPath(projectRootMount, cwd)) {
      matches.push({
        entry,
        source: 'cwd',
        target: targetCwd,
        matchedPath: projectRootMount
      });
    }

    if (entry.project.background) {
      const backgroundMount = path.resolve(entry.projectRoot, entry.project.background.mount);
      const backgroundLocalPath = configuredLocalPath(entry.localPaths?.background, entry.project.background.localPathKey);
      for (const candidate of [backgroundMount, backgroundLocalPath].filter((value): value is string => Boolean(value))) {
        if (containsPath(candidate, cwd)) {
          matches.push({
            entry,
            source: 'cwd',
            target: targetCwd,
            matchedPath: candidate
          });
        }
      }
    }

    for (const repository of entry.project.repositories ?? []) {
      const repositoryMount = path.resolve(entry.projectRoot, repository.mount);
      const repositoryLocalPath = repository.localPathKey
        ? configuredLocalPath(entry.localPaths?.repositories, repository.localPathKey)
        : undefined;
      for (const candidate of [repositoryMount, repositoryLocalPath].filter((value): value is string => Boolean(value))) {
        if (containsPath(candidate, cwd)) {
          matches.push({
            entry,
            repository,
            source: 'cwd',
            target: targetCwd,
            matchedPath: candidate
          });
        }
      }
    }
  }

  return keepMostSpecificPathMatches(matches);
}

function buildRoute(match: ProjectMatch): ResolvedProjectRoute {
  return {
    project: match.entry.project,
    projectRoot: match.entry.projectRoot,
    repository: match.repository,
    resolution: {
      source: match.source,
      target: match.target,
      matchedRepositoryId: match.repository?.id,
      matchedRemote: match.matchedRemote,
      matchedPath: match.matchedPath
    }
  };
}

function requireSingleMatch(matches: ProjectMatch[], label: string, target: string): ProjectMatch {
  const unique = dedupeMatches(matches);
  if (unique.length === 0) {
    throw new Error(`Target ${label} is not mapped to any project: ${target}`);
  }
  if (unique.length > 1) {
    const candidates = unique
      .map((match) => {
        const repository = match.repository ? `/${match.repository.id}` : '';
        return `${match.entry.project.id}${repository}`;
      })
      .sort()
      .join(', ');
    throw new Error(`Target ${label} is ambiguous: ${target}. Candidates: ${candidates}`);
  }
  if (unique[0].entry.childProjectIds && unique[0].entry.childProjectIds.length > 0 && !unique[0].repository) {
    throw new Error(
      `Target project '${target}' is a ProjectGroup and cannot be used as an execution target. Choose a child Project: ${unique[0].entry.childProjectIds.join(', ')}`
    );
  }
  return unique[0];
}

function dedupeMatches(matches: ProjectMatch[]): ProjectMatch[] {
  const seen = new Set<string>();
  const unique: ProjectMatch[] = [];
  for (const match of matches) {
    const key = `${match.entry.project.id}:${match.repository?.id ?? ''}:${match.matchedPath ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(match);
  }
  return unique;
}

function keepMostSpecificPathMatches(matches: ProjectMatch[]): ProjectMatch[] {
  if (matches.length <= 1) {
    return matches;
  }

  const longestLength = Math.max(...matches.map((match) => match.matchedPath?.length ?? 0));
  return matches.filter((match) => (match.matchedPath?.length ?? 0) === longestLength);
}

function configuredLocalPath(
  section: Record<string, string | { path?: string }> | undefined,
  key: string
): string | undefined {
  const value = section?.[key];
  if (typeof value === 'string') {
    return path.resolve(expandHome(value));
  }
  if (value?.path) {
    return path.resolve(expandHome(value.path));
  }
  return undefined;
}

function expandHome(value: string): string {
  return value.replace(/^~(?=$|[/\\])/, process.env.HOME ?? '');
}

function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function sameAlias(left: string | undefined, right: string | undefined): boolean {
  return normalizeAlias(left) === normalizeAlias(right);
}

function normalizeAlias(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sameRemote(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeRemote(left);
  const normalizedRight = normalizeRemote(right);
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function normalizeRemote(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\.git$/, '');
}
