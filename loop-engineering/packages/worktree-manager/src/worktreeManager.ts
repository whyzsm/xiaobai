import path from 'node:path';
import { Finding, LoopSpec, WorktreePlan } from '../../shared/src/types';

export class WorktreeManager {
  constructor(
    private readonly workspaceRoot: string,
    private readonly loop: LoopSpec,
    private readonly projectId = loop.handoff.project
  ) {}

  plan(findings: Finding[], date = new Date()): WorktreePlan[] {
    const datePart = date.toISOString().slice(0, 10);
    const worktreeRoot = path.join(this.workspaceRoot, this.loop.handoff.worktreeRoot, datePart, this.loop.metadata.id);

    return findings.map((finding) => ({
      taskId: finding.id,
      loopId: this.loop.metadata.id,
      project: this.projectId,
      branch: this.loop.handoff.branchTemplate
        .replace('{date}', datePart)
        .replace('{taskId}', finding.id),
      path: path.join(worktreeRoot, finding.id),
      finding
    }));
  }
}
