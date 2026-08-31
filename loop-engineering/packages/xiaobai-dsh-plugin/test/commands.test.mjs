import assert from 'node:assert/strict'
import test from 'node:test'
import { ERROR_CODES, PROJECT_COMMAND_NAMES, XiaobaiError, registerProjectCommands } from '../lib/index.js'

test('registers the three typed dsh command facades and delegates to the domain service', async () => {
  const definitions = []
  const calls = []
  const service = {
    bootstrapBaseline: async (input, options) => { calls.push(['bootstrap', input, options]); return { projectId: 'prj_created' } },
    assessBaseline: (input) => { calls.push(['assess', input]); return { valid: false, missing: ['owner'] } },
    run: async (input) => { calls.push(['run', input]); return { runId: 'run_created' } },
  }
  const dispose = registerProjectCommands({ commands: { register: (definition) => { definitions.push(definition); return () => {} } } }, service)
  assert.deepEqual(definitions.map((definition) => definition.name), PROJECT_COMMAND_NAMES)
  const bootstrap = await definitions[0].handler({ rawInput: '{"key":"project-a","owner":"team"}' })
  const assessment = await definitions[1].handler({ rawInput: '{"key":"project-a"}' })
  const run = await definitions[2].handler({ rawInput: '{"projectId":"prj_created"}', agent: { status: 'running' } })
  assert.equal(bootstrap.kind, 'success')
  assert.equal(assessment.kind, 'success')
  assert.equal(run.kind, 'success')
  assert.equal(calls[0][0], 'bootstrap')
  assert.equal(calls[1][0], 'assess')
  assert.equal(calls[2][0], 'run')
  assert.equal(calls[2][1].agent.status, 'running')
  await dispose()
})

test('project-assess uses the loaded Workspace service when an explicit workspace is supplied', async () => {
  const definitions = []
  const assessments = []
  const workspaceService = {
    current: undefined,
    load: async ({ workspaceRoot }) => {
      workspaceService.current = {
        workspaceRoot,
        workspaceId: 'ws_assess_test',
        status: 'loaded',
        projects: [{ projectId: 'prj_assess_test', sourceProjectId: 'assess-test' }],
      }
      return workspaceService.current
    },
    assessProject: (input) => {
      assessments.push(input)
      return {
        projectId: input.projectId,
        valid: true,
        knowledgeStatus: 'locked',
        diagnostics: [{ projectId: input.projectId, field: '/private/workspace/projects/alpha/.loop/project.yaml', message: "Cannot read '/private/workspace/projects/alpha/.loop/project.yaml' password=hidden" }],
      }
    },
  }
  const loopService = {
    current: undefined,
    load: async (workspaceRoot) => { loopService.current = { workspaceRoot }; return loopService.current },
  }
  registerProjectCommands(
    { commands: { register: (definition) => { definitions.push(definition); return () => {} } } },
    { assessBaseline: () => ({ valid: false }) },
    workspaceService,
    loopService,
  )
  const result = await definitions[1].handler({ rawInput: '{"workspaceRoot":"/private/workspace","projectId":"prj_assess_test"}' })
  const envelope = JSON.parse(result.text)
  assert.equal(envelope.ok, true)
  assert.deepEqual(assessments, [{ projectId: 'prj_assess_test' }])
  assert.equal(JSON.stringify(envelope).includes('/private/workspace'), false)
  assert.equal(envelope.value.diagnostics[0].field, 'projects/alpha/.loop/project.yaml')
  assert.equal(envelope.value.diagnostics[0].message.includes('password=hidden'), false)
})

test('project commands reject a ProjectGroup target even when the loaded catalog has no child rows', async () => {
  const definitions = []
  const workspaceService = {
    current: undefined,
    load: async ({ workspaceRoot }) => {
      workspaceService.current = {
        workspaceRoot,
        workspaceId: 'ws_group_target_test',
        status: 'loaded',
        projectGroups: [{ id: 't-max', childProjectIds: ['tmax-app'] }],
        projects: [],
        diagnostics: [],
      }
      return workspaceService.current
    },
    assessProject: () => ({ valid: true }),
  }
  registerProjectCommands(
    { commands: { register: (definition) => { definitions.push(definition); return () => {} } } },
    { assessBaseline: () => ({}) },
    workspaceService,
  )

  const result = await definitions[1].handler({ rawInput: '{"workspaceRoot":"/private/workspace","projectId":"t-max"}' })
  const envelope = JSON.parse(result.text)
  assert.equal(result.kind, 'error')
  assert.equal(envelope.error.code, ERROR_CODES.PROJECT_GROUP_TARGET)
})

