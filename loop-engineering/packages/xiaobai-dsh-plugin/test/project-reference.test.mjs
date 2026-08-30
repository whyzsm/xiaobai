import assert from 'node:assert/strict'
import test from 'node:test'
import { bootstrapProjectBaseline } from '../lib/contracts.js'
import { ERROR_CODES } from '../lib/constants.js'
import { encodeProjectReference, extractProjectReferences, parseProjectReferenceText, projectPromptContext, registerProjectReferenceBridge, serializeProjectReference } from '../lib/project-reference.js'

const workspaceId = 'ws_reference_test'
const projectId = 'prj_reference_test'

function baseline() {
  return bootstrapProjectBaseline({
    projectId,
    key: 'reference-test',
    displayName: 'Reference Test',
    owner: 'platform',
    repository: { name: 'repository', root: 'repositories/reference-test' },
  })
}

function reference(label = 'reference-test') {
  return encodeProjectReference({ workspaceId, projectId, label })
}

test('project reference codec preserves identity without exposing paths', () => {
  const encoded = reference()
  assert.equal(serializeProjectReference(encoded), `<xiaobai-project workspace-id="${workspaceId}" project-id="${projectId}">reference-test</xiaobai-project>`)
  assert.deepEqual(parseProjectReferenceText(serializeProjectReference(encoded)), { text: 'reference-test', references: [{ workspaceId, projectId, label: 'reference-test' }] })
  assert.equal(JSON.stringify({ encoded, serialized: serializeProjectReference(encoded) }).includes('/Users/'), false)
})

test('project reference parser removes model markup and rejects malformed payloads', () => {
  const parsed = extractProjectReferences([{
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: `请修复 <xiaobai-project workspace-id="${workspaceId}" project-id="${projectId}">reference-test</xiaobai-project> 的问题` }],
  }])
  assert.equal(parsed.messages[0].content[0].text, '请修复 reference-test 的问题')
  assert.equal(parsed.references[0].projectId, projectId)
  assert.throws(() => parseProjectReferenceText(`<xiaobai-project project-id="${projectId}">reference-test</xiaobai-project>`), (error) => error.code === ERROR_CODES.PROJECT_REFERENCE_INVALID)
  assert.throws(() => encodeProjectReference({ workspaceId, projectId, label: '/private/repository' }), (error) => error.code === ERROR_CODES.PROJECT_REFERENCE_INVALID)
})

test('project prompt context contains only redacted workspace-relative metadata', () => {
  const text = projectPromptContext({ workspaceId }, baseline())
  assert.match(text, /prj_reference_test/)
  assert.match(text, /repositories\/reference-test/)
  assert.doesNotMatch(text, /(?:[a-z]:[\\/]|\\\\|\/Users\/|https?:\/\/)/u)
})

function bridgeFixture(overrides = {}) {
  const project = baseline()
  const entry = {
    baseline: project,
    projectId,
    knowledgeStatus: 'locked',
    repositoryStatuses: [{ repoId: project.repositories[0].repoId, status: 'locked' }],
    ...(overrides.entry ?? {}),
  }
  const agent = { id: 'agent_reference_test', status: 'running', ctx: { systemPrompt: { context(value) { agent.contextValue = value; return () => { agent.contextDisposed = true } } } } }
  const listeners = new Map()
  const ctx = { on(event, listener) { listeners.set(event, listener); return () => {} } }
  const registry = {
    get: () => overrides.registryBaseline === undefined ? project : overrides.registryBaseline,
    openProjectForAgent(id, currentAgent) { assert.equal(id, projectId); assert.equal(currentAgent, agent); agent.scopeOpened = true; return { dispose: async () => { agent.scopeDisposed = true } } },
    closeProject: async () => { agent.scopeClosed = true },
  }
  const workspaceService = { current: Object.hasOwn(overrides, 'workspace') ? overrides.workspace : { workspaceId, status: 'loaded', projects: [entry] } }
  registerProjectReferenceBridge(ctx, { workspaceService, projectRegistry: registry })
  return { listener: listeners.get('agent/pre-step'), claimed: listeners.get('agent/inbox/claimed'), disposed: listeners.get('agent/disposed'), agent, workspaceService }
}

test('project reference bridge opens the Agent-owned Project scope and injects prompt context', async () => {
  const fixture = bridgeFixture()
  const message = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `<xiaobai-project workspace-id="${workspaceId}" project-id="${projectId}">reference-test</xiaobai-project> 修复分页` }] }
  fixture.claimed({ agent: fixture.agent, message, turn: 1 })
  let contextAtAssembly
  const decision = await fixture.listener({ agent: fixture.agent, messages: [], signal: new AbortController().signal }, async () => {
    contextAtAssembly = fixture.agent.contextValue
    return { kind: 'enter', messages: [message] }
  })
  assert.equal(fixture.agent.scopeOpened, true)
  assert.equal(contextAtAssembly, fixture.agent.contextValue)
  assert.equal(fixture.agent.contextValue.name, 'xiaobai:project-context')
  assert.match(fixture.agent.contextValue.text(), /Reference Test/)
  assert.equal(decision.messages[0].content[0].text, 'reference-test 修复分页')
})

test('project reference bridge releases the Agent-owned scope when the Host Agent is disposed', async () => {
  const fixture = bridgeFixture()
  const message = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `<xiaobai-project workspace-id="${workspaceId}" project-id="${projectId}">reference-test</xiaobai-project>` }] }
  fixture.claimed({ agent: fixture.agent, message, turn: 1 })
  fixture.disposed({ agent: fixture.agent })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fixture.agent.contextDisposed, true)
  assert.equal(fixture.agent.scopeClosed, true)
})

test('project reference bridge fails closed for missing Workspace, cross-Workspace, drift, and unavailable bindings', async () => {
  const message = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: `<xiaobai-project workspace-id="${workspaceId}" project-id="${projectId}">reference-test</xiaobai-project>` }] }]
  for (const [overrides, code] of [
    [{ workspace: undefined }, ERROR_CODES.WORKSPACE_REQUIRED],
    [{ workspace: { workspaceId: 'ws_other_test', status: 'loaded', projects: [] } }, ERROR_CODES.CONFIG_CONFLICT],
    [{ workspace: { workspaceId, status: 'drift', projects: [] } }, ERROR_CODES.CONFIG_DRIFT],
    [{ entry: { knowledgeStatus: 'unavailable' } }, ERROR_CODES.KNOWLEDGE_LOCK_REQUIRED],
    [{ entry: { repositoryStatuses: [{ status: 'unavailable' }] } }, ERROR_CODES.REPOSITORY_UNAVAILABLE],
  ]) {
    const fixture = bridgeFixture(overrides)
    await assert.rejects(() => fixture.listener({ agent: fixture.agent, messages: [], signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: message })), (error) => error.code === code)
  }
})

test('project reference bridge keeps a request without a reference unchanged', async () => {
  const fixture = bridgeFixture()
  const decision = { kind: 'enter', messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '普通需求' }] }] }
  assert.equal(await fixture.listener({ agent: fixture.agent, messages: [], signal: new AbortController().signal }, async () => decision), decision)
  assert.equal(fixture.agent.scopeOpened, undefined)
})
