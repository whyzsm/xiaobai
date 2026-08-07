import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { startControlPlaneServer } from '../packages/control-plane/src/server';
import { WorkspaceControlPlane } from '../packages/control-plane/src/workspaceControlPlane';

const execFileAsync = promisify(execFile);

async function createGitRepository(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# Fixture\n', 'utf8');
  await execFileAsync('git', ['add', 'README.md'], { cwd: root });
  await execFileAsync(
    'git',
    ['-c', 'user.name=Xiaobai Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'],
    { cwd: root }
  );
}

test('creates a managed workspace with a pinned read-only Xiaoneng background', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-control-plane-'));
  const xiaonengSource = path.join(root, 'fixtures', 'xiaoneng');
  await createGitRepository(xiaonengSource);
  const controlPlane = new WorkspaceControlPlane({
    dataRoot: path.join(root, 'data'),
    xiaonengSourcePath: xiaonengSource
  });

  const workspace = await controlPlane.createWorkspace({
    name: 'Demo workspace',
    slug: 'demo-workspace',
    defaultBranch: 'main',
    source: { type: 'empty' },
    background: { type: 'xiaoneng' }
  });

  assert.equal(workspace.agentPath, '/projects/demo-workspace');
  assert.equal(workspace.background?.agentPath, '/backgrounds/xiaoneng');
  assert.equal(workspace.background?.access, 'read-only');
  assert.match(workspace.background?.resolvedCommit ?? '', /^[0-9a-f]{40}$/);
  assert.equal(await readFile(path.join(workspace.hostPath, '.git', 'HEAD'), 'utf8').then(Boolean), true);
  assert.match(
    await readFile(
      path.join(root, 'data', 'state', 'projects', 'demo-workspace', '.loop', 'project.yaml'),
      'utf8'
    ),
    /background:\n  id: xiaoneng/
  );
});

test('preflight rejects traversal and existing paths outside the managed roots', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-control-plane-'));
  const controlPlane = new WorkspaceControlPlane({ dataRoot: path.join(root, 'data') });

  const unsafeSlug = await controlPlane.preflight({
    name: 'Unsafe',
    slug: '../unsafe',
    source: { type: 'empty' },
    background: { type: 'none' }
  });
  const outsidePath = await controlPlane.preflight({
    name: 'Outside',
    slug: 'outside',
    source: { type: 'existing', path: root },
    background: { type: 'none' }
  });

  assert.equal(unsafeSlug.ok, false);
  assert.equal(unsafeSlug.issues.some((issue) => issue.code === 'invalid_slug'), true);
  assert.equal(outsidePath.ok, false);
  assert.equal(outsidePath.issues.some((issue) => issue.code === 'path_outside_managed_root'), true);
});

test('preflight rejects local Git URLs and credential-bearing HTTP URLs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-control-plane-'));
  const controlPlane = new WorkspaceControlPlane({ dataRoot: path.join(root, 'data') });

  const localUrl = await controlPlane.preflight({
    name: 'Local URL',
    slug: 'local-url',
    source: { type: 'git', repositoryUrl: 'file:///tmp/repository' },
    background: { type: 'none' }
  });
  const credentialUrl = await controlPlane.preflight({
    name: 'Credential URL',
    slug: 'credential-url',
    source: { type: 'git', repositoryUrl: 'https://user:secret@example.invalid/repository.git' },
    background: { type: 'none' }
  });

  assert.equal(localUrl.issues.some((issue) => issue.code === 'invalid_repository_url'), true);
  assert.equal(credentialUrl.issues.some((issue) => issue.code === 'credentials_in_url'), true);
});

test('preflight reserves the Xiaobai orchestrator workspace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-control-plane-'));
  const controlPlane = new WorkspaceControlPlane({ dataRoot: path.join(root, 'data') });

  const result = await controlPlane.preflight({
    name: 'Xiaobai',
    slug: 'xiaobai',
    source: { type: 'empty' },
    background: { type: 'none' }
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'reserved_slug'), true);
});

test('removes a partial managed directory when Git clone fails', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-control-plane-'));
  const dataRoot = path.join(root, 'data');
  const controlPlane = new WorkspaceControlPlane({ dataRoot });

  await assert.rejects(
    controlPlane.createWorkspace({
      name: 'Failed clone',
      slug: 'failed-clone',
      source: { type: 'git', repositoryUrl: 'git://127.0.0.1:1/missing.git' },
      background: { type: 'none' }
    })
  );
  await assert.rejects(stat(path.join(dataRoot, 'workspaces', 'failed-clone')));
});

test('preflight rejects an existing path symlinked outside the managed root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-control-plane-'));
  const dataRoot = path.join(root, 'data');
  const outside = path.join(root, 'outside');
  const linkedWorkspace = path.join(dataRoot, 'workspaces', 'linked-workspace');
  await mkdir(path.dirname(linkedWorkspace), { recursive: true });
  await mkdir(outside);
  await symlink(outside, linkedWorkspace);
  const controlPlane = new WorkspaceControlPlane({ dataRoot });

  const result = await controlPlane.preflight({
    name: 'Linked workspace',
    slug: 'linked-workspace',
    source: { type: 'existing', path: linkedWorkspace },
    background: { type: 'none' }
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'path_outside_managed_root'), true);
});

