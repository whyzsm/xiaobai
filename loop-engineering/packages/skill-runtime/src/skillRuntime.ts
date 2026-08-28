import path from 'node:path';
import { ConnectorEvidence, Finding, LoopSpec, ProjectSpec, SkillDocument } from '../../shared/src/types';
import { pathExists, readText, readYamlFile } from '../../shared/src/fs';

export class SkillRuntime {
  constructor(private readonly workspaceRoot: string) {}

  async loadDiscoverySkill(loop: LoopSpec, projectId: string): Promise<SkillDocument> {
    const projectRoot = path.join(this.workspaceRoot, 'projects', projectId);
    const project = await readYamlFile<ProjectSpec>(path.join(projectRoot, '.loop', 'project.yaml'));
    const mappedSkill = project.discoverySkills?.[loop.discovery.skill];
    if (!mappedSkill) {
      throw new Error(`Discovery skill mapping is missing for project ${projectId}: ${loop.discovery.skill}`);
    }
    const skillPath = path.resolve(projectRoot, mappedSkill);
    const relative = path.relative(projectRoot, skillPath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Discovery skill mapping escapes project root: ${projectId}/${loop.discovery.skill}`);
    }
    if (!(await pathExists(skillPath))) {
      throw new Error(`Mapped discovery skill does not exist for project ${projectId}: ${skillPath}`);
    }
    const content = await readText(skillPath);
    const decisionRules = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^\d+\./.test(line) || line.startsWith('- '));

    return {
      id: loop.discovery.skill,
      path: skillPath,
      content,
      decisionRules
    };
  }

  selectFindings(evidence: ConnectorEvidence[]): Finding[] {
    const findings: Finding[] = [];

    for (const source of evidence) {
      for (const item of source.items) {
        const title = stringValue(item.title) ?? stringValue(item.name);
        if (!title) {
          continue;
        }

        const severity = stringValue(item.severity);
        const status = stringValue(item.status);
        const area = stringValue(item.area) ?? source.sourceType;
        const failureCount = numberValue(item.failureCount);

        if (severity === 'high' || status === 'failed' || (failureCount ?? 0) >= 2) {
          findings.push({
            id: `task-${String(findings.length + 1).padStart(3, '0')}`,
            title,
            evidence: [
              `${source.connectorId}:${source.sourceType}`,
              ...Object.entries(item).map(([key, value]) => `${key}=${String(value)}`)
            ],
            suspectedArea: area,
            suggestedNextAction: `Create an isolated worktree and investigate ${area}.`,
            riskLevel: severity === 'high' ? 'high' : 'medium'
          });
        }
      }
    }

    return findings;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
