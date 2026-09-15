import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  ProjectRepository,
  ProjectSpec,
  TaskContextLock,
  XiguaRuntimePlan
} from '../../shared/src/types';

const execFileAsync = promisify(execFile);
const CONSUMER_AGENT = 'xigua-agent';
const DEFAULT_ENTRY_PATH = 'AGENT.md';
const REQUIREMENT_URL_PATTERN = /https?:\/\/[^\s"'<>）】]+/g;

type JsonObject = Record<string, unknown>;

export interface XiguaContextRequest {
  sourceRoot: string;
  projectRoot?: string;
  project: ProjectSpec;
  targetRepository: ProjectRepository;
  taskId: string;
  /** Entry file inside the source root; defaults to AGENT.md. */
  entryPath?: string;
  /** Raw request text consumed read-only for requirement intake. */
  requestText?: string;
  consumerAgent?: string;
  authorizedActions?: string[];
  now?: Date;
}

/**
 * Resolves the mounted Xigua source-backed runtime. Fails closed on a missing
 * source root, missing entry file, unreadable entry, or an unavailable source
 * git HEAD; it never falls back to a native Xiaobai executor.
 */
export async function resolveXiguaRuntime(request: XiguaContextRequest): Promise<XiguaRuntimePlan> {
  const sourceRoot = await resolveDirectory(request.sourceRoot, 'Xigua source root');
  const entryRelativePath = normalizeEntryPath(request.entryPath ?? DEFAULT_ENTRY_PATH);
  const entryPath = await resolveSourceFile(sourceRoot, entryRelativePath, 'xigua entry');
  const entryContent = await readFile(entryPath, 'utf8');
  const entryHash = sha256(entryContent);
  const agentId = readAgentName(entryContent);
  const [sourceCommit, sourceStatus] = await Promise.all([
    readGitHead(sourceRoot),
    gitOutput(sourceRoot, ['status', '--short', '--untracked-files=all'])
  ]);
  const sourceWorktreeStatus = sourceStatus ? sourceStatus.split('\n').filter(Boolean) : [];
  const sourceDirty = sourceWorktreeStatus.length > 0;
  const sourceFingerprint = sha256(stableJson({ sourceCommit, entryHash, sourceWorktreeStatus }));
  const targetMount = await resolveDirectory(
    path.resolve(request.projectRoot ?? process.cwd(), request.targetRepository.mount),
    'target repository mount'
  );
  const consumedAt = (request.now ?? new Date()).toISOString();

  const contextBase = {
    provider: 'xigua' as const,
    agentId,
    entryPath: relativePath(sourceRoot, entryPath),
    entryHash,
    sourceCommit,
    sourceDirty,
    sourceWorktreeStatus,
    sourceFingerprint
  };
  const skillContext: XiguaRuntimePlan['skillContext'] = {
    ...contextBase,
    contextDigest: sha256(stableJson(contextBase))
  };
  const sourceConsumption: XiguaRuntimePlan['sourceConsumption'] = {
    sourceRoot,
    entryPath: relativePath(sourceRoot, entryPath),
    entryHash,
    sourceFingerprint,
    consumedBy: request.consumerAgent ?? CONSUMER_AGENT,
    consumedAt
  };
  const requirementIntake: XiguaRuntimePlan['requirementIntake'] = {
    status: 'started',
    requirementSources: extractRequirementSources(request.requestText)
  };
  const taskContextLock = await createTaskContextLock({
    request,
    targetMount,
    backgroundMount: sourceRoot,
    lockedAt: consumedAt
  });

  return { skillContext, sourceConsumption, requirementIntake, taskContextLock };
}

/**
 * Extracts read-only requirement sources (for example a Yuque URL) from the
 * raw request text. The route-only slice records that intake started; it never
 * fetches the requirement or writes business source.
 */
export function extractRequirementSources(requestText?: string): string[] {
  if (!requestText) {
    return [];
  }
  const matches = requestText.match(REQUIREMENT_URL_PATTERN) ?? [];
  return [...new Set(matches.map((match) => match.replace(/[.,;:!?]+$/, '')))];
}

async function createTaskContextLock(input: {
  request: XiguaContextRequest;
  targetMount: string;
  backgroundMount: string;
  lockedAt: string;
}): Promise<TaskContextLock> {
  const [branch, head, status] = await Promise.all([
    gitOutput(input.targetMount, ['branch', '--show-current']),
    gitOutput(input.targetMount, ['rev-parse', 'HEAD']),
    gitOutput(input.targetMount, ['status', '--short', '--untracked-files=all'])
  ]);
  return {
    taskId: input.request.taskId,
    projectId: input.request.project.id,
    projectKind: input.request.project.kind,
    projectScopeRepositories: (input.request.project.repositories ?? []).map((repository) => repository.id),
    targetRepository: input.request.targetRepository.id,
    targetMount: input.targetMount,
    backgroundMount: input.backgroundMount,
    authorizedActions: input.request.authorizedActions ?? ['read'],
    branch: branch ?? '',
    head: head ?? '',
    gitAvailable: status != null,
    worktreeStatus: status ? status.split('\n') : [],
    lockedAt: input.lockedAt
  };
}

function readAgentName(entryContent: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(entryContent);
  if (!frontmatter) {
    throw new Error('XIGUA_CONTEXT_INCOMPLETE: entry AGENT.md has no frontmatter name declaration');
  }
  const name = /^name:\s*(\S+)\s*$/m.exec(frontmatter[1]);
  if (!name) {
    throw new Error('XIGUA_CONTEXT_INCOMPLETE: entry AGENT.md must declare a frontmatter name');
  }
  return name[1];
}

function normalizeEntryPath(entryPath: string): string {
  const normalized = entryPath.replaceAll('\\', '/');
  if (path.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`XIGUA_CONTEXT_INCOMPLETE: entry path must stay within source root: ${entryPath}`);
  }
  return normalized;
}