test('maps nested existing directories to their mounted agent paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-control-plane-'));
  const dataRoot = path.join(root, 'data');
  const workspacePath = path.join(dataRoot, 'workspaces', 'team', 'demo');
  const backgroundPath = path.join(dataRoot, 'backgrounds', 'shared', 'docs');
  await createGitRepository(workspacePath);
  await createGitRepository(backgroundPath);
  const controlPlane = new WorkspaceControlPlane({ dataRoot });

  const workspace = await controlPlane.createWorkspace({
    name: 'Nested workspace',
    slug: 'nested-workspace',
    source: { type: 'existing', path: workspacePath },
    background: { type: 'existing', name: 'Shared docs', path: backgroundPath }
  });

  assert.equal(workspace.agentPath, '/projects/team/demo');
  assert.equal(workspace.background?.agentPath, '/backgrounds/shared/docs');
});

test('host mode accepts selected external directories and returns their real paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-control-plane-'));
  const workspacePath = path.join(root, 'selected', 'workspace');
  const backgroundPath = path.join(root, 'selected', 'background');
  await createGitRepository(workspacePath);
  await createGitRepository(backgroundPath);
  const controlPlane = new WorkspaceControlPlane({
    dataRoot: path.join(root, 'data'),
    runtimePathMode: 'host'
  });

  const workspace = await controlPlane.createWorkspace({
    name: 'Host workspace',
    slug: 'host-workspace',
    source: { type: 'existing', path: workspacePath },
    background: { type: 'existing', name: 'Host background', path: backgroundPath }
  });

  assert.equal(workspace.hostPath, await realpath(workspacePath));
  assert.equal(workspace.agentPath, await realpath(workspacePath));
  assert.equal(workspace.background?.hostPath, await realpath(backgroundPath));
  assert.equal(workspace.background?.agentPath, await realpath(backgroundPath));
});

test('host mode uses a Xiaoneng snapshot directly without Git metadata', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-control-plane-'));
  const xiaonengSnapshot = path.join(root, 'bundled', 'xiaoneng');
  await mkdir(xiaonengSnapshot, { recursive: true });
  await writeFile(path.join(xiaonengSnapshot, 'README.md'), '# Snapshot\n', 'utf8');
  const controlPlane = new WorkspaceControlPlane({
    dataRoot: path.join(root, 'data'),
    xiaonengSourcePath: xiaonengSnapshot,
    runtimePathMode: 'host'
  });

  const workspace = await controlPlane.createWorkspace({
    name: 'Snapshot workspace',
    slug: 'snapshot-workspace',
    source: { type: 'empty' },
    background: { type: 'xiaoneng' }
  });

  assert.equal(workspace.background?.hostPath, await realpath(xiaonengSnapshot));
  assert.equal(workspace.background?.agentPath, await realpath(xiaonengSnapshot));
  assert.equal(workspace.background?.resolvedCommit, null);
  await assert.rejects(stat(path.join(root, 'data', 'backgrounds', 'xiaoneng')));
});

test('host mode still rejects relative existing paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-control-plane-'));
  const controlPlane = new WorkspaceControlPlane({
    dataRoot: path.join(root, 'data'),
    runtimePathMode: 'host'
  });

  const result = await controlPlane.preflight({
    name: 'Relative workspace',
    slug: 'relative-workspace',
    source: { type: 'existing', path: 'relative/workspace' },
    background: { type: 'none' }
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === 'path_not_absolute'), true);
});

test('normalizes existing paths before preflight and creation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-control-plane-'));
  const dataRoot = path.join(root, 'data');
  const workspacePath = path.join(dataRoot, 'workspaces', 'existing-demo');
  await createGitRepository(workspacePath);
  const controlPlane = new WorkspaceControlPlane({ dataRoot });

  const workspace = await controlPlane.createWorkspace({
    name: ' Existing demo ',
    slug: 'existing-demo-registration',
    source: { type: 'existing', path: `  ${workspacePath}  ` },
    background: { type: 'none' }
  });

  assert.equal(workspace.name, 'Existing demo');
  assert.equal(workspace.hostPath, await realpath(workspacePath));
  assert.equal(workspace.agentPath, '/projects/existing-demo');
});

test('persists created workspaces across control-plane instances', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-control-plane-'));
  const dataRoot = path.join(root, 'data');
  const first = new WorkspaceControlPlane({ dataRoot });
  await first.createWorkspace({
    name: 'Persistent workspace',
    slug: 'persistent-workspace',
    source: { type: 'empty' },
    background: { type: 'none' }
  });

  const second = new WorkspaceControlPlane({ dataRoot });
  const workspaces = await second.listWorkspaces();

  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0].id, 'persistent-workspace');
});

test('HTTP API rejects requests that do not match the workspace schema', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-control-plane-'));
  const server = startControlPlaneServer({
    port: 0,
    dataRoot: path.join(root, 'data'),
    allowedOrigins: []
  });
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      })
  );
  await once(server, 'listening');
  const address = server.address() as AddressInfo;

  const response = await fetch(`http://127.0.0.1:${address.port}/workspaces/preflight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json() as { error: string }).error, 'invalid_request');
});

test('HTTP API protects workspace operations when a control-plane key is configured', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-control-plane-'));
  const server = startControlPlaneServer({
    port: 0,
    dataRoot: path.join(root, 'data'),
    allowedOrigins: [],
    runtimePathMode: 'host',
    apiKey: 'tinyx-test-key'
  });
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      })
  );
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/workspaces`;

  const unauthorized = await fetch(url);
  const authorized = await fetch(url, {
    headers: { 'X-TinyX-Control-Key': 'tinyx-test-key' }
  });

  assert.equal(unauthorized.status, 401);
  assert.equal(authorized.status, 200);
  assert.deepEqual((await authorized.json() as { workspaces: unknown[] }).workspaces, []);
});
