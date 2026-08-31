import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WorkspaceConfigService } from '../lib/config-console.js'
import { getHostService } from '../lib/host.js'
import { ProjectConfigDraftSchema } from '../lib/typed.js'
import { loadWorkspaceConfig } from '../lib/workspace.js'

function createStore() {
  const tables = new Map()
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, new Map())
    const records = tables.get(name)
    return {
      put: async (key, value) => records.set(key, structuredClone(value)),
      get: (key) => records.get(key),
      entries: () => records.entries(),
      delete: async (key) => records.delete(key),
    }
  }
  return {
    saveDraft: async (value) => table('drafts').put(value.draftId, value),
    getDraft: (id) => table('drafts').get(id),
    saveRevision: async (value) => table('revisions').put(`${value.workspaceId}:${value.projectId}:${value.revision}`, value),
    getRevision: (workspaceId, projectId, revision) => table('revisions').get(`${workspaceId}:${projectId}:${revision}`),
    listRevisions: (workspaceId, projectId) => [...table('revisions').entries()].map(([, value]) => value).filter((value) => value.workspaceId === workspaceId && value.projectId === projectId).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))),
    saveApproval: async (value) => table('approvals').put(value.approvalId, value),
    getApproval: (id) => table('approvals').get(id),
    recordConfigAudit: async (value) => table('audit').put(value.auditId, value),
    listConfigAudit: (workspaceId, projectId) => [...table('audit').entries()].map(([, value]) => value).filter((value) => value.workspaceId === workspaceId && value.projectId === projectId),
  }
}

test('Host service lookup prefers Cordis injected properties over the local store', () => {
  const injected = { capability: () => ({ kind: 'native' }) }
  const context = { directoryPicker: injected, get: () => undefined }
  assert.equal(getHostService(context, 'directoryPicker'), injected)
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'xiaobai-config-console-'))
  const projectRoot = join(root, 'projects', 'alpha', '.loop')
  const repositoryRoot = join(root, 'repositories', 'alpha')
  const backgroundRoot = join(root, 'background', 'alpha')
  await mkdir(projectRoot, { recursive: true })
  await mkdir(repositoryRoot, { recursive: true })
  await mkdir(backgroundRoot, { recursive: true })
  await writeFile(join(projectRoot, 'project.yaml'), `kind: ProjectGroup
id: alpha
name: Alpha
owner: platform
classification: internal
background:
  id: alpha-context
  localPathKey: alphaContext
  mount: ../../../../background/alpha
repositories:
  - id: alpha-repository
    name: alpha-repository
    localPathKey: alphaRepository
    mount: ../../../../repositories/alpha
`, 'utf8')
  await writeFile(join(projectRoot, 'local.paths.yaml'), `background:
  alphaContext: ${backgroundRoot}
repositories:
  alphaRepository: ${repositoryRoot}
`, 'utf8')
  const loaded = await loadWorkspaceConfig(root, { title: 'Config Test Workspace' })
  const workspace = { ...loaded, workspaceId: 'ws_config_test' }
  const store = createStore()
  const workspaceService = {
    current: workspace,
    async load() { return this.current },
    async openStore() { return store },
  }
  const events = []
  const approvalEvents = []
  let pickerCapability = { kind: 'native' }
  const ctx = {
    get(key) {
      if (key === 'approval') return {
        request: async ({ toolName }) => {
          approvalEvents.push({ type: 'approval/asked', data: { id: 'approval-request-1', toolName } })
          approvalEvents.push({ type: 'approval/decided', data: { id: 'approval-request-1', outcome: 'allowed-once' } })
          return 'allowed-once'
        },
      }
      if (key === 'directoryPicker') return {
        capability: () => pickerCapability,
      }
      if (key === 'directoryPickerCapability') return {
        pick: async (signal) => {
          assert.ok(signal instanceof AbortSignal)
          return repositoryRoot
        },
      }
      return undefined
    },
    emit(event, value) { events.push({ event, value }) },
  }
  ctx.directoryPicker = {
    ...ctx.get('directoryPicker'),
    capability: () => typeof pickerCapability === 'string'
      ? pickerCapability
      : { ...pickerCapability, pick: ctx.get('directoryPickerCapability').pick },
  }
  ctx.approval = ctx.get('approval')
  const service = new WorkspaceConfigService(ctx, workspaceService)
  assert.equal(service.typertRemote.service, service)
  assert.equal(service.typertRemote.serviceKey, 'xiaobaiConfig')
  assert.equal(service.typertRemote.namespace, 'xiaobaiConfig')
  assert.equal(Object.isFrozen(service.typertRemote), true)
  return { root, workspace, store, service, workspaceService, events, approvalEvents, repositoryRoot, setPickerCapability: (value) => { pickerCapability = value } }
}

