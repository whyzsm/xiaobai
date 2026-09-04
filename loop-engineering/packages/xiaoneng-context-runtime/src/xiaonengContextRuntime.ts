import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { readYamlFile } from '../../shared/src/fs';
import {
  ProjectRepository,
  ProjectSpec,
  TaskContextLock,
  XiaonengRuntimePlan,
  XiaonengSkillContext,
  XiaonengSourceConsumptionEvidence,
  XiaonengSourceFileEvidence
} from '../../shared/src/types';

const execFileAsync = promisify(execFile);
const DEFAULT_EXECUTION_MODE = 'PageImplementation';
const CONSUMER_AGENT = 'xiaoneng-agent';

type JsonObject = Record<string, unknown>;

export interface XiaonengContextRequest {
  sourceRoot: string;
  projectRoot?: string;
  project: ProjectSpec;
  targetRepository: ProjectRepository;
  taskId: string;
  executionMode?: string;
  authorizedActions?: string[];
  consumerAgent?: string;
  now?: Date;
}

export async function resolveXiaonengRuntime(
  request: XiaonengContextRequest
): Promise<XiaonengRuntimePlan> {
  const sourceRoot = await resolveDirectory(request.sourceRoot, 'Xiaoneng source root');
  const manifestPath = await resolveSourceFile(sourceRoot, 'harness/runtime/manifest.yaml', 'routing manifest');
  const manifestSchemaPath = await resolveSourceFile(sourceRoot, 'harness/runtime/manifest.schema.json', 'routing manifest schema');
  const manifest = (await readYamlFile<JsonObject>(manifestPath)) ?? {};
  const manifestSchema = JSON.parse(await readFile(manifestSchemaPath, 'utf8')) as JsonObject;
  validateManifestShape(manifest, manifestSchema);
  const skillContext = asObject(manifest.skillContext, 'manifest.skillContext');
  const contract = asObject(skillContext.contract, 'manifest.skillContext.contract');
  const manifestRelativePath = asRelativePath(skillContext.manifestPath, 'manifest.skillContext.manifestPath');
  const declaredManifestPath = await resolveSourceFile(sourceRoot, manifestRelativePath, 'declared routing manifest');
  if (declaredManifestPath !== manifestPath) {
    throw new Error(`XIAONENG_CONTEXT_INCOMPLETE: manifest path mismatch: ${manifestRelativePath}`);
  }

  const entryRelativePath = asRelativePath(skillContext.entryPath, 'manifest.skillContext.entryPath');
  const entryPath = await resolveSourceFile(sourceRoot, entryRelativePath, 'entry skill');
  const contractReference = asString(contract.path, 'manifest.skillContext.contract.path');
  let contractPath: string | undefined;
  for (const candidate of [
    path.resolve(sourceRoot, contractReference),
    path.resolve(path.dirname(manifestPath), contractReference),
    path.resolve(path.dirname(path.dirname(manifestPath)), contractReference)
  ]) {
    try {
      contractPath = await resolveSourceFile(
        sourceRoot,
        path.relative(sourceRoot, candidate),
        'skill context contract'
      );
      break;
    } catch {
      // Try the next manifest-relative interpretation.
    }
  }
  if (!contractPath) {
    throw new Error(`XIAONENG_CONTEXT_INCOMPLETE: skill context contract does not exist: ${contractReference}`);
  }
  JSON.parse(await readFile(contractPath, 'utf8'));
  const modeName = request.executionMode ?? DEFAULT_EXECUTION_MODE;
  const executionModes = asObject(manifest.executionModes, 'manifest.executionModes');
  const modes = asObject(executionModes.modes, 'manifest.executionModes.modes');
  const mode = asObject(modes[modeName], `manifest.executionModes.modes.${modeName}`);
  const ownerAgent = asString(mode.ownerAgent, `manifest.executionModes.modes.${modeName}.ownerAgent`);
  const ownerSkills = asStringArray(mode.ownerSkills, `manifest.executionModes.modes.${modeName}.ownerSkills`);

  const sourceFiles: XiaonengSourceFileEvidence[] = [];
  const manifestHash = await recordSourceFile(sourceFiles, sourceRoot, manifestPath, 'Manifest routing source');
  await recordSourceFile(sourceFiles, sourceRoot, manifestSchemaPath, 'Manifest schema');
  const entryHash = await recordSourceFile(sourceFiles, sourceRoot, entryPath, 'xiaoneng-agent entry skill');
  await recordSourceFile(sourceFiles, sourceRoot, contractPath, 'skill context contract');
  for (const skill of ownerSkills) {
    const skillPath = await resolveSourceFile(sourceRoot, `skills/${skill}/SKILL.md`, `owner skill ${skill}`);
    await recordSourceFile(sourceFiles, sourceRoot, skillPath, `Manifest-selected owner skill ${skill}`);
  }

  const references = readManifestReferences(mode, manifest);
  const selectedReferences: XiaonengSkillContext['selectedReferences'] = [];
  for (const reference of references) {
    const referencePath = await resolveSourceFile(sourceRoot, reference.path, `Manifest-selected reference ${reference.id}`);
    const digest = await recordSourceFile(sourceFiles, sourceRoot, referencePath, `Manifest-selected reference ${reference.id}`);
    selectedReferences.push({
      id: reference.id,
      path: relativePath(sourceRoot, referencePath),
      digest
    });
  }

  const skillCommit = await readGitHead(sourceRoot);
  const contextBase = {
    contractVersion: asString(contract.version, 'manifest.skillContext.contract.version'),
    skillId: asString(manifest.orchestrator, 'manifest.orchestrator'),
    skillCommit,
    entryPath: relativePath(sourceRoot, entryPath),
    entryHash,
    manifestPath: relativePath(sourceRoot, manifestPath),
    manifestDigest: manifestHash,
    executionMode: modeName,
    ownerAgent,
    ownerSkills,
    selectedReferences
  };
  const context: XiaonengSkillContext = {
    ...contextBase,
    contextDigest: sha256(stableJson(contextBase))
  };
  const consumedAt = (request.now ?? new Date()).toISOString();
  const sourceConsumption: XiaonengSourceConsumptionEvidence = {
    sourceRoot,
    manifestPath: relativePath(sourceRoot, manifestPath),
    entryPath: relativePath(sourceRoot, entryPath),
    files: sourceFiles,
    consumedBy: request.consumerAgent ?? CONSUMER_AGENT,
    consumedAt
  };
  const targetMount = await resolveDirectory(
    path.resolve(request.projectRoot ?? process.cwd(), request.targetRepository.mount),
    'target repository mount'
  );
  const taskContextLock = await createTaskContextLock({
    request,
    targetMount,
    backgroundMount: sourceRoot,
    lockedAt: consumedAt
  });

  return { skillContext: context, sourceConsumption, taskContextLock };
}

