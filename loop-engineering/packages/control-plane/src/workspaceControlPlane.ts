import { execFile } from 'node:child_process';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import YAML from 'yaml';
import {
  BackgroundSource,
  ControlPlaneState,
  CreateWorkspaceInput,
  ManagedBackground,
  ManagedWorkspace,
  PreflightIssue,
  WorkspacePreflight,
  WorkspaceSource
} from './types';

const execFileAsync = promisify(execFile);
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const GIT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const DEFAULT_BRANCH = 'main';
const STATE_VERSION = 1;
const RESERVED_WORKSPACE_SLUGS = new Set(['xiaobai']);

interface WorkspaceControlPlaneOptions {
  dataRoot: string;
  xiaonengSourcePath?: string;
  projectsAgentRoot?: string;
  backgroundsAgentRoot?: string;
}

export class WorkspaceControlPlaneValidationError extends Error {
  readonly code = 'preflight_failed';

  constructor(readonly issues: PreflightIssue[]) {
    super('Workspace preflight failed');
  }
}

export class WorkspaceControlPlane {
  readonly dataRoot: string;
  readonly workspacesRoot: string;
  readonly backgroundsRoot: string;
  readonly stateRoot: string;
  readonly projectsAgentRoot: string;
  readonly backgroundsAgentRoot: string;
  private readonly stateFile: string;
  private readonly xiaonengSourcePath?: string;
  private creationQueue: Promise<unknown> = Promise.resolve();

  constructor(options: WorkspaceControlPlaneOptions) {
    this.dataRoot = path.resolve(options.dataRoot);
    this.workspacesRoot = path.join(this.dataRoot, 'workspaces');
    this.backgroundsRoot = path.join(this.dataRoot, 'backgrounds');
    this.stateRoot = path.join(this.dataRoot, 'state');
    this.stateFile = path.join(this.stateRoot, 'workspaces.json');
    this.xiaonengSourcePath = options.xiaonengSourcePath
      ? path.resolve(options.xiaonengSourcePath)
      : undefined;
    this.projectsAgentRoot = options.projectsAgentRoot ?? '/projects';
    this.backgroundsAgentRoot = options.backgroundsAgentRoot ?? '/backgrounds';
  }

  async listWorkspaces(): Promise<ManagedWorkspace[]> {
    return (await this.readState()).workspaces;
  }

