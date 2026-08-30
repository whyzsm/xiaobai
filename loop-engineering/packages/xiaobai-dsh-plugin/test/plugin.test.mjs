import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeChainOf, scopeOf } from '@deepseek-ai/dsh-scope'
import {
  ERROR_CODES,
  FIXED_DIGEST_WORKFLOW_SCRIPT_HASH,
  FIXED_DIGEST_WORKFLOW_SCRIPT,
  assertFixedWorkflowScript,
  assertGateSuccess,
  assessProjectBaseline,
  bootstrapProjectBaseline,
  buildContextLock,
  buildRunLock,
  evaluateStage,
  MemoryDomain,
  openMemoryDomain,
  persistLock,
  ProjectRegistry,
  registerSkillProvider,
  registerGateAnswerer,
  requestGate,
  runM0Probe,
  sha256Digest,
  validateLock,
  runMinimumVerticalPath,
} from '../lib/index.js'

function makeBaseline(key, owner) {
  return bootstrapProjectBaseline({ key, owner, repository: { name: key, root: `repos/${key}` } })
}

function memoryProvenance(project) {
  const knowledge = project.knowledgeBindings[0]
  return { source: knowledge.source, revision: knowledge.revision, digest: knowledge.digest, scope: project.projectId, trust: knowledge.trust }
}

test('bootstraps a complete baseline and reports missing fields', () => {
  const baseline = makeBaseline('project-a', 'owner-a')
  assert.equal(assessProjectBaseline(baseline).valid, true)
  const assessment = assessProjectBaseline({})
  assert.equal(assessment.valid, false)
  assert.ok(assessment.missing.includes('projectId'))
})

test('adapts a Host UUID Workspace id into a stable plugin resource id', async () => {
  const hostWorkspaceId = 'c424d2df-c66f-4bbf-ac93-eed4b8ad95ba'
  const registry = new ProjectRegistry({
    get: (key) => key === 'workspaceRegistry' ? { create: async (path, title) => ({ id: hostWorkspaceId, path, title }) } : undefined,
  })
  const workspace = await registry.attachWorkspace('/tmp/xiaobai-workspace', 'workspace')
  assert.match(workspace.id, /^ws_[a-z0-9][a-z0-9_-]{2,63}$/)
  assert.equal(workspace.hostId, hostWorkspaceId)
  assert.notEqual(workspace.id, hostWorkspaceId)
})

test('ProjectRegistry keeps two projects isolated and requires their exact scope context', () => {
  const scopes = new Map()
  const registry = new ProjectRegistry({ get() {} }, {
    scopeReader: (ctx) => ctx.key,
    scopeFactory: (_ctx, key) => {
      const scoped = { key }
      const entry = { ctx: scoped, dispose: async () => {} }
      scopes.set(key, entry)
      return entry
    },
  })
  const first = makeBaseline('project-a', 'owner-a')
  const second = makeBaseline('project-b', 'owner-b')
  registry.registerBaseline(first)
  registry.registerBaseline(second)
  const firstScope = registry.openProject(first.projectId)
  const secondScope = registry.openProject(second.projectId)
  assert.notEqual(firstScope.scopeKey, secondScope.scopeKey)
  assert.equal(registry.assertProjectContext(first.projectId, firstScope.ctx).projectId, first.projectId)
  assert.throws(() => registry.assertProjectContext(first.projectId, secondScope.ctx), (error) => error.code === ERROR_CODES.SCOPE_REQUIRED)
  assert.throws(() => registry.assertSameProject(first.projectId, second.projectId), (error) => error.code === ERROR_CODES.CAPABILITY_DENIED)
  assert.equal(scopes.size, 2)
})

test('real dsh-scope parent and child contexts expose only their explicit scope chain', async () => {
  const root = new Context()
  const parentKey = {}
  const childKey = {}
  const parent = createScope(root, parentKey)
  const child = createScope(parent.ctx, childKey, { parent: parentKey })
  assert.equal(scopeOf(parent.ctx), parentKey)
  assert.equal(scopeOf(child.ctx), childKey)
  assert.deepEqual(scopeChainOf(childKey), [childKey, parentKey])
  await child.dispose()
  await parent.dispose()
})

test('registers a project Skill through the Host provider seam', async () => {
  let factory
  const ctx = { get: (key) => key === 'skills' ? { registerProvider: (create) => { factory = create; return () => { factory = undefined } } } : undefined }
  const baseline = makeBaseline('project-a', 'owner-a')
  const disposer = registerSkillProvider(ctx, baseline.skills[0])
  const provider = factory({ signal: new AbortController().signal, invalidate() {} })
  const candidates = await provider.list({ cwd: '/tmp' })
  assert.equal(candidates[0].name, baseline.skills[0].name)
  assert.equal((await provider.get(candidates[0], {})).metadata.skillId, baseline.skills[0].skillId)
  assert.equal(await provider.get(null, {}), undefined)
  disposer()
  assert.equal(factory, undefined)
})