export async function assertTargetOnlyWrite(targetRoot: string, candidatePath: string): Promise<void> {
  const target = await resolveDirectory(targetRoot, 'target write root');
  const candidate = path.resolve(candidatePath);
  const existingParent = await nearestExistingParent(candidate);
  const realParent = await realpath(existingParent);
  if (!containsPath(target, realParent)) {
    throw new Error(`AUTHORIZATION_SCOPE_EXCEEDED: write path is outside target repository: ${candidatePath}`);
  }
}

export function isExcludedSourcePath(relative: string): boolean {
  return isExcludedPath(relative);
}

async function createTaskContextLock(input: {
  request: XiaonengContextRequest;
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
    authorizedActions: input.request.authorizedActions ?? ['implement'],
    branch: branch ?? '',
    head: head ?? '',
    gitAvailable: status != null,
    worktreeStatus: status ? status.split('\n') : [],
    lockedAt: input.lockedAt
  };
}

async function recordSourceFile(
  files: XiaonengSourceFileEvidence[],
  sourceRoot: string,
  filePath: string,
  purpose: string
): Promise<string> {
  const hash = await fileHash(filePath);
  files.push({ path: relativePath(sourceRoot, filePath), hash, purpose });
  return hash;
}

async function resolveSourceFile(sourceRoot: string, relativeOrAbsolute: string, label: string): Promise<string> {
  if (path.isAbsolute(relativeOrAbsolute)) {
    throw new Error(`XIAONENG_CONTEXT_INCOMPLETE: ${label} must be relative to source root`);
  }
  const candidate = path.resolve(sourceRoot, relativeOrAbsolute);
  const resolved = await realpath(candidate).catch(() => {
    throw new Error(`XIAONENG_CONTEXT_INCOMPLETE: ${label} does not exist: ${relativeOrAbsolute}`);
  });
  if (!containsPath(sourceRoot, resolved)) {
    throw new Error(`XIAONENG_CONTEXT_INCOMPLETE: ${label} escapes source root: ${relativeOrAbsolute}`);
  }
  if (isExcludedPath(relativePath(sourceRoot, resolved))) {
    throw new Error(`XIAONENG_CONTEXT_INCOMPLETE: excluded generated/history/tmp source: ${relativeOrAbsolute}`);
  }
  const info = await stat(resolved);
  if (!info.isFile()) {
    throw new Error(`XIAONENG_CONTEXT_INCOMPLETE: ${label} is not a file: ${relativeOrAbsolute}`);
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

async function nearestExistingParent(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    try {
      await stat(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`AUTHORIZATION_SCOPE_EXCEEDED: no existing parent for ${candidate}`);
      }
      current = parent;
    }
  }
}