test('config contracts reject NUL, absolute, URI, traversal, and invalid binding locators', () => {
  const base = {
    schemaVersion: 'xiaobai.config/v1', draftId: 'drf_config_test', workspaceId: 'ws_config_test', operation: 'create',
    baseRevision: 'rev_config_test', baseDigest: `sha256:${'a'.repeat(64)}`, actor: { identity: 'test' }, createdAt: new Date().toISOString(),
    config: {
      key: 'alpha', displayName: 'Alpha', owner: 'platform', classification: 'internal', repositories: [], knowledgeBindings: [], agentProfiles: [], skills: [],
      memory: { namespaceId: 'mem_config_test', retention: 'project', projection: 'host-storage-domain' }, artifact: { locator: 'artifacts/alpha', readOnly: false }, qualityCommands: { validate: 'npm run validate', test: 'npm test' },
    },
  }
  for (const locator of ['/tmp/repository', 'C:\\repository', '\\\\server\\share', 'file:///tmp/repository', 'repositories/../secret', `repositories/bad\0path`]) {
    const result = ProjectConfigDraftSchema.safeParse({ ...base, config: { ...base.config, repositories: [{ name: 'repo', source: 'local', locator, readOnly: false, classification: 'internal' }], knowledgeBindings: [{ source: 'context', revision: '1', digest: `sha256:${'b'.repeat(64)}`, readOnly: true, trust: 'project' }], agentProfiles: [{ role: 'operator', purpose: 'operate', modelPolicyRef: 'policy/default', allowedSkills: [], requiredContext: [], capabilities: [], riskLevel: 'low', humanGatePolicy: 'required', outputContract: 'result/v1' }] } })
    assert.equal(result.success, false, locator)
  }
})

test('create and update drafts preserve Project identity and reject key changes', async (t) => {
  const value = await fixture()
  t.after(() => rm(value.root, { recursive: true, force: true }))
  const projectId = value.workspace.projects[0].baseline.projectId
  const current = await value.service.get({ refresh: false, projectId })
  assert.equal(current.status, 'ok')
  const probe = ProjectConfigDraftSchema.safeParse({ schemaVersion: 'xiaobai.config/v1', draftId: 'drf_config_test', workspaceId: 'ws_config_test', projectId, operation: 'update', baseRevision: current.data.revision, baseDigest: current.data.digest, actor: { identity: 'test' }, config: current.data.config, createdAt: new Date().toISOString() })
  assert.equal(probe.success, true, JSON.stringify(probe.error?.issues))
  const draft = await value.service.createDraft({ refresh: false, projectId, operation: 'update', config: { ...current.data.config, displayName: 'Alpha Updated' } })
  assert.equal(draft.status, 'ok', JSON.stringify(draft))
  assert.equal(draft.data.projectId, projectId)
  const changedKey = await value.service.createDraft({ refresh: false, projectId, operation: 'update', config: { ...current.data.config, key: 'renamed-project' } })
  assert.equal(changedKey.status, 'conflict')
})

