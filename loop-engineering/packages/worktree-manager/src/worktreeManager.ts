import { execFile } from 'node:child_process';
import { appendFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathExists, readText } from '../../shared/src/fs';
import {
  Finding,
  GatePassEvidence,
  LoopSpec,
  WorkspaceLease,
  WorkspaceLeaseOwnerRole,
  WorktreePlan
} from '../../shared/src/types';
import { assertValidWorkspaceLease } from '../../shared/src/portableExecutionContracts';

const execFileAsync = promisify(execFile);

export interface WorktreePrepareInput {
  taskId: string;
  repositoryId: string;
  repositoryPath: string;
  projectId?: string;
  baseRef?: string;
  branch?: string;
  path?: string;
  now?: Date;
}

export interface WorktreeClaimInput {
  leaseId: string;
  ownerId: string;
  role?: WorkspaceLeaseOwnerRole;
  providerProfileId?: string;
  heartbeatIntervalMs?: number;
  now?: Date;
}

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

  leaseLogPath(): string {
    return path.join(this.workspaceRoot, '.local', 'worktree-leases', this.loop.metadata.id, 'leases.jsonl');
  }

  async prepare(input: WorktreePrepareInput): Promise<WorkspaceLease> {
    const now = input.now ?? new Date();
    const repositoryPath = path.resolve(input.repositoryPath);
    await requireDirectory(repositoryPath, 'repositoryPath');
    const leaseId = leaseIdFor(this.loop.metadata.id, input.taskId);
    if (await this.currentLease(leaseId)) throw new Error(`lease_already_exists: ${leaseId}`);
    const datePart = now.toISOString().slice(0, 10);
    const branch = input.branch ?? this.loop.handoff.branchTemplate
      .replace('{date}', datePart)
      .replace('{taskId}', input.taskId);
    const leasePath = input.path
      ? path.resolve(input.path)
      : path.join(this.workspaceRoot, this.loop.handoff.worktreeRoot, datePart, this.loop.metadata.id, input.taskId);
    assertPathInside(this.workspaceRoot, leasePath, 'worktree lease path');

    await execFileAsync('git', ['worktree', 'add', '-b', branch, leasePath, input.baseRef ?? 'HEAD'], {
      cwd: repositoryPath
    });

    const lease: WorkspaceLease = {
      kind: 'WorkspaceLease',
      version: 1,
      leaseId,
      taskId: input.taskId,
      projectId: input.projectId ?? this.projectId,
      repositoryId: input.repositoryId,
      repositoryPath,
      baseRef: input.baseRef ?? 'HEAD',
      branch,
      path: leasePath,
      state: 'prepared',
      dirtyPolicy: 'retain_dirty',
      evidence: [{ type: 'command', value: `git worktree add -b ${branch} ${leasePath} ${input.baseRef ?? 'HEAD'}` }],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
    await this.appendLease(lease);
    return lease;
  }

  async claim(input: WorktreeClaimInput): Promise<WorkspaceLease> {
    const current = await this.requireLease(input.leaseId);
    if ((current.state === 'claimed' || current.state === 'active') && current.owner?.role === 'writer') {
      throw new Error(`lease_already_owned: ${input.leaseId}`);
    }
    const now = input.now ?? new Date();
    const intervalMs = input.heartbeatIntervalMs ?? 60_000;
    const lease: WorkspaceLease = {
      ...current,
      state: 'claimed',
      owner: {
        id: input.ownerId,
        role: input.role ?? 'writer',
        providerProfileId: input.providerProfileId,
        claimedAt: now.toISOString()
      },
      heartbeat: {
        intervalMs,
        lastSeenAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + intervalMs * 2).toISOString()
      },
      evidence: [...current.evidence, { type: 'other', value: `lease claimed by ${input.ownerId}` }],
      updatedAt: now.toISOString()
    };
    await this.appendLease(lease);
    return lease;
  }

  async heartbeat(leaseId: string, now = new Date()): Promise<WorkspaceLease> {
    const current = await this.requireLease(leaseId);
    if (!current.owner || !current.heartbeat) throw new Error(`lease_not_claimed: ${leaseId}`);
    const lease: WorkspaceLease = {
      ...current,
      state: 'active',
      heartbeat: {
        ...current.heartbeat,
        lastSeenAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + current.heartbeat.intervalMs * 2).toISOString()
      },
      updatedAt: now.toISOString()
    };
    await this.appendLease(lease);
    return lease;
  }

  async recoverExpired(now = new Date()): Promise<WorkspaceLease[]> {
    const recovered: WorkspaceLease[] = [];
    for (const lease of await this.latestLeases()) {
      if ((lease.state !== 'claimed' && lease.state !== 'active') || !lease.heartbeat) continue;
      if (Date.parse(lease.heartbeat.expiresAt) > now.getTime()) continue;
      const dirty = await isDirtyWorktree(lease.path);
      const recoveredLease: WorkspaceLease = {
        ...lease,
        state: dirty ? 'dirty_retained' : 'stale',
        evidence: [
          ...lease.evidence,
          { type: 'other', value: dirty ? 'expired lease retained because worktree is dirty' : 'expired lease marked stale' }
        ],
        updatedAt: now.toISOString()
      };
      await this.appendLease(recoveredLease);
      recovered.push(recoveredLease);
    }
    return recovered;
  }

  async release(leaseId: string, now = new Date()): Promise<WorkspaceLease> {
    const current = await this.requireLease(leaseId);
    const dirty = await isDirtyWorktree(current.path);
    if (dirty) {
      const retained: WorkspaceLease = {
        ...current,
        state: 'dirty_retained',
        evidence: [...current.evidence, { type: 'other', value: 'release retained dirty worktree' }],
        updatedAt: now.toISOString()
      };
      await this.appendLease(retained);
      return retained;
    }

    if (await pathExists(current.path)) {
      assertPathInside(this.workspaceRoot, current.path, 'worktree release path');
      await execFileAsync('git', ['worktree', 'remove', current.path], { cwd: current.repositoryPath });
    }
    const released: WorkspaceLease = {
      ...current,
      state: 'released',
      evidence: [...current.evidence, { type: 'command', value: `git worktree remove ${current.path}` }],
      updatedAt: now.toISOString()
    };
    await this.appendLease(released);
    return released;
  }

  async currentLease(leaseId: string): Promise<WorkspaceLease | undefined> {
    const leases = await this.latestLeases();
    return leases.find((lease) => lease.leaseId === leaseId);
  }

  async latestLeases(): Promise<WorkspaceLease[]> {
    const latest = new Map<string, WorkspaceLease>();
    for (const lease of await this.readLeaseLog()) latest.set(lease.leaseId, lease);
    return [...latest.values()];
  }

  private async requireLease(leaseId: string): Promise<WorkspaceLease> {
    const lease = await this.currentLease(leaseId);
    if (!lease) throw new Error(`unknown_lease: ${leaseId}`);
    return lease;
  }

  private async readLeaseLog(): Promise<WorkspaceLease[]> {
    const filePath = this.leaseLogPath();
    if (!(await pathExists(filePath))) return [];
    const lines = (await readText(filePath)).split(/\r?\n/).filter((line) => line.trim().length > 0);
    return lines.map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch {
        throw new Error(`Invalid WorkspaceLease JSONL at ${filePath}:${index + 1}`);
      }
      assertValidWorkspaceLease(value);
      return value;
    });
  }

  private async appendLease(lease: WorkspaceLease): Promise<void> {
    assertValidWorkspaceLease(lease);
    const filePath = this.leaseLogPath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(lease)}\n`, 'utf8');
  }
}

async function requireDirectory(directory: string, label: string): Promise<void> {
  let stats;
  try {
    stats = await stat(directory);
  } catch {
    throw new Error(`${label} is not available: ${directory}`);
  }
  if (!stats.isDirectory()) throw new Error(`${label} is not a directory: ${directory}`);
}

async function isDirtyWorktree(worktreePath: string): Promise<boolean> {
  if (!(await pathExists(worktreePath))) return false;
  try {
    const result = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: worktreePath,
      encoding: 'utf8'
    });
    return result.stdout.trim().length > 0;
  } catch {
    return true;
  }
}

function leaseIdFor(loopId: string, taskId: string): string {
  return `${loopId}:${taskId}`;
}

function assertPathInside(root: string, candidate: string, label: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} must stay inside workspace root: ${resolvedCandidate}`);
  }
}
