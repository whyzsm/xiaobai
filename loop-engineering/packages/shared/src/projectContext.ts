import path from 'node:path';
import { digestJsonHex } from './canonicalDigest';
import { LoopSpec, ProjectContext, ProjectRouteResolution, ProjectSpec } from './types';

interface ProjectRouteForContext {
  project: ProjectSpec;
  projectRoot: string;
  repository?: {
    id: string;
    mount: string;
  };
  resolution: ProjectRouteResolution;
}

export interface ProjectContextBuildInput {
  workspaceRoot: string;
  loop: LoopSpec;
  projectRoute: ProjectRouteForContext;
}

/**
 * Build the immutable project boundary used by every runtime plane.
 *
 * Paths are absolute here because this object is an execution boundary, not a
 * display DTO. Display projections remain responsible for redacting paths.
 */
export function buildProjectContext(input: ProjectContextBuildInput): ProjectContext {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const projectRoot = path.resolve(input.projectRoute.projectRoot);
  const project = input.projectRoute.project;
  const repositoryRoot = input.projectRoute.repository
    ? path.resolve(projectRoot, input.projectRoute.repository.mount)
    : path.resolve(projectRoot, project.root);
  const worktreeRoot = path.resolve(workspaceRoot, input.loop.handoff.worktreeRoot);
  const skillPackage = path.resolve(projectRoot, project.skill);
  const artifactRoot = path.resolve(
    workspaceRoot,
    '.loop',
    'artifacts',
    input.loop.metadata.id,
    project.id,
    input.projectRoute.repository?.id ?? '__project__'
  );
  const memoryNamespace = `project:${project.id}/loop:${input.loop.metadata.id}`;
  const policyDigest = digestJsonHex({
    projectId: project.id,
    repositoryId: input.projectRoute.repository?.id ?? null,
    resolution: {
      source: input.projectRoute.resolution.source,
      target: input.projectRoute.resolution.target ?? null,
      matchedRepositoryId: input.projectRoute.resolution.matchedRepositoryId ?? null,
      matchedRemote: input.projectRoute.resolution.matchedRemote ?? null,
      matchedPath: input.projectRoute.resolution.matchedPath ?? null
    },
    handoff: input.loop.handoff,
    verification: input.loop.verification,
    humanGate: input.loop.humanGate,
    // Include explicit bindings in the immutable policy digest. The legacy
    // background declaration is retained only as a compatibility input.
    contextBindings: [
      ...(project.knowledgeBindings ?? []),
      ...(project.contextBindings ?? [])
    ],
    background: project.background ?? null
  });

  return Object.freeze({
    projectId: project.id,
    repositoryRoot,
    worktreeRoot,
    skillPackage,
    memoryNamespace,
    artifactRoot,
    policyDigest
  });
}

export function projectContextDigestInput(context: ProjectContext): Record<string, string> {
  return {
    projectId: context.projectId,
    repositoryRoot: context.repositoryRoot,
    worktreeRoot: context.worktreeRoot,
    skillPackage: context.skillPackage,
    memoryNamespace: context.memoryNamespace,
    artifactRoot: context.artifactRoot,
    policyDigest: context.policyDigest
  };
}

export function displayProjectContext(
  workspaceRoot: string,
  context: ProjectContext
): ProjectContext {
  const display = (value: string): string => {
    const relative = path.relative(path.resolve(workspaceRoot), value);
    return relative === '..' || relative.startsWith(`..${path.sep}`) ? value : relative;
  };

  return Object.freeze({
    ...context,
    repositoryRoot: display(context.repositoryRoot),
    worktreeRoot: display(context.worktreeRoot),
    skillPackage: display(context.skillPackage),
    artifactRoot: display(context.artifactRoot)
  });
}

export function projectContextMatchesRoute(
  context: ProjectContext,
  route: {
    projectId: string;
    resolution: ProjectRouteResolution;
  }
): boolean {
  return context.projectId === route.projectId;
}