test('nested child creation and update write the child config while keeping local paths at the group', async (t) => {
  const value = await fixture()
  t.after(() => rm(value.root, { recursive: true, force: true }))
  const groupRoot = join(value.root, 'projects', 'alpha')
  await mkdir(join(groupRoot, 'projects'), { recursive: true })
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
  mount: ../../../../background/alpha
children:
  directory: projects
  sharedContext: alpha-shared
  requireSingleRepository: true
repositories:
  - id: alpha-repository
    name: alpha-repository
    localPathKey: alphaRepository
    mount: ../../../../repositories/alpha
`, 'utf8')
  const loaded = await loadWorkspaceConfig(value.root)
  value.workspace = { ...loaded, workspaceId: 'ws_config_test' }
  value.workspaceService.current = value.workspace
  value.workspaceService.load = async ({ workspaceRoot }) => {
    const next = await loadWorkspaceConfig(workspaceRoot)
    value.workspaceService.current = { ...next, workspaceId: 'ws_config_test' }
    return value.workspaceService.current
  }
  const config = {
    key: 'child-project',
    parentGroupId: 'alpha',
    sharedContextId: 'alpha-shared',
    displayName: 'Child Project',
    owner: 'platform',
    classification: 'internal',
    repositories: [{ name: 'child-repository', source: 'mount', locator: 'repositories/child-repository', readOnly: false, classification: 'internal' }],
    knowledgeBindings: [{ knowledgeId: 'know_alpha_shared', source: 'skill-context:alpha', revision: '1.0.0', digest: `sha256:${'a'.repeat(64)}`, readOnly: true, trust: 'external' }],
    agentProfiles: [{ role: 'operator', purpose: 'Operate the child Project', modelPolicyRef: 'policy/default', allowedSkills: [], requiredContext: [], capabilities: [], riskLevel: 'low', humanGatePolicy: 'required', outputContract: 'result/v1' }],
    skills: [],
    memory: { namespaceId: 'mem_child_project', retention: 'project', projection: 'host-storage-domain' },
    artifact: { locator: 'artifacts/child-project', readOnly: false },
    qualityCommands: { validate: 'npm run validate', test: 'npm test' },
  }
  const draft = await value.service.createDraft({ refresh: false, operation: 'create', config })
  assert.equal(draft.status, 'ok', JSON.stringify(draft))
  const preview = await value.service.preview({ refresh: false, draft: draft.data })
  assert.equal(preview.status, 'ok', JSON.stringify(preview))
  assert.equal(preview.data.status, 'ready')
  assert.ok(preview.data.files.some((file) => file.locator === 'projects/alpha/projects/child-project/.loop/project.yaml'))
  assert.ok(preview.data.files.some((file) => file.locator === 'projects/alpha/.loop/local.paths.yaml'))
  assert.equal(preview.data.files.some((file) => file.locator.includes('projects/child-project/.loop/local.paths.yaml')), false)

  const approval = await value.service.requestApproval({ refresh: false, draft: draft.data, agent: { session: { events: value.approvalEvents } } })
  assert.equal(approval.status, 'ok', JSON.stringify(approval))
  const applied = await value.service.apply({ refresh: false, draftId: draft.data.draftId, approvalId: approval.data.approvalId })
  assert.equal(applied.status, 'ok', JSON.stringify(applied))
  const child = value.workspaceService.current.projects[0]
  assert.equal(child.parentGroupId, 'alpha')
  assert.equal(child.sharedContextId, 'alpha-shared')

  const current = await value.service.get({ refresh: false, projectId: child.baseline.projectId })
  const updateDraft = await value.service.createDraft({ refresh: false, projectId: child.baseline.projectId, operation: 'update', config: { ...current.data.config, displayName: 'Child Project Updated' } })
  assert.equal(updateDraft.status, 'ok', JSON.stringify(updateDraft))
  const updatePreview = await value.service.preview({ refresh: false, draft: updateDraft.data })
  assert.equal(updatePreview.status, 'ok', JSON.stringify(updatePreview))
  assert.equal(updatePreview.data.status, 'ready')
  assert.ok(updatePreview.data.files.some((file) => file.locator === 'projects/alpha/projects/child-project/.loop/project.yaml'))
  assert.equal(updatePreview.data.files.some((file) => file.locator === 'projects/alpha/projects/child-project/.loop/local.paths.yaml'), false)
})

test('list normalizes workspace diagnostics before returning the strict response envelope', async (t) => {
  const value = await fixture()
  t.after(() => rm(value.root, { recursive: true, force: true }))
  value.workspace.status = 'attention'
  value.workspace.diagnostics = [{
    code: 'XIAOBAI_LEGACY_PROJECT_IGNORED',
    severity: 'warning',
    sourceProjectId: 'legacy-project',
    projectId: 'prj_legacy_project',
    field: 'projects/legacy-project/.loop/project.yaml',
    message: `Legacy config at ${value.root} was ignored`,
  }]
  const result = await value.service.list({ refresh: false })
  assert.equal(result.status, 'ok', JSON.stringify(result))
  assert.deepEqual(result.diagnostics, [{
    code: 'XIAOBAI_LEGACY_PROJECT_IGNORED',
    severity: 'warning',
    field: 'projects/legacy-project/.loop/project.yaml',
    message: 'Legacy config at [redacted-path] was ignored',
    resourceId: 'prj_legacy_project',
  }])
})

test('projectCandidates returns filtered redacted Project summaries for the loaded Workspace', async (t) => {
  const value = await fixture()
  t.after(() => rm(value.root, { recursive: true, force: true }))
  const result = await value.service.projectCandidates({ refresh: false, query: 'alpha' })
  assert.equal(result.status, 'ok', JSON.stringify(result))
  assert.equal(result.data.projects.length, 1)
  assert.equal(result.data.projects[0].workspaceId, 'ws_config_test')
  assert.equal(result.data.projects[0].sourceProjectId, 'alpha')
  assert.equal(result.data.projects[0].knowledgeStatus, 'locked')
  assert.equal(result.data.projects[0].repositoryStatus, 'locked')
  assert.doesNotMatch(JSON.stringify(result), /(?:[a-z]:[\\/]|\\\\|\/Users\/|https?:\/\/)/u)
})

test('projectCandidates falls back to opaque identifiers for unsafe display metadata', async (t) => {
  const value = await fixture()
  t.after(() => rm(value.root, { recursive: true, force: true }))
  value.workspace.projects[0].sourceProjectId = '/Users/demo/private-project'
  value.workspace.projects[0].baseline.displayName = 'https://example.test/private-project'
  const result = await value.service.projectCandidates({ refresh: false })
  assert.equal(result.status, 'ok', JSON.stringify(result))
  assert.equal(result.data.projects[0].sourceProjectId, value.workspace.projects[0].baseline.projectId)
  assert.equal(result.data.projects[0].displayName, value.workspace.projects[0].baseline.projectId)
  assert.doesNotMatch(JSON.stringify(result), /(?:[a-z]:[\\/]|\\\\|\/Users\/|https?:\/\/)/u)
})

test('missing local binding is actionable and never guessed from the Workspace root', async (t) => {
  const value = await fixture()
  t.after(() => rm(value.root, { recursive: true, force: true }))
  const projectId = value.workspace.projects[0].baseline.projectId
  const current = await value.service.get({ refresh: false, projectId })
  const draft = await value.service.createDraft({ refresh: false, projectId, operation: 'update', config: { ...current.data.config, repositories: [{ ...current.data.config.repositories[0], bindingRef: 'binding_missing' }] } })
  const preview = await value.service.preview({ refresh: false, draft: draft.data })
  assert.equal(preview.status, 'invalid')
  assert.equal(preview.data.files.length, 0)
  assert.ok(preview.data.diagnostics.some((item) => item.message.includes('Select a Host directory')))
  assert.equal((await readFile(join(value.root, 'projects', 'alpha', '.loop', 'project.yaml'), 'utf8')).includes('binding_missing'), false)
})

test('directory picker validates native capability and returns only an opaque binding', async (t) => {
  const value = await fixture()
  t.after(() => rm(value.root, { recursive: true, force: true }))
  const result = await value.service.pickDirectory({ refresh: false, kind: 'repository' })
  assert.equal(result.status, 'ok')
  assert.match(result.data.bindingRef, /^binding_/)
  assert.equal(JSON.stringify(result).includes(value.repositoryRoot), false)
})

test('directory picker accepts a confirmed browse path and requires the browse UI', async (t) => {
  const value = await fixture()
  t.after(() => rm(value.root, { recursive: true, force: true }))
  value.setPickerCapability('browse')
  const result = await value.service.pickDirectory({ refresh: false, kind: 'repository', selectedPath: value.repositoryRoot })
  assert.equal(result.status, 'ok', JSON.stringify(result))
  assert.match(result.data.bindingRef, /^binding_/)
  assert.equal(JSON.stringify(result).includes(value.repositoryRoot), false)
  const missingPath = await value.service.pickDirectory({ refresh: false, kind: 'repository' })
  assert.equal(missingPath.status, 'unsupported')
  assert.match(missingPath.diagnostics[0].message, /浏览式目录选择/)
})

test('approval pairs use decided id and asked toolName, then apply one revision atomically', async (t) => {
  const value = await fixture()
  t.after(() => rm(value.root, { recursive: true, force: true }))
  const projectId = value.workspace.projects[0].baseline.projectId
  const current = await value.service.get({ refresh: false, projectId })
  const draft = await value.service.createDraft({ refresh: false, projectId, operation: 'update', config: { ...current.data.config, displayName: 'Alpha Applied' } })
  const agent = { session: { events: value.approvalEvents } }
  const approval = await value.service.requestApproval({ refresh: false, draft: draft.data, agent })
  assert.equal(approval.status, 'ok')
  const applied = await value.service.apply({ refresh: false, draftId: draft.data.draftId, approvalId: approval.data.approvalId })
  assert.equal(applied.status, 'ok')
  assert.equal(value.store.listRevisions('ws_config_test', projectId).length, 1)
  assert.equal(value.store.listConfigAudit('ws_config_test', projectId).length, 1)
  assert.equal(value.events[0].event, 'workspace.config.changed')
})

test('stale drafts return conflict and keep the recorded baseline unchanged', async (t) => {
  const value = await fixture()
  t.after(() => rm(value.root, { recursive: true, force: true }))
  const projectId = value.workspace.projects[0].baseline.projectId
  const current = await value.service.get({ refresh: false, projectId })
  const draft = await value.service.createDraft({ refresh: false, projectId, operation: 'update', config: { ...current.data.config, displayName: 'Stale' } })
  await value.store.saveRevision({ workspaceId: 'ws_config_test', projectId, revision: 'rev_previous', parentRevision: null, digest: `sha256:${'c'.repeat(64)}`, sourceDigest: value.workspace.projects[0].configDigest, config: current.data.config, changedFiles: ['projects/alpha/.loop/project.yaml'], createdAt: new Date().toISOString(), operation: 'update', actor: 'test', historyId: 'ev_previous' })
  const preview = await value.service.preview({ refresh: false, draft: draft.data })
  assert.equal(preview.status, 'conflict')
  assert.equal(preview.data.files.length, 0)
})