test('run lock accepts the fixed workflow digest and fails closed on drift', () => {
  const project = makeBaseline('project-a', 'owner-a')
  const knowledge = project.knowledgeBindings[0]
  const contextLock = buildContextLock({ project, workspaceId: 'ws_workspace_a', knowledge, agentPolicyDigest: sha256Digest('agent-policy'), skillRevision: '1.0.0', memoryNamespaceId: project.memory.namespaceId })
  const lock = buildRunLock({ workspaceId: 'ws_workspace_a', project, scopeKey: `scope:${project.projectId}`, knowledge: [knowledge], agentPolicyDigest: contextLock.agentPolicyDigest, skillRevision: '1.0.0', workflowScriptDigest: FIXED_DIGEST_WORKFLOW_SCRIPT_HASH, policyDigest: sha256Digest('workflow-policy'), artifactRoot: project.artifactRoot })
  assert.equal(validateLock(lock, { workspaceId: lock.workspaceId, projectId: lock.projectId, scopeKey: lock.scopeKey, agentPolicyDigest: lock.agentPolicyDigest, skillRevision: lock.skillRevision, workflowScriptDigest: lock.workflowScriptDigest, policyDigest: lock.policyDigest, memoryNamespaceId: lock.memoryNamespaceId }), true)
  assert.throws(() => validateLock(lock, { workflowScriptDigest: sha256Digest('unreviewed-script') }), (error) => error.code === ERROR_CODES.LOCK_DRIFT)
  assert.equal(assertFixedWorkflowScript(FIXED_DIGEST_WORKFLOW_SCRIPT), FIXED_DIGEST_WORKFLOW_SCRIPT_HASH)
})

