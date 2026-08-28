import path from 'node:path';
import { RuntimePlan } from './types';

export type StandardPageArtifactName =
  | 'background-context.json'
  | 'evidence-selection.json'
  | 'page-contract.json'
  | 'import-rule.json';

const allStandardPageArtifacts: StandardPageArtifactName[] = [
  'background-context.json',
  'evidence-selection.json',
  'page-contract.json',
  'import-rule.json'
];

const stageArtifactRequirements: Record<string, StandardPageArtifactName[]> = {
  'page-contract-preflight': ['page-contract.json'],
  'frontend-implementation': allStandardPageArtifacts,
  'import-rule-verification': allStandardPageArtifacts,
  'page-structure-verification': allStandardPageArtifacts,
  'independent-evaluation': allStandardPageArtifacts,
  'delivery-summary': allStandardPageArtifacts
};

export function standardPageArtifactRoot(
  workspaceRoot: string,
  plan: RuntimePlan,
  taskId: string
): string | undefined {
  if (plan.loopId !== 'ane-standard-page') return undefined;
  const project = plan.projectRoute;
  if (!project) return undefined;
  const repositoryId = project.resolution.matchedRepositoryId;
  const repository = repositoryId
    ? project.repositories.find((item) => item.id === repositoryId)
    : project.repositories.length === 1
      ? project.repositories[0]
      : undefined;
  if (!repository) return undefined;
  const root = path.resolve(workspaceRoot, repository.mount);
  const relative = path.relative(path.resolve(workspaceRoot), root);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`XIAONENG_TASK_ARTIFACT_REPOSITORY_OUTSIDE_WORKSPACE: ${repository.id}`);
  }
  return path.join(root, '.xiaoneng', 'runtime', 'tasks', encodeURIComponent(taskId));
}

export function standardPageArtifactsForStage(stageId: string): StandardPageArtifactName[] {
  return [...(stageArtifactRequirements[stageId] ?? [])];
}

export function allStandardPageArtifactNames(): StandardPageArtifactName[] {
  return [...allStandardPageArtifacts];
}
