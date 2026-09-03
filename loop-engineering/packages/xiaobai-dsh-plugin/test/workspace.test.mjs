import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  ERROR_CODES,
  LoopCatalogService,
  WorkspaceRegistryStore,
  WorkspaceService,
  buildMonitorProjection,
  isSafeMonitorProjection,
  loadLoopCatalog,
  loadWorkspaceConfig,
  redactLoadedWorkspace,
  resolveWorkspaceProject,
} from '../lib/index.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'xiaobai-workspace-'))
  const projectRoot = join(root, 'projects', 'alpha', '.loop')
  const repositoryRoot = join(root, 'mounts', 'alpha-repository')
  const backgroundRoot = join(root, 'mounts', 'alpha-background')
  await mkdir(projectRoot, { recursive: true })
  await mkdir(repositoryRoot, { recursive: true })
  await mkdir(backgroundRoot, { recursive: true })
  await writeFile(join(projectRoot, 'project.yaml'), `kind: ProjectGroup
id: alpha
name: Alpha
owner: platform
classification: internal
localPaths: .loop/local.paths.yaml
background:
  id: alpha-context
  localPathKey: alphaContext
  mount: ../../mounts/alpha-background
repositories:
  - id: alpha-repository
    name: alpha-repository
    localPathKey: alphaRepository
    mount: mounts/alpha-repository
`, 'utf8')
  await writeFile(join(projectRoot, 'local.paths.yaml'), `background:
  alphaContext: ${backgroundRoot}
repositories:
  alphaRepository: ${repositoryRoot}
`, 'utf8')
  return { root, repositoryRoot, backgroundRoot }
}

test('Workspace loader maps multiple Projects and preserves project identity across roots', async () => {
  const first = await fixture()
  const second = await fixture()
  try {
    const loaded = await loadWorkspaceConfig(first.root, { title: 'Test Workspace' })
    assert.equal(loaded.status, 'loaded')
    assert.equal(loaded.projects.length, 1)
    assert.equal(loaded.projects[0].knowledgeStatus, 'locked')
    assert.deepEqual(loaded.projects[0].repositoryStatuses, [{ repoId: loaded.projects[0].baseline.repositories[0].repoId, status: 'locked' }])
    const moved = await loadWorkspaceConfig(second.root)
    assert.equal(moved.projects[0].baseline.projectId, loaded.projects[0].baseline.projectId)
    const redacted = redactLoadedWorkspace(loaded)
    assert.equal(JSON.stringify(redacted).includes(first.root), false)
    assert.equal(JSON.stringify(redacted).includes(first.backgroundRoot), false)
  } finally {
    await rm(first.root, { recursive: true, force: true })
    await rm(second.root, { recursive: true, force: true })
  }
})

test('Workspace loader exposes an empty ProjectGroup for first-child creation and routes nested children', async () => {
  const fixtureValue = await fixture()
  const groupRoot = join(fixtureValue.root, 'projects', 'alpha')
  const childrenRoot = join(groupRoot, 'projects')
  const childRoot = join(childrenRoot, 'child')
  await mkdir(childrenRoot, { recursive: true })
  await writeFile(join(groupRoot, '.loop', 'project.yaml'), `kind: ProjectGroup
id: alpha
name: Alpha
owner: platform
classification: internal
skill: SKILL.md
sharedContext: alpha-shared
background:
  id: alpha-context
  localPathKey: alphaContext
  mount: ../../mounts/alpha-background
children:
  directory: projects
  sharedContext: alpha-shared
  requireSingleRepository: true
repositories:
  - id: alpha-repository
    name: alpha-repository
    localPathKey: alphaRepository
    mount: ../../mounts/alpha-repository
`, 'utf8')
  try {
    const empty = await loadWorkspaceConfig(fixtureValue.root)
    assert.equal(empty.projectGroups.length, 1)
    assert.equal(empty.projectGroups[0].childCount, 0)
    assert.equal(empty.projects.length, 0)

    await mkdir(join(childRoot, '.loop'), { recursive: true })
    await writeFile(join(childRoot, '.loop', 'project.yaml'), `kind: Project
id: alpha-child
name: Alpha Child
root: .
defaultBranch: main
parentGroup: alpha
sharedContext: alpha-shared
repositories:
  - id: child-repository
    name: child-repository
    localPathKey: alphaRepository
    mount: ../../../../mounts/alpha-repository
`, 'utf8')
    const loaded = await loadWorkspaceConfig(fixtureValue.root)
    assert.equal(loaded.projectGroups[0].childProjectIds.length, 1)
    assert.equal(loaded.projects.length, 1)
    assert.equal(loaded.projects[0].sourceProjectId, 'alpha-child')
    assert.equal(loaded.projects[0].parentGroupId, 'alpha')
    assert.equal(loaded.projects[0].sharedContextId, 'alpha-shared')
    assert.equal(loaded.projects[0].knowledgeStatus, 'locked')
    assert.throws(
      () => resolveWorkspaceProject(loaded, 'alpha'),
      (error) => error.code === ERROR_CODES.PROJECT_GROUP_TARGET,
    )
    const redacted = redactLoadedWorkspace({ ...loaded, workspaceId: 'ws_nested_test' })
    assert.equal(JSON.stringify(redacted).includes(fixtureValue.root), false)
    assert.equal(redacted.projectGroups[0].childProjectIds[0], 'alpha-child')
  } finally {
    await rm(fixtureValue.root, { recursive: true, force: true })
  }
})

