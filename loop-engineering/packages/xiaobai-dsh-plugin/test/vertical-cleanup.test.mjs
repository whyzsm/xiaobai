import assert from 'node:assert/strict'
import test from 'node:test'
import { bootstrapProjectBaseline, runMinimumVerticalPath } from '../lib/index.js'

test('cleans every resource created before a late vertical-path failure', async () => {
  const first = bootstrapProjectBaseline({ key: 'project-a', owner: 'owner-a' })
  const second = bootstrapProjectBaseline({ key: 'project-b', owner: 'owner-b' })
  const state = { registered: [], opened: [], closed: [], unregistered: [], skillDisposed: 0, memoryClosed: 0 }
  const registry = {
    async attachWorkspace(path, title) { return { id: 'ws_cleanup_test', path, title } },
    registerBaseline(project) { state.registered.push(project.projectId) },
    unregisterBaseline(projectId) { state.unregistered.push(projectId); return true },
    openProject(projectId) {
      const project = projectId === first.projectId ? first : second
      state.opened.push(projectId)
      const scoped = { project, scopeKey: `scope:${projectId}`, ctx: hostContext, dispose: async () => {} }
      return scoped
    },
    async closeProject(projectId) { state.closed.push(projectId) },
  }
  const memoryDomain = { table: () => ({ put: async () => {}, get: () => undefined }), close: async () => { state.memoryClosed += 1 } }
  const hostContext = {
    get(key) {
      return {
        skills: { registerProvider: () => () => { state.skillDisposed += 1 } },
        storageDomain: { open: async () => memoryDomain },
      }[key]
    },
    on(event) {
      if (event === 'approval/request') throw new Error('gate registration failed')
      return () => {}
    },
  }
  const agent = { ctx: hostContext, session: { events: [] } }

  await assert.rejects(
    () => runMinimumVerticalPath({ ctx: hostContext, workspacePath: '/tmp/cleanup-workspace', projects: [{ key: 'project-a', owner: 'owner-a' }, { key: 'project-b', owner: 'owner-b' }], agent, projectRegistry: registry, persistArtifacts: false }),
    /gate registration failed/,
  )
  assert.deepEqual(state.closed, [second.projectId, first.projectId])
  assert.deepEqual(state.unregistered, [second.projectId, first.projectId])
  assert.equal(state.skillDisposed, 1)
  assert.equal(state.memoryClosed, 1)
})