  async preflight(input: CreateWorkspaceInput): Promise<WorkspacePreflight> {
    await this.ensureRoots();
    const issues: PreflightIssue[] = [];
    const slug = input.slug.trim();
    const defaultBranch = input.defaultBranch?.trim() || DEFAULT_BRANCH;

    if (!input.name.trim()) {
      issues.push(issue('name', 'name_required', 'Workspace name is required.'));
    }
    if (!SLUG_PATTERN.test(slug)) {
      issues.push(issue('slug', 'invalid_slug', 'Slug must use lowercase letters, numbers, and single hyphens.'));
    }
    if (RESERVED_WORKSPACE_SLUGS.has(slug)) {
      issues.push(issue('slug', 'reserved_slug', 'This slug is reserved by the Xiaobai runtime.'));
    }
    if (!validGitRef(defaultBranch)) {
      issues.push(issue('defaultBranch', 'invalid_git_ref', 'Default branch contains unsupported characters.'));
    }

    if (SLUG_PATTERN.test(slug)) {
      const existing = (await this.readState()).workspaces.some((workspace) => workspace.id === slug);
      if (existing) {
        issues.push(issue('slug', 'workspace_registered', 'A workspace with this slug is already registered.'));
      }
      if (input.source.type !== 'existing' && (await exists(path.join(this.workspacesRoot, slug)))) {
        issues.push(issue('slug', 'workspace_exists', 'The managed workspace directory already exists.'));
      }
      if (await exists(this.projectDefinitionRoot(slug))) {
        issues.push(issue('slug', 'project_definition_exists', 'The generated project definition already exists.'));
      }
    }

    await this.validateWorkspaceSource(input.source, issues);
    await this.validateBackgroundSource(input.background, issues);
    return { ok: issues.length === 0, issues };
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<ManagedWorkspace> {
    const operation = this.creationQueue.then(() => this.createWorkspaceInternal(input));
    this.creationQueue = operation.catch(() => undefined);
    return operation;
  }

  private async createWorkspaceInternal(input: CreateWorkspaceInput): Promise<ManagedWorkspace> {
    const normalized = normalizeInput(input);
    const preflight = await this.preflight(normalized);
    if (!preflight.ok) {
      throw new WorkspaceControlPlaneValidationError(preflight.issues);
    }

    const createdPaths: Array<{ target: string; root: string }> = [];
    try {
      const hostPath = await this.prepareWorkspace(normalized.source, normalized.slug, normalized.defaultBranch, createdPaths);
      const background = await this.prepareBackground(normalized.background, normalized.slug, createdPaths);
      const remote = await readGitValue(hostPath, ['config', '--get', 'remote.origin.url']);
      const resolvedCommit = await readGitValue(hostPath, ['rev-parse', 'HEAD']);
      const workspace: ManagedWorkspace = {
        id: normalized.slug,
        name: normalized.name,
        hostPath,
        agentPath: await toAgentPath(this.workspacesRoot, hostPath, this.projectsAgentRoot),
        defaultBranch: normalized.defaultBranch,
        source: redactSource(normalized.source),
        remote,
        resolvedCommit,
        background,
        route: {
          projectId: normalized.slug,
          repositoryId: normalized.slug,
          backgroundId: background?.id ?? null,
          loopId: 'frontend-delivery'
        },
        createdAt: new Date().toISOString()
      };

      const projectRoot = this.projectDefinitionRoot(workspace.id);
      createdPaths.push({ target: projectRoot, root: this.stateRoot });
      await this.writeProjectDefinition(workspace, projectRoot);
      const state = await this.readState();
      state.workspaces.push(workspace);
      await this.writeState(state);
      return workspace;
    } catch (error) {
      for (const created of createdPaths.reverse()) {
        await removeManagedDirectory(created.target, created.root);
      }
      throw error;
    }
  }

  private async prepareWorkspace(
    source: WorkspaceSource,
    slug: string,
    defaultBranch: string,
    createdPaths: Array<{ target: string; root: string }>
  ): Promise<string> {
    if (source.type === 'existing') {
      return realpath(source.path);
    }

    const target = path.join(this.workspacesRoot, slug);
    if (source.type === 'empty') {
      await mkdir(target);
      createdPaths.push({ target, root: this.workspacesRoot });
      await runGit(['init', '-b', defaultBranch], target);
      return target;
    }

    const cloneOptions = ['--depth', '1'];
    if (source.branch) {
      cloneOptions.push('--branch', source.branch);
    }
    await cloneManagedRepository(
      source.repositoryUrl,
      cloneOptions,
      this.workspacesRoot,
      target,
      createdPaths
    );
    return target;
  }

  private async prepareBackground(
    source: BackgroundSource,
    workspaceSlug: string,
    createdPaths: Array<{ target: string; root: string }>
  ): Promise<ManagedBackground | null> {
    if (source.type === 'none') {
      return null;
    }
    if (source.type === 'existing') {
      const hostPath = await realpath(source.path);
      return this.describeBackground(source.name, path.basename(hostPath), hostPath, source);
    }

    const id = source.type === 'xiaoneng' ? 'xiaoneng' : `${workspaceSlug}-background`;
    const name = source.type === 'xiaoneng' ? 'Xiaoneng' : source.name.trim();
    const target = path.join(this.backgroundsRoot, id);
    if (!(await exists(target))) {
      if (source.type === 'xiaoneng') {
        const sourcePath = this.xiaonengSourcePath as string;
        await cloneManagedRepository(
          sourcePath,
          ['--no-hardlinks'],
          this.backgroundsRoot,
          target,
          createdPaths
        );
        const commit = await readGitValue(sourcePath, ['rev-parse', 'HEAD']);
        if (commit) {
          await runGit(['checkout', '--detach', commit], target);
        }
      } else {
        const cloneOptions = ['--depth', '1'];
        if (source.ref) {
          cloneOptions.push('--branch', source.ref);
        }
        await cloneManagedRepository(
          source.repositoryUrl,
          cloneOptions,
          this.backgroundsRoot,
          target,
          createdPaths
        );
      }
    }
    return this.describeBackground(name, id, target, redactBackgroundSource(source));
  }

  private async describeBackground(
    name: string,
    id: string,
    hostPath: string,
    source: BackgroundSource
  ): Promise<ManagedBackground> {
    return {
      id,
      name,
      hostPath,
      agentPath: await toAgentPath(this.backgroundsRoot, hostPath, this.backgroundsAgentRoot),
      source,
      resolvedCommit: await readGitValue(hostPath, ['rev-parse', 'HEAD']),
      access: 'read-only'
    };
  }

  private async validateWorkspaceSource(source: WorkspaceSource, issues: PreflightIssue[]): Promise<void> {
    if (source.type === 'git') {
      validateRepositoryUrl('source.repositoryUrl', source.repositoryUrl, issues);
      if (source.branch && !validGitRef(source.branch)) {
        issues.push(issue('source.branch', 'invalid_git_ref', 'Git branch contains unsupported characters.'));
      }
    }
    if (source.type === 'existing') {
      await validateExistingDirectory(source.path, this.workspacesRoot, 'source.path', issues);
    }
  }

  private async validateBackgroundSource(source: BackgroundSource, issues: PreflightIssue[]): Promise<void> {
    if (source.type === 'xiaoneng') {
      if (!this.xiaonengSourcePath || !(await isDirectory(this.xiaonengSourcePath))) {
        issues.push(issue('background', 'xiaoneng_unavailable', 'The configured Xiaoneng source is unavailable.'));
      } else if (!(await readGitValue(this.xiaonengSourcePath, ['rev-parse', 'HEAD']))) {
        issues.push(issue('background', 'xiaoneng_not_git', 'The configured Xiaoneng source is not a Git repository.'));
      }
    }
    if (source.type === 'git') {
      if (!source.name.trim()) {
        issues.push(issue('background.name', 'name_required', 'Background name is required.'));
      }
      validateRepositoryUrl('background.repositoryUrl', source.repositoryUrl, issues);
      if (source.ref && !validGitRef(source.ref)) {
        issues.push(issue('background.ref', 'invalid_git_ref', 'Background ref contains unsupported characters.'));
      }
    }
    if (source.type === 'existing') {
      if (!source.name.trim()) {
        issues.push(issue('background.name', 'name_required', 'Background name is required.'));
      }
      await validateExistingDirectory(source.path, this.backgroundsRoot, 'background.path', issues);
    }
  }

  private async ensureRoots(): Promise<void> {
    await Promise.all([
      mkdir(this.workspacesRoot, { recursive: true }),
      mkdir(this.backgroundsRoot, { recursive: true }),
      mkdir(this.stateRoot, { recursive: true })
    ]);
  }

  private async readState(): Promise<ControlPlaneState> {
    await this.ensureRoots();
    if (!(await exists(this.stateFile))) {
      return { version: STATE_VERSION, workspaces: [] };
    }
    const parsed = JSON.parse(await readFile(this.stateFile, 'utf8')) as Partial<ControlPlaneState>;
    if (parsed.version !== STATE_VERSION || !Array.isArray(parsed.workspaces)) {
      throw new Error('Unsupported Xiaobai control-plane state');
    }
    return parsed as ControlPlaneState;
  }

  private async writeState(state: ControlPlaneState): Promise<void> {
    const temporary = `${this.stateFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.stateFile);
  }

  private projectDefinitionRoot(workspaceId: string): string {
    return path.join(this.stateRoot, 'projects', workspaceId);
  }

  private async writeProjectDefinition(workspace: ManagedWorkspace, projectRoot: string): Promise<void> {
    const definition = {
      kind: 'Project',
      id: workspace.id,
      name: workspace.name,
      root: workspace.agentPath,
      defaultBranch: workspace.defaultBranch,
      skill: 'SKILL.md',
      ...(workspace.background
        ? {
            background: {
              id: workspace.background.id,
              name: workspace.background.name,
              localPathKey: workspace.background.id,
              mount: workspace.background.agentPath
            }
          }
        : {}),
      repositories: [
        {
          id: workspace.id,
          name: workspace.name,
          localPathKey: workspace.id,
          mount: workspace.agentPath,
          ...(workspace.remote ? { remote: workspace.remote } : {})
        }
      ]
    };
    await mkdir(path.join(projectRoot, '.loop'), { recursive: true });
    await writeFile(path.join(projectRoot, '.loop', 'project.yaml'), YAML.stringify(definition), 'utf8');
    await writeFile(
      path.join(projectRoot, 'SKILL.md'),
      `# ${workspace.name}\n\n## 中文\n\n先解析工作区与只读背景，再选择 Loop；未通过人工门禁时不得编码或发布。\n\n## English\n\nResolve the workspace and read-only background before selecting a loop. Do not code or release before required human gates pass.\n`,
      'utf8'
    );
  }
}

