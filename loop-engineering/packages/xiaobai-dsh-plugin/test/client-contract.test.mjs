import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const sourcePath = new URL('../../../../client/plugin-client.js', import.meta.url)

test('Client bundle targets rc.6 list Slots and declares the complete config Remote', async () => {
  const source = await readFile(sourcePath, 'utf8')
  assert.match(source, /window\.__ModuleLoader__\.load\(/)
  assert.match(source, /name: "settings\.section"/)
  assert.match(source, /name: "sidebar\.footer\.action"/)
  assert.match(source, /name: "shell\.overlay"/)
  assert.match(source, /method,?\n\s*invocation: \{ kind: "direct" \}/)
  assert.match(source, /pickDirectory/)
  assert.equal(/slots\.register\(\{ name: "root"/.test(source), false)
  assert.equal(/slots\.register\(\{ name: "conversation"/.test(source), false)
})

test('Client registration keeps Settings, sidebar, and overlay as independent contributions', async () => {
  const source = await readFile(sourcePath, 'utf8')
  let plugin
  const context = {
    window: { __ModuleLoader__: { load(value) { plugin = value } } },
  }
  vm.runInNewContext(source, context)
  const registrations = []
  const ctx = {
    get: (key) => key === 'slots' ? {
      inject: (_name, contribution) => contribution(),
      register: (descriptor, component) => { registrations.push({ descriptor, component }); return () => {} },
    } : undefined,
    remote: { $mount: async () => () => {} },
    reflect: { get: () => ({}) },
    effect: (effect) => { void effect() },
  }
  const result = plugin.factory((name) => name === 'react' ? { createElement: () => null, useEffect: () => {}, useState: () => [0, () => {}] } : undefined)
  result.apply(ctx)
  assert.deepEqual(registrations.map(({ descriptor }) => descriptor.name), ['settings.section', 'sidebar.footer.action', 'shell.overlay'])
  assert.deepEqual(registrations.map(({ descriptor }) => descriptor.id), ['xiaobai-workspace', 'xiaobai-workspace-shortcut', 'xiaobai-workspace-overlay'])
})