async function resolveSourceFile(sourceRoot: string, relativeOrAbsolute: string, label: string): Promise<string> {
  if (path.isAbsolute(relativeOrAbsolute)) {
    throw new Error(`XIGUA_CONTEXT_INCOMPLETE: ${label} must be relative to source root`);
  }
  const candidate = path.resolve(sourceRoot, relativeOrAbsolute);
  const resolved = await realpath(candidate).catch(() => {
    throw new Error(`XIGUA_CONTEXT_INCOMPLETE: ${label} does not exist: ${relativeOrAbsolute}`);
  });
  if (!containsPath(sourceRoot, resolved)) {
    throw new Error(`XIGUA_CONTEXT_INCOMPLETE: ${label} escapes source root: ${relativeOrAbsolute}`);
  }
  const info = await stat(resolved);
  if (!info.isFile()) {
    throw new Error(`XIGUA_CONTEXT_INCOMPLETE: ${label} is not a file: ${relativeOrAbsolute}`);
  }
  return resolved;
}

async function resolveDirectory(directory: string, label: string): Promise<string> {
  const resolved = await realpath(path.resolve(directory)).catch(() => {
    throw new Error(`${label} is missing: ${directory}`);
  });
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    throw new Error(`${label} is not a directory: ${directory}`);
  }
  return resolved;
}

async function readGitHead(repositoryRoot: string): Promise<string> {
  const head = await gitOutput(repositoryRoot, ['rev-parse', 'HEAD']);
  if (head == null) {
    throw new Error(`XIGUA_CONTEXT_INCOMPLETE: source git HEAD unavailable at ${repositoryRoot}`);
  }
  if (!/^[0-9a-f]{40}$/.test(head)) {
    throw new Error(`XIGUA_CONTEXT_INCOMPLETE: invalid source git HEAD: ${head}`);
  }
  return head;
}

async function gitOutput(cwd: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync('git', ['-C', cwd, ...args]);
    return String(result.stdout).trim();
  } catch {
    // Caller must distinguish "git unavailable" from real output.
    return null;
  }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as JsonObject)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as JsonObject)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function relativePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative));
}