test('command input parsing fails with the registered contract error', async () => {
  const definitions = []
  registerProjectCommands({ commands: { register: (definition) => { definitions.push(definition); return () => {} } } }, { assessBaseline: () => ({}) })
  await assert.rejects(() => definitions[1].handler({ rawInput: 'not-json' }), (error) => error.code === ERROR_CODES.CONTRACT_INVALID)
})

test('command registration cleans earlier facades when a later registration fails', () => {
  let registrations = 0
  let disposed = 0
  assert.throws(
    () => registerProjectCommands({ commands: { register: () => {
      registrations += 1
      if (registrations === 2) throw new Error('duplicate command')
      return () => { disposed += 1 }
    } } }, {}),
    /duplicate command/,
  )
  assert.equal(registrations, 2)
  assert.equal(disposed, 1)
})

test('workspace and Loop facades return versioned envelopes and keep paths out of the command result', async () => {
  const definitions = []
  const baseline = {
    schemaVersion: 'xiaobai.contracts/v1',
    projectId: 'prj_command_test',
    key: 'command-test',
    displayName: 'Command Test',
    owner: 'team',
    classification: 'internal',
    repositories: [],
    knowledgeBindings: [],
    agentProfiles: [],
    skills: [],
    memory: { namespaceId: 'mem_command_test', retention: 'project', projection: 'host-storage-domain' },
    artifactRoot: 'artifacts/command-test',
    qualityCommands: { validate: 'npm run validate', test: 'npm test' },
  }
  const loaded = {
    schemaVersion: 'xiaobai.workspace/v1',
    workspaceId: 'ws_command_test',
    title: 'Command Test',
    sourceRevision: 'filesystem',
    configDigest: 'sha256:workspace',
    status: 'loaded',
    diagnostics: [],
    projects: [{ baseline, sourceProjectId: 'command-test', source: { kind: 'project-group', id: 'command-test', revision: 'filesystem', digest: 'sha256:source' }, repositoryStatuses: [], knowledgeStatus: 'locked', configDigest: 'sha256:project', pathBindingDigest: 'sha256:binding' }],
  }
  const workspaceService = { current: undefined, load: async () => { workspaceService.current = loaded; return loaded } }
  const loopService = { current: undefined, load: async (workspaceRoot) => { loopService.current = { workspaceRoot, loops: [] }; return loopService.current }, list: () => ({ schemaVersion: 'xiaobai.loop-catalog/v1', loops: [] }), assess: () => ({ valid: true }), plan: () => ({ status: 'plan-only' }), run: async () => ({}) }
  registerProjectCommands({ commands: { register: (definition) => { definitions.push(definition); return () => {} } } }, { assessBaseline: () => ({}) }, workspaceService, loopService)
  const result = await definitions[3].handler({ rawInput: '{"workspaceRoot":"/private/workspace"}' })
  const envelope = JSON.parse(result.text)
  assert.equal(envelope.schemaVersion, 'xiaobai.command/v1')
  assert.equal(envelope.ok, true)
  assert.equal(envelope.value.workspaceId, 'ws_command_test')
  assert.equal(JSON.stringify(envelope).includes('/private/workspace'), false)
  await definitions[8].handler({ rawInput: '{"workspaceRoot":"/private/workspace","loopId":"missing"}' })
})

test('domain command failures use a redacted error envelope with stable phase and code', async () => {
  const definitions = []
  const workspaceService = {
    current: { workspaceRoot: '/private/workspace', workspaceId: 'ws_command_test' },
    load: async () => workspaceService.current,
  }
  const loopService = {
    current: { workspaceRoot: '/private/workspace' },
    list: () => ({ schemaVersion: 'xiaobai.loop-catalog/v1', loops: [] }),
    run: async () => { throw new XiaobaiError(ERROR_CODES.LOOP_NOT_FOUND, 'Loop is not registered', { phase: 'loop-run', resourceId: 'missing' }) },
  }
  registerProjectCommands(
    { commands: { register: (definition) => { definitions.push(definition); return () => {} } } },
    { assessBaseline: () => ({}) },
    workspaceService,
    loopService,
  )
  const result = await definitions[8].handler({ rawInput: '{"workspaceRoot":"/private/workspace","loopId":"missing"}' })
  const envelope = JSON.parse(result.text)
  assert.equal(result.kind, 'error')
  assert.equal(envelope.ok, false)
  assert.equal(envelope.error.code, ERROR_CODES.LOOP_NOT_FOUND)
  assert.equal(envelope.error.phase, 'loop-run')
  assert.equal(JSON.stringify(envelope).includes('/private/workspace'), false)
})
