import assert from 'node:assert/strict'
import test from 'node:test'
import { ERROR_CODES, PROJECT_COMMAND_NAMES, registerProjectCommands } from '../lib/index.js'

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
