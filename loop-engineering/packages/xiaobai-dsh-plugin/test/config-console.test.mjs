import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WorkspaceConfigService } from '../lib/config-console.js'
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
        capability: () => 'native',
        pick: async (signal) => {
          assert.ok(signal instanceof AbortSignal)
          return repositoryRoot
        },
      }
      return undefined
    },
    emit(event, value) { events.push({ event, value }) },
  }
  const service = new WorkspaceConfigService(ctx, workspaceService)
  assert.equal(service.typertRemote.service, service)
  assert.equal(service.typertRemote.serviceKey, 'xiaobaiConfig')
  assert.equal(service.typertRemote.namespace, 'xiaobaiConfig')
  assert.equal(Object.isFrozen(service.typertRemote), true)
  return { root, workspace, store, service, workspaceService, events, approvalEvents, repositoryRoot }
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