test('persists lock only below the approved artifact root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xiaobai-plugin-'))
  try {
    const project = makeBaseline('project-a', 'owner-a')
    const knowledge = project.knowledgeBindings[0]
    const lock = buildRunLock({ workspaceId: 'ws_workspace_a', project, scopeKey: `scope:${project.projectId}`, knowledge: [knowledge], agentPolicyDigest: sha256Digest('agent-policy'), skillRevision: '1.0.0', workflowScriptDigest: FIXED_DIGEST_WORKFLOW_SCRIPT_HASH, policyDigest: sha256Digest('workflow-policy'), artifactRoot: root })
    const target = await persistLock(lock, root)
    assert.match(target, /lock\.json$/)
    assert.equal(JSON.parse(await readFile(target, 'utf8')).runId, lock.runId)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('persistLock rejects an artifact root or run directory that escapes by symlink', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xiaobai-plugin-'))
  const outside = await mkdtemp(join(tmpdir(), 'xiaobai-plugin-outside-'))
  try {
    const project = makeBaseline('project-a', 'owner-a')
    const knowledge = project.knowledgeBindings[0]
    const lock = buildRunLock({ runId: 'run_symlink_test', workspaceId: 'ws_workspace_a', project, scopeKey: `scope:${project.projectId}`, knowledge: [knowledge], agentPolicyDigest: sha256Digest('agent-policy'), skillRevision: '1.0.0', workflowScriptDigest: FIXED_DIGEST_WORKFLOW_SCRIPT_HASH, policyDigest: sha256Digest('workflow-policy'), artifactRoot: root })
    await mkdir(join(root, 'runs'))
    await symlink(outside, join(root, 'runs', lock.runId))
    await assert.rejects(
      persistLock(lock, root),
      (error) => error.code === ERROR_CODES.PATH_ESCAPE,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('MemoryDomain rejects cross-project records', async () => {
  const project = makeBaseline('project-a', 'owner-a')
  const records = new Map()
  const domain = { table: () => ({ put: async (key, value) => records.set(key, value), get: (key) => records.get(key) }), close: async () => {} }
  const memory = new MemoryDomain(project, domain)
  await memory.put('one', { projectId: project.projectId, namespaceId: project.memory.namespaceId, kind: 'state', body: { ok: true }, sourceRef: 'test', createdAt: new Date().toISOString(), provenance: memoryProvenance(project), retention: 'project' })
  await assert.rejects(() => memory.put('two', { projectId: 'prj_other_project', namespaceId: 'mem_other_project', kind: 'state', body: {}, sourceRef: 'test', createdAt: new Date().toISOString(), provenance: memoryProvenance(project), retention: 'project' }), (error) => error.code === ERROR_CODES.CAPABILITY_DENIED)
})

test('openMemoryDomain requires the owning Project scope context', async () => {
  const project = makeBaseline('project-a', 'owner-a')
  const domain = { table: () => ({ put: async () => {}, get: () => undefined }), close: async () => {} }
  const ctx = { get: (key) => key === 'storageDomain' ? { open: async () => domain } : undefined }
  await assert.rejects(() => openMemoryDomain(ctx, project), (error) => error.code === ERROR_CODES.SCOPE_REQUIRED)
  const scope = { project, scopeKey: `scope:${project.projectId}`, ctx }
  const memory = await openMemoryDomain(ctx, project, { scope })
  await memory.close()
})

test('openMemoryDomain closes the Host domain when Project validation fails', async () => {
  const project = makeBaseline('project-a', 'owner-a')
  const invalidProject = { ...project, displayName: '' }
  let closed = 0
  const domain = { table: () => ({ put: async () => {}, get: () => undefined }), close: async () => { closed += 1 } }
  const ctx = { get: (key) => key === 'storageDomain' ? { open: async () => domain } : undefined }
  const scope = { project: invalidProject, scopeKey: `scope:${project.projectId}`, ctx }
  await assert.rejects(() => openMemoryDomain(ctx, invalidProject, { scope }), /Contract 'projectBaseline' failed typed schema validation/)
  assert.equal(closed, 1)
})

test('M0 probe cleans Host registrations and temporary Workspace after a failed operation', async () => {
  const ctx = new Context()
  const state = { skillDisposed: 0, approvalDisposed: 0, invariantDisposed: 0, typertDisposed: 0, workspaceDeleted: [] }
  const records = new Map()
  const domain = {
    table: () => ({ put: async () => { throw new Error('probe write failed') }, get: () => records.get('probe') }),
    close: async () => {},
  }
  ctx.provide('skills', { registerProvider: () => () => { state.skillDisposed += 1 } })
  ctx.provide('approval', { request: async () => 'unavailable' })
  ctx.provide('invariants', { register: () => () => { state.invariantDisposed += 1 } })
  ctx.provide('typert', { register: () => () => { state.typertDisposed += 1 }, toJSONSchema: () => ({ type: 'object' }) })
  ctx.provide('workspaceRegistry', { create: async (path, title) => ({ id: 'ws_m0_probe', path, title }), delete: async (id) => { state.workspaceDeleted.push(id) } })
  ctx.provide('storageDomain', { open: async () => domain })
  const originalOn = ctx.on.bind(ctx)
  ctx.on = (event, listener, ...options) => {
    const dispose = originalOn(event, listener, ...options)
    return event === 'approval/request' ? () => { state.approvalDisposed += 1; return dispose() } : dispose
  }
  await assert.rejects(() => runM0Probe(ctx, { hostVersionOptions: { searchPaths: [] } }), (error) => error.code === ERROR_CODES.HOST_UNSUPPORTED)
  assert.deepEqual(state.workspaceDeleted, ['ws_m0_probe'])
  assert.equal(state.skillDisposed, 1)
  assert.equal(state.approvalDisposed, 1)
  assert.equal(state.invariantDisposed, 1)
  assert.equal(state.typertDisposed, 1)
})

function approvalContext(outcome) {
  const events = []
  const agent = { session: { events } }
  return {
    agent,
    ctx: { get: (key) => key === 'approval' ? { request: async ({ toolName }) => { const id = 'approval-1'; events.push({ type: 'approval/asked', data: { id, toolName } }); events.push({ type: 'approval/decided', data: { id, outcome } }); return outcome } } : undefined },
  }
}

test('Human Gate maps Host approval and rejects missing audit evidence', async () => {
  const pass = approvalContext('allowed-once')
  const decision = await requestGate({ ctx: pass.ctx, agent: pass.agent, input: { change: 'safe' }, evidence: ['evidence:stage'], reason: 'Approve stage' })
  assert.equal(decision.outcome, 'allowed')
  assert.equal(decision.approval.asked, true)
  assert.equal(decision.approval.decided, true)
  assert.equal(assertGateSuccess(decision), decision)

  const reject = approvalContext('rejected')
  const rejected = await requestGate({ ctx: reject.ctx, agent: reject.agent, input: {}, evidence: ['evidence:stage'] })
  assert.equal(rejected.outcome, 'rejected')
  assert.throws(() => assertGateSuccess(rejected), (error) => error.code === ERROR_CODES.GATE_EVIDENCE_MISSING)
})

test('Human Gate answerer is prepended ahead of the Host interactive approval listener', () => {
  let options
  const disposer = registerGateAnswerer({ on: (_event, _listener, receivedOptions) => { options = receivedOptions; return () => {} } }, { decide: async () => 'allowed-once' })
  assert.deepEqual(options, { prepend: true })
  disposer()
})

test('Human Gate ignores stale and unrelated approval audit events', async () => {
  const events = [
    { type: 'approval/asked', data: { id: 'old', toolName: 'xiaobai-gate/old' } },
    { type: 'approval/decided', data: { id: 'old', outcome: 'allowed-once' } },
  ]
  const agent = { session: { events } }
  const ctx = { get: (key) => key === 'approval' ? { request: async ({ toolName }) => { events.push({ type: 'approval/asked', data: { id: 'new', toolName: 'other-tool' } }); events.push({ type: 'approval/decided', data: { id: 'new', outcome: 'allowed-once' } }); return 'allowed-once' } } : undefined }
  await assert.rejects(() => requestGate({ ctx, agent, gateId: 'gate_current', input: {}, evidence: ['evidence:stage'] }), (error) => error.code === ERROR_CODES.GATE_EVIDENCE_MISSING)
})

test('Human Gate maps a Host request failure and missing input to stable errors', async () => {
  const agent = { session: { events: [] } }
  const ctx = { get: (key) => key === 'approval' ? { request: async () => { throw new Error('outside an open turn') } } : undefined }
  await assert.rejects(() => requestGate({ ctx, agent, input: {}, evidence: ['evidence:stage'] }), (error) => error.code === ERROR_CODES.GATE_EVIDENCE_MISSING)
  await assert.rejects(() => requestGate({ ctx, agent, evidence: ['evidence:stage'] }), (error) => error.code === ERROR_CODES.CONTRACT_INVALID)
})

test('independent evaluator fails when output evidence is absent', () => {
  const result = evaluateStage({ evaluatorId: 'agent_evaluator_a', stageId: 'stage_stage_a', output: { ok: true }, outputContract: 'stage-result/v1' })
  assert.equal(result.valid, false)
  assert.equal(result.findings[0].code, 'EVIDENCE_MISSING')
})

test('minimum vertical path composes Workspace, two Projects, Skill, Memory, Workflow, Evaluator, and Gate', async () => {
  const projectA = makeBaseline('project-a', 'owner-a')
  const projectB = makeBaseline('project-b', 'owner-b')
  const tableData = new Map()
  const domain = { table: (name) => ({ put: async (key, value) => tableData.set(`${name}:${key}`, value), get: (key) => tableData.get(`${name}:${key}`) }), close: async () => {} }
  const events = []
  const providers = []
  let agentScopeBridgeCalls = 0
  const agent = { session: { events } }
  const hostContext = {
    get: (key) => ({
      workspaceRegistry: { create: async (path, title) => ({ id: 'ws_vertical_a', path, title }) },
      skills: { registerProvider: (create) => { providers.push(create); return () => {} } },
      storageDomain: { open: async () => domain },
      workflowEngine: { start: ({ args }) => ({ id: 'run_host_stage', result: Promise.resolve({ stopReason: 'completed', value: args }), dispose: async () => {} }) },
      approval: { request: async ({ toolName }) => { const id = 'approval-vertical'; events.push({ type: 'approval/asked', data: { id, toolName } }); events.push({ type: 'approval/decided', data: { id, outcome: 'allowed-once' } }); return 'allowed-once' } },
    }[key]),
    on: (_event, _listener) => () => {},
  }
  agent.ctx = hostContext
  const registry = {
    async attachWorkspace(path, title) { return hostContext.get('workspaceRegistry').create(path, title) },
    registerBaseline() {},
    openProject(projectId) { const project = projectId === projectA.projectId ? projectA : projectB; return { project, scopeKey: `scope:${projectId}`, ctx: hostContext, dispose: async () => {} } },
    openProjectForAgent(projectId, currentAgent) { agentScopeBridgeCalls += 1; assert.equal(currentAgent, agent); return this.openProject(projectId) },
    closeProject: async () => {},
  }
  const result = await runMinimumVerticalPath({ ctx: hostContext, workspacePath: '/tmp/project-workspace', projects: [{ key: 'project-a', owner: 'owner-a' }, { key: 'project-b', owner: 'owner-b' }], agent, gatePolicy: { decide: async () => 'allowed-once' }, gateInput: { delivery: 'test' }, projectRegistry: registry, persistArtifacts: false })
  assert.equal(result.projects.length, 2)
  assert.equal(result.decision.outcome, 'allowed')
  assert.equal(result.evaluation.status, 'passed')
  assert.equal(result.stageEvidence.waitingReason, 'permission-wait')
  assert.equal(providers.length, 1)
  assert.equal(agentScopeBridgeCalls, 1)
  assert.ok(tableData.has(`records:${projectA.projectId}:run-context:${result.runLock.runId}`))
  assert.ok(tableData.has(`audits:${projectA.projectId}:evidence_${result.runLock.runId.slice(4)}`))
})