test('Workspace loader ignores legacy Loop Project entries without blocking dsh ProjectGroups', async () => {
  const fixtureValue = await fixture()
  const legacyRoot = join(fixtureValue.root, 'projects', 'legacy-project', '.loop')
  await mkdir(legacyRoot, { recursive: true })
  await writeFile(join(legacyRoot, 'project.yaml'), `kind: Project
id: legacy-project
name: Legacy Project
root: .
defaultBranch: main
`, 'utf8')
  try {
    const loaded = await loadWorkspaceConfig(fixtureValue.root)
    assert.equal(loaded.status, 'attention')
    assert.equal(loaded.projects.length, 1)
    assert.equal(loaded.projects[0].sourceProjectId, 'alpha')
    assert.equal(loaded.diagnostics.length, 1)
    assert.equal(loaded.diagnostics[0].code, 'XIAOBAI_LEGACY_PROJECT_IGNORED')
    assert.equal(loaded.diagnostics[0].severity, 'warning')
    assert.equal(loaded.diagnostics[0].sourceProjectId, 'legacy-project')
    assert.match(loaded.diagnostics[0].field, /projects[\\/]legacy-project[\\/]\.loop[\\/]project\.yaml$/u)
    assert.equal(loaded.diagnostics[0].message, 'Legacy Loop Project configuration is not a dsh ProjectGroup and was ignored.')
  } finally {
    await rm(fixtureValue.root, { recursive: true, force: true })
  }
})

test('Workspace loader merges explicit project context bindings deterministically without a background mount', async () => {
  const value = await fixture()
  const groupRoot = join(value.root, 'projects', 'alpha')
  const childrenRoot = join(groupRoot, 'projects')
  const childRoot = join(childrenRoot, 'dcm')
  await mkdir(join(childRoot, '.loop'), { recursive: true })
  await writeFile(join(groupRoot, '.loop', 'project.yaml'), `kind: ProjectGroup
id: alpha
name: Alpha
owner: platform
classification: internal
skill: SKILL.md
children:
  directory: projects
  requireSingleRepository: true
knowledgeBindings:
  - knowledgeId: know_engineering_rules
    source: bundled:tmax-engineering
    revision: r1
    digest: sha256:${'1'.repeat(64)}
    scope: alpha
    readOnly: true
    trust: bundled
repositories:
  - id: alpha-repository
    name: alpha-repository
    localPathKey: alphaRepository
    mount: mounts/alpha-repository
`, 'utf8')
  await writeFile(join(childRoot, '.loop', 'project.yaml'), `kind: Project
id: tmax-dcm
name: dcm
root: .
defaultBranch: master
parentGroup: alpha
knowledgeBindings:
  - knowledgeId: know_ima_dcm
    source: ima:tmax-dcm
    revision: ima-r1
    digest: sha256:${'2'.repeat(64)}
    scope: tmax-dcm
    readOnly: true
    trust: external
repositories:
  - id: dcm
    name: dcm
    mount: ../../../../mounts/alpha-repository
`, 'utf8')
  try {
    const loaded = await loadWorkspaceConfig(value.root)
    assert.equal(loaded.status, 'loaded')
    assert.equal(loaded.projects.length, 1)
    const bindings = loaded.projects[0].baseline.knowledgeBindings
    assert.deepEqual(bindings.map((binding) => binding.knowledgeId), ['know_engineering_rules', 'know_ima_dcm'])
    assert.equal(loaded.projects[0].knowledgeStatus, 'locked')
  } finally {
    await rm(value.root, { recursive: true, force: true })
  }
})