function normalizeInput(input: CreateWorkspaceInput): CreateWorkspaceInput & { defaultBranch: string } {
  const source: WorkspaceSource =
    input.source.type === 'git'
      ? {
          type: 'git',
          repositoryUrl: input.source.repositoryUrl.trim(),
          ...(input.source.branch?.trim() ? { branch: input.source.branch.trim() } : {})
        }
      : input.source.type === 'existing'
        ? { type: 'existing', path: input.source.path.trim() }
        : { type: 'empty' };
  const background: BackgroundSource =
    input.background.type === 'git'
      ? {
          type: 'git',
          name: input.background.name.trim(),
          repositoryUrl: input.background.repositoryUrl.trim(),
          ...(input.background.ref?.trim() ? { ref: input.background.ref.trim() } : {})
        }
      : input.background.type === 'existing'
        ? {
            type: 'existing',
            name: input.background.name.trim(),
            path: input.background.path.trim()
          }
        : { type: input.background.type };
  return {
    name: input.name.trim(),
    slug: input.slug.trim(),
    defaultBranch: input.defaultBranch?.trim() || DEFAULT_BRANCH,
    source,
    background
  };
}

function issue(field: string, code: string, message: string): PreflightIssue {
  return { field, code, message };
}

function validGitRef(value: string): boolean {
  return (
    GIT_REF_PATTERN.test(value) &&
    !value.startsWith('-') &&
    !value.includes('..') &&
    !value.includes('//') &&
    !value.endsWith('/')
  );
}

