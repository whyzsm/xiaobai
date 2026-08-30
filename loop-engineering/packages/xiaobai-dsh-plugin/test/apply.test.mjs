import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../lib/index.js'

test('apply(ctx) provides Project, Workspace, and Loop facades without Host runtime construction', () => {
  const services = new Map()
  const commands = []
  const ctx = {
    invariants: { register: () => () => {} },
    get: (key) => ({
      skills: { registerProvider: () => () => {} },
      approval: { request: async () => 'allowed-once' },
      invariants: { register: () => () => {} },
      typert: { register: () => () => {} },
    }[key]),
    on: () => () => {},
    provide: (key, value) => { services.set(key, value); return () => {} },
    inject: (_keys, callback) => callback({ commands: { register: (definition) => { commands.push(definition.name); return () => {} } } }),
  }
  apply(ctx)
  assert.equal(services.has('xiaobaiProject'), true)
  assert.equal(services.has('xiaobaiWorkspace'), true)
  assert.equal(services.has('xiaobaiLoops'), true)
  assert.deepEqual(commands, ['project-bootstrap', 'project-assess', 'project-run', 'project-load', 'project-list', 'loop-list', 'loop-assess', 'loop-plan', 'loop-run'])
})