function readManifestReferences(mode: JsonObject, manifest: JsonObject): Array<{ id: string; path: string }> {
  const raw = mode.references ?? mode.primaryReferences ?? manifest.references ?? [];
  if (!Array.isArray(raw)) {
    throw new Error('XIAONENG_CONTEXT_INCOMPLETE: Manifest references must be an array');
  }
  return raw.map((value, index) => {
    if (typeof value === 'string') {
      return { id: value, path: value };
    }
    const reference = asObject(value, `Manifest reference ${index}`);
    return {
      id: asString(reference.id ?? reference.path, `Manifest reference ${index}.id`),
      path: asRelativePath(reference.path, `Manifest reference ${index}.path`)
    };
  });
}

async function readGitHead(repositoryRoot: string): Promise<string> {
  const head = await gitOutput(repositoryRoot, ['rev-parse', 'HEAD']);
  if (head == null) {
    throw new Error(`XIAONENG_CONTEXT_INCOMPLETE: source git HEAD unavailable at ${repositoryRoot}`);
  }
  if (!/^[0-9a-f]{40}$/.test(head)) {
    throw new Error(`XIAONENG_CONTEXT_INCOMPLETE: invalid source git HEAD: ${head}`);
  }
  return head;
}

async function gitOutput(cwd: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync('git', ['-C', cwd, ...args]);
    return String(result.stdout).trim();
  } catch {
    // Do not swallow the failure into a truthy string; callers must tell
    // "git unavailable" apart from "git ran and reported an empty tree".
    return null;
  }
}

async function fileHash(filePath: string): Promise<string> {
  return sha256(await readFile(filePath));
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

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`XIAONENG_CONTEXT_INCOMPLETE: ${label} must be an object`);
  }
  return value as JsonObject;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`XIAONENG_CONTEXT_INCOMPLETE: ${label} must be a non-empty string`);
  }
  return value;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`XIAONENG_CONTEXT_INCOMPLETE: ${label} must be a string array`);
  }
  return [...new Set(value as string[])];
}

function asRelativePath(value: unknown, label: string): string {
  const result = asString(value, label).replaceAll('\\', '/');
  if (path.isAbsolute(result) || result.split('/').includes('..')) {
    throw new Error(`XIAONENG_CONTEXT_INCOMPLETE: ${label} must stay within source root`);
  }
  return result;
}

function validateManifestShape(manifest: JsonObject, schema: JsonObject): void {
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (typeof key === 'string' && manifest[key] === undefined) {
      throw new Error(`XIAONENG_CONTEXT_INCOMPLETE: manifest schema requires ${key}`);
    }
  }
  asObject(manifest.skillContext, 'manifest.skillContext');
  asObject(manifest.executionModes, 'manifest.executionModes');
}

function relativePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function isExcludedPath(relative: string): boolean {
  const parts = relative.toLowerCase().split('/');
  return parts.some((part) => part === 'history' || part === 'archive' || part === 'tmp' || part === 'generated')
    || parts.some((part) => /\.generated\./.test(part));
}