function validateRepositoryUrl(field: string, value: string, issues: PreflightIssue[]): void {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('-') || /\s/.test(trimmed)) {
    issues.push(issue(field, 'invalid_repository_url', 'Repository URL is invalid.'));
    return;
  }
  if (/^https?:\/\/[^/]*@/i.test(trimmed) || /^ssh:\/\/[^/]*:[^/]*@/i.test(trimmed)) {
    issues.push(issue(field, 'credentials_in_url', 'Store Git credentials outside the repository URL.'));
    return;
  }
  const supportedUrl = /^(?:https?|ssh|git):\/\/[^/]+\/.+/i.test(trimmed);
  const supportedScpUrl = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:.+/.test(trimmed);
  if (!supportedUrl && !supportedScpUrl) {
    issues.push(issue(field, 'invalid_repository_url', 'Use an HTTPS, SSH, Git, or SCP-style repository URL.'));
  }
}

async function validateExistingDirectory(
  value: string,
  root: string,
  field: string,
  issues: PreflightIssue[]
): Promise<void> {
  const candidate = path.resolve(value);
  if (!containsPath(root, candidate) || candidate === path.resolve(root)) {
    issues.push(issue(field, 'path_outside_managed_root', 'Path must be inside the configured managed root.'));
    return;
  }
  if (!(await isDirectory(candidate))) {
    issues.push(issue(field, 'path_not_found', 'The selected directory does not exist.'));
    return;
  }
  const [resolvedRoot, resolvedCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  if (!containsPath(resolvedRoot, resolvedCandidate) || resolvedCandidate === resolvedRoot) {
    issues.push(issue(field, 'path_outside_managed_root', 'Path must be inside the configured managed root.'));
  }
}

function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function toAgentPath(managedRoot: string, hostPath: string, agentRoot: string): Promise<string> {
  const [resolvedRoot, resolvedHostPath] = await Promise.all([realpath(managedRoot), realpath(hostPath)]);
  const relative = path.relative(resolvedRoot, resolvedHostPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Managed path cannot be mapped into the agent runtime');
  }
  return path.posix.join(agentRoot, ...relative.split(path.sep));
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function runGit(args: string[], cwd?: string): Promise<void> {
  await execFileAsync('git', args, cwd ? { cwd } : undefined);
}

async function cloneManagedRepository(
  repository: string,
  cloneOptions: string[],
  managedRoot: string,
  target: string,
  createdPaths: Array<{ target: string; root: string }>
): Promise<void> {
  const temporary = await mkdtemp(path.join(managedRoot, `.${path.basename(target)}-`));
  const createdPath = { target: temporary, root: managedRoot };
  createdPaths.push(createdPath);
  await runGit(['clone', ...cloneOptions, '--', repository, temporary]);
  await rename(temporary, target);
  createdPath.target = target;
}

async function readGitValue(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function removeManagedDirectory(target: string, root: string): Promise<void> {
  if (target !== path.resolve(root) && containsPath(root, target)) {
    await rm(target, { recursive: true, force: true });
  }
}

function redactSource(source: WorkspaceSource): WorkspaceSource {
  return source.type === 'git'
    ? { type: 'git', repositoryUrl: source.repositoryUrl.trim(), ...(source.branch ? { branch: source.branch } : {}) }
    : source;
}

function redactBackgroundSource(source: BackgroundSource): BackgroundSource {
  return source.type === 'git'
    ? {
        type: 'git',
        name: source.name.trim(),
        repositoryUrl: source.repositoryUrl.trim(),
        ...(source.ref ? { ref: source.ref } : {})
      }
    : source;
}