test('Workspace loader fails closed on an approved-root escape', async () => {
  const fixtureValue = await fixture()
  const outside = await mkdtemp(join(tmpdir(), 'xiaobai-outside-'))
  try {
    await writeFile(join(fixtureValue.root, 'projects', 'alpha', '.loop', 'local.paths.yaml'), `repositories:
  alphaRepository:
    path: ${outside}
    approvedRoots:
      - ${fixtureValue.repositoryRoot}
background:
  alphaContext: ${fixtureValue.backgroundRoot}
`, 'utf8')
    const loaded = await loadWorkspaceConfig(fixtureValue.root)
    assert.equal(loaded.status, 'invalid')
    assert.ok(loaded.diagnostics.some((diagnostic) => diagnostic.code === ERROR_CODES.PATH_ESCAPE))
  } finally {
    await rm(fixtureValue.root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('Loop catalog exposes planning metadata and refuses execution without a Host bridge', async () => {
  const catalog = await loadLoopCatalog(fileURLToPath(new URL('../../../../workspace', import.meta.url)))
  assert.equal(catalog.schemaVersion, 'xiaobai.loop-catalog/v1')
  assert.ok(catalog.loops.some((loop) => loop.loopId === 'morning-triage'))
  const service = new LoopCatalogService({ loader: async () => catalog })
  await service.load(catalog.workspaceRoot)
  const plan = service.plan({ loopId: 'morning-triage' })
  assert.equal(plan.status, 'plan-only')
  assert.deepEqual(plan.blockers, ['execution-bridge-unavailable'])
  assert.equal(plan.executionBridge.available, false)
  await assert.rejects(() => service.run({ loopId: 'morning-triage' }), (error) => error.code === ERROR_CODES.EXECUTION_UNSUPPORTED)
})

test('Loop plan clears the execution blocker only for a healthy, explicitly provided bridge', async () => {
  const catalog = await loadLoopCatalog(fileURLToPath(new URL('../../../../workspace', import.meta.url)))
  const service = new LoopCatalogService({ loader: async () => catalog })
  await service.load(catalog.workspaceRoot)
  const healthy = service.plan({ loopId: 'morning-triage', executionBridge: { available: true, url: 'http://127.0.0.1:8791', checkedAt: '2026-09-02T00:00:00.000Z' } })
  assert.equal(healthy.status, 'bridge-ready')
  assert.deepEqual(healthy.blockers, [])
  assert.equal(healthy.executionBridge.available, true)
  assert.equal(healthy.executionBridge.url, 'http://127.0.0.1:8791')
  const unreachable = service.plan({ loopId: 'morning-triage', executionBridge: { available: false, url: 'http://127.0.0.1:8791', checkedAt: '2026-09-02T00:00:00.000Z' } })
  assert.equal(unreachable.status, 'plan-only')
  assert.deepEqual(unreachable.blockers, ['execution-bridge-unavailable'])
})

test('Loop catalog discovers declared Project Skill Package Loops through the same core facade', async () => {
  const fixtureValue = await fixture()
  const packageRoot = join(fixtureValue.backgroundRoot, 'xiaobai')
  await mkdir(join(packageRoot, 'loops'), { recursive: true })
  await writeFile(join(fixtureValue.root, 'projects', 'alpha', '.loop', 'project.yaml'), `kind: ProjectGroup
id: alpha
name: Alpha
owner: platform
localPaths: .loop/local.paths.yaml
background:
  id: alpha-context
  localPathKey: alphaContext
  mount: ../../mounts/alpha-background
  integration:
    kind: skill-context
    version: 2.0.0
    assets:
      loops:
        package-loop: xiaobai/loops/package-loop.loop.yaml
repositories:
  - id: alpha-repository
    name: alpha-repository
    localPathKey: alphaRepository
    mount: mounts/alpha-repository
`, 'utf8')
  await writeFile(join(packageRoot, 'loops', 'package-loop.loop.yaml'), `kind: Loop
version: 1
metadata:
  id: package-loop
  name: Package Loop
  owner: package-owner
handoff:
  project: alpha
  targetResolution:
    required: true
workflow:
  stages:
    - id: package-stage
      kind: review
      gate: automatic
verification:
  evaluator: evaluator.agent.yaml
  requiredChecks:
    - unit-tests
  allowSelfReview: false
persistence:
  memory:
    stateFile: memory/package-loop/state.md
    inboxFile: memory/package-loop/inbox.md
    runLog: memory/package-loop/runs.jsonl
`, 'utf8')
  try {
    const catalog = await loadLoopCatalog(fixtureValue.root)
    const loop = catalog.loops.find((candidate) => candidate.loopId === 'package-loop')
    assert.ok(loop)
    assert.equal(loop.sourceKind, 'skill-package')
    assert.equal(loop.targetProjectId, 'alpha')
    assert.equal(loop.contextSources.evaluator, 'evaluator.agent.yaml')
    assert.equal(loop.memoryWrites.length, 3)
    assert.equal(JSON.stringify(catalog).includes(fixtureValue.root), false)
  } finally {
    await rm(fixtureValue.root, { recursive: true, force: true })
  }
})

test('Monitor projection contains only redacted metadata and explicit unmeasured timing', () => {
  const projection = buildMonitorProjection({
    workspace: { id: 'ws_projection_test', title: 'Projection Test', status: 'attention', projects: [] },
    projects: [{
      sourceProjectId: 'alpha',
      baseline: {
        projectId: 'prj_alpha_test',
        key: 'alpha',
        displayName: 'Alpha',
        owner: 'platform',
        classification: 'internal',
        repositories: [{ mounted: true }],
        knowledgeBindings: [{ knowledgeId: 'know_alpha_test', digest: 'sha256:alpha' }],
        skills: [{ skillId: 'skill_alpha_test' }],
        agentProfiles: [{ agentId: 'agent_alpha_test' }],
        memory: { namespaceId: 'mem_alpha_test' },
      },
      knowledgeStatus: 'locked',
      configDigest: 'sha256:config',
    }],
    loops: [{ loopId: 'alpha-loop', name: 'Alpha Loop', source: '/private/secret/loop.yaml', stageCount: 1 }],
    runs: [{ runId: 'run_alpha_test', loopId: 'alpha-loop', projectId: 'prj_alpha_test', stages: [{ stageId: 'stage_alpha_test', evidence: ['/private/secret/evidence.json'] }] }],
    warnings: [{ code: 'secret', source: 'C:\\\\private\\\\secret\\\\config.yaml', message: 'password=hidden' }],
  })
  const serialized = JSON.stringify(projection)
  assert.equal(projection.schemaVersion, 'xiaobai.monitor/v1')
  assert.equal(projection.runs[0].stages[0].status, 'unmeasured')
  assert.equal(projection.runs[0].stages[0].durationMs, null)
  assert.equal(serialized.includes('/private/secret'), false)
  assert.equal(serialized.includes('C:\\\\private\\\\secret'), false)
  assert.equal(serialized.includes('password=hidden'), false)
  assert.equal(isSafeMonitorProjection(projection), true)
})

test('Workspace storage persists digests and status without machine-local bindings', async () => {
  const tables = new Map()
  const domain = { table(name) { if (!tables.has(name)) tables.set(name, new Map()); const table = tables.get(name); return { put: async (key, value) => table.set(key, value), get: (key) => table.get(key), entries: () => table.entries(), delete: async (key) => table.delete(key) } } }
  const store = new WorkspaceRegistryStore(domain)
  await store.saveWorkspace({ id: 'ws_storage_test', hostId: 'host', path: '/private/workspace', title: 'Storage Test', configDigest: 'sha256:workspace', sourceRevision: 'filesystem', status: 'loaded' }, [{ baseline: { projectId: 'prj_storage_test' }, sourceProjectId: 'storage', configPath: '/private/workspace/projects/storage/.loop/project.yaml', configDigest: 'sha256:project', pathBindingDigest: 'sha256:binding', localBindings: { repo_test: { path: '/private/repository' } }, background: { id: 'storage-context', localPath: '/private/background', declaredMount: '/private/mount' }, knowledgeStatus: 'locked', repositoryStatuses: [] }])
  const persisted = store.listProjects('ws_storage_test')[0]
  assert.equal('localBindings' in persisted, false)
  assert.equal(JSON.stringify(persisted).includes('/private/background'), false)
  const workspaceRecord = store.getWorkspace('ws_storage_test')
  assert.equal('root' in workspaceRecord, false)
  assert.match(workspaceRecord.rootDigest, /^sha256:/)
  assert.equal('configPath' in persisted, false)
  assert.equal(persisted.configLocator, 'projects/storage/.loop/project.yaml')
  await store.saveWorkspace({ id: 'ws_storage_test', hostId: 'host', path: '/private/workspace', title: 'Storage Test', configDigest: 'sha256:workspace', sourceRevision: 'filesystem', status: 'loaded' }, [])
  assert.deepEqual(store.listProjects('ws_storage_test'), [])
  await store.close()
})

test('Workspace service is idempotent for the same digest and fail-closed on drift', async () => {
  const fixtureValue = await fixture()
  const loaded = await loadWorkspaceConfig(fixtureValue.root)
  const workspaces = new Map()
  const projectRows = new Map()
  const attempts = []
  const conflicts = []
  const store = {
    getWorkspace: (id) => workspaces.get(id),
    findWorkspaceByRoot: (root) => [...workspaces.values()].find((workspace) => workspace.root === root),
    saveWorkspace: async (workspace, projects) => {
      workspaces.set(workspace.id, { workspaceId: workspace.id, hostWorkspaceId: workspace.hostId, root: workspace.path, title: workspace.title, configDigest: workspace.configDigest, sourceRevision: workspace.sourceRevision, status: workspace.status })
      projectRows.clear()
      for (const project of projects) projectRows.set(project.baseline.projectId, { projectId: project.baseline.projectId, baseline: project.baseline, configDigest: project.configDigest, pathBindingDigest: project.pathBindingDigest })
    },
    recordLoadAttempt: async (attempt) => attempts.push(attempt),
    recordConflict: async (conflict) => conflicts.push(conflict),
    close: async () => {},
    listProjects: () => [...projectRows.values()],
  }
  const registry = {
    projects: new Map(),
    attachWorkspace: async (path, title) => ({ id: 'ws_service_test', hostId: 'host_service_test', path, title }),
    get(projectId) { return this.projects.get(projectId) },
    registerBaseline(baseline) { this.projects.set(baseline.projectId, baseline); return baseline },
    replaceBaseline(baseline) { this.projects.set(baseline.projectId, baseline); return baseline },
    unregisterBaseline(projectId) { this.projects.delete(projectId) },
    list() { return [...this.projects.values()] },
    closeProject: async () => {},
  }
  let next = loaded
  const service = new WorkspaceService({}, registry, { loader: { load: async () => structuredClone(next) }, storeFactory: async () => store })
  try {
    const first = await service.load({ workspaceRoot: fixtureValue.root })
    const second = await service.load({ workspaceRoot: fixtureValue.root })
    assert.equal(first.configDigest, second.configDigest)
    assert.equal(conflicts.length, 0)
    next = { ...loaded, configDigest: 'sha256:changed' }
    const drift = await service.load({ workspaceRoot: fixtureValue.root })
    assert.equal(drift.status, 'drift')
    assert.equal(conflicts.length, 1)
    assert.equal(attempts.at(-1).status, 'drift')
    next = { ...loaded, projects: loaded.projects.map((project) => ({ ...project, pathBindingDigest: 'sha256:path-binding-changed' })) }
    const bindingDrift = await service.load({ workspaceRoot: fixtureValue.root })
    assert.equal(bindingDrift.status, 'drift')
    assert.equal(conflicts.at(-1).reason, 'path-binding')
    assert.equal(attempts.at(-1).status, 'drift')
    for (const field of ['enteredAt', 'firstActionAt', 'exitedAt', 'durationMs', 'activeMs', 'waitingMs', 'waitingReason', 'timingSource']) assert.ok(attempts.at(-1)[field] !== undefined, `load attempt lacks ${field}`)
    assert.deepEqual(attempts.at(-1).evidence, [`workspace/ws_service_test/load-attempts/${attempts.at(-1).loadId}`])
    next = { ...loaded, configDigest: 'sha256:approved-reload' }
    const reloaded = await service.load({ workspaceRoot: fixtureValue.root, mode: 'reload' })
    assert.equal(reloaded.status, 'loaded')
    assert.equal(workspaces.get('ws_service_test').configDigest, 'sha256:approved-reload')
  } finally {
    await service.close()
    await rm(fixtureValue.root, { recursive: true, force: true })
  }
})

test('Workspace command diagnostics expose only relative locators and redacted messages', async () => {
  const redacted = redactLoadedWorkspace({
    schemaVersion: 'xiaobai.workspace/v1',
    workspaceRoot: '/private/workspace',
    workspaceId: 'ws_redaction_test',
    title: 'Redaction Test',
    sourceRevision: 'filesystem',
    configDigest: 'sha256:workspace',
    status: 'invalid',
    diagnostics: [{ code: 'XIAOBAI_CONFIG_INVALID', severity: 'error', field: '/private/workspace/projects/alpha/.loop/project.yaml', message: "Cannot read '/private/workspace/projects/alpha/.loop/project.yaml' password=hidden" }],
    projects: [],
  })
  const serialized = JSON.stringify(redacted)
  assert.equal(redacted.diagnostics[0].field, 'projects/alpha/.loop/project.yaml')
  assert.equal(serialized.includes('/private/workspace'), false)
  assert.equal(serialized.includes('password=hidden'), false)
})

test('Workspace recovery survives a new service instance without persisting machine paths', async () => {
  const fixtureValue = await fixture()
  const tables = new Map()
  const domain = {
    table(name) {
      if (!tables.has(name)) tables.set(name, new Map())
      const table = tables.get(name)
      return {
        put: async (key, value) => table.set(key, value),
        get: (key) => table.get(key),
        entries: () => table.entries(),
        delete: async (key) => table.delete(key),
      }
    },
    close: async () => {},
  }
  const hostContext = {
    get: (key) => key === 'workspaceRegistry' ? { create: async (path, title) => ({ id: 'host-recovery', path, title }) } : undefined,
  }
  const firstRegistry = new (await import('../lib/project.js')).ProjectRegistry(hostContext)
  const first = await loadWorkspaceConfig(fixtureValue.root)
  const firstService = new WorkspaceService(hostContext, firstRegistry, { storeFactory: async () => new WorkspaceRegistryStore(domain) })
  try {
    await firstService.load({ workspaceRoot: fixtureValue.root })
    await firstService.close()
    const secondRegistry = new (await import('../lib/project.js')).ProjectRegistry(hostContext)
    const secondService = new WorkspaceService(hostContext, secondRegistry, { storeFactory: async () => new WorkspaceRegistryStore(domain) })
    try {
      const recovered = await secondService.recover({ workspaceRoot: fixtureValue.root })
      assert.equal(recovered.configDigest, first.configDigest)
      assert.equal(recovered.projects.length, 1)
      assert.equal(recovered.projects[0].baseline.projectId, first.projects[0].baseline.projectId)
      assert.equal(JSON.stringify(redactLoadedWorkspace(recovered)).includes(fixtureValue.root), false)
    } finally {
      await secondService.close()
    }
  } finally {
    await rm(fixtureValue.root, { recursive: true, force: true })
  }
})

test('Workspace service rolls back registered baselines when persistence fails late', async () => {
  const fixtureValue = await fixture()
  const loaded = await loadWorkspaceConfig(fixtureValue.root)
  const registered = []
  const registry = {
    workspace: undefined,
    projects: new Map(),
    attachWorkspace: async (path, title) => ({ id: 'ws-late-failure', hostId: 'host-late-failure', path, title }),
    get(projectId) { return this.projects.get(projectId) },
    registerBaseline(baseline) { this.projects.set(baseline.projectId, baseline); registered.push(baseline.projectId) },
    replaceBaseline(baseline) { this.projects.set(baseline.projectId, baseline) },
    unregisterBaseline(projectId) { this.projects.delete(projectId) },
    list() { return [...this.projects.values()] },
    closeProject: async () => {},
  }
  const store = {
    attempts: [],
    getWorkspace: () => undefined,
    findWorkspaceByRoot: () => undefined,
    saveWorkspace: async () => { throw new Error('late storage failure') },
    recordLoadAttempt: async (attempt) => store.attempts.push(attempt),
    close: async () => {},
    listProjects: () => [],
  }
  const service = new WorkspaceService({}, registry, { loader: { load: async () => structuredClone(loaded) }, storeFactory: async () => store })
  try {
    await assert.rejects(() => service.load({ workspaceRoot: fixtureValue.root }), /late storage failure/)
    assert.deepEqual(registered, [loaded.projects[0].baseline.projectId])
    assert.deepEqual(registry.list(), [])
    assert.equal(store.attempts[0].status, 'failed')
    assert.deepEqual(store.attempts[0].evidence, [`workspace/ws-late-failure/load-attempts/${store.attempts[0].loadId}`])
  } finally {
    await service.close()
    await rm(fixtureValue.root, { recursive: true, force: true })
  }
})
