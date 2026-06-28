import path from 'node:path';
import { ConnectorEvidence, Finding, LoopSpec, SkillDocument } from '../../shared/src/types';
import { readText } from '../../shared/src/fs';

export class SkillRuntime {
  constructor(private readonly workspaceRoot: string) {}

  async loadDiscoverySkill(loop: LoopSpec): Promise<SkillDocument> {
    const skillPath = path.join(
      this.workspaceRoot,
      'projects',
      loop.handoff.project,
      '.loop',
      'skills',
      `${loop.discovery.skill}.SKILL.md`
    );
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
