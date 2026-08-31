import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const sourcePath = new URL('../../../../client/plugin-client.js', import.meta.url)
const packageSourcePath = new URL('../lib/client.js', import.meta.url)
const packageManifestPath = new URL('../package.json', import.meta.url)

function loadClient(source, options = {}) {
  let plugin
  const context = {
    window: { __ModuleLoader__: { load(value) { plugin = value } } },
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout: options.clearTimeout || clearTimeout,
  }
  vm.runInNewContext(source, context)
  return plugin
}

function render(node) {
  if (Array.isArray(node)) return node.flatMap(render)
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (typeof node.type === 'function') return render(node.type(node.props || {}))
  return (node.children || []).flatMap(render)
}

function clientContext(registrations, remoteMount, remoteService, workspaces, inputTriggers) {
  return {
    workspaces,
    inputTriggers,
    get: (key) => {
      if (key === 'remote.xiaobaiConfig') return remoteService
      if (key !== 'slots') return undefined
      return {
        inject: (_name, contribution) => contribution(),
        register: (descriptor, component) => { registrations.push({ descriptor, component }); return () => {} },
      }
    },
    remote: { $mount: remoteMount },
    reflect: { get: () => undefined },
    effect: (effect) => { void effect() },
  }
}

function createElement(type, props, ...children) {
  return { type, props: { ...(props || {}), children: children.length === 1 ? children[0] : children }, children }
}

function reactMock(options = {}) {
  return {
    createElement,
    useEffect: options.useEffect || (() => {}),
    useState: options.useState || (() => [0, () => {}]),
  }
}

test('Client bundle targets rc.6 list Slots and declares the complete config Remote', async () => {
  const source = await readFile(sourcePath, 'utf8')
  const packageSource = await readFile(packageSourcePath, 'utf8')
  const packageManifest = JSON.parse(await readFile(packageManifestPath, 'utf8'))
  assert.equal(source, packageSource)
  assert.match(source, /window\.__ModuleLoader__\.load\(/)
  assert.match(source, /name: "settings\.section"/)
  assert.doesNotMatch(source, /name: "sidebar\.footer\.action"/)
  assert.doesNotMatch(source, /name: "shell\.overlay"/)
  assert.doesNotMatch(source, /小白工作区/)
  assert.match(source, /method,?\n\s*invocation: \{ kind: "direct" \}/)
  assert.match(source, /projectCandidates/)
  assert.match(source, /exports\.inject = \["slots", "remote", "workspaces", "inputTriggers"\]/)
  assert.match(source, /pickDirectory/)
  assert.ok(packageManifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-input-trigger'))
  assert.equal(/slots\.register\(\{ name: "root"/.test(source), false)
  assert.equal(/slots\.register\(\{ name: "conversation"/.test(source), false)
})

test('Client registration exposes settings and the project Hero bridge', async () => {
  const source = await readFile(sourcePath, 'utf8')
  const plugin = loadClient(source)
  const registrations = []
  const result = plugin.factory((name) => name === 'react' ? reactMock() : undefined)
  result.apply(clientContext(registrations, async () => () => {}, { list: async () => ({ ok: true, value: { status: 'ok', data: { projects: [] }, diagnostics: [] } }) }))
  assert.deepEqual(registrations.map(({ descriptor }) => descriptor.name), ['conversation.input.dock', 'conversation.session.header.actions', 'settings.section'])
  assert.deepEqual(registrations.map(({ descriptor }) => descriptor.id), ['xiaobai-project-hero', 'xiaobai-project-header', 'xiaobai-workspace'])
  assert.deepEqual(registrations.map(({ descriptor }) => descriptor.label), [undefined, undefined, '小白'])
  assert.match(source, /matchSpace\(_session, token\)/)
})

test('Client renders a visible loading state while the Remote namespace mounts', async () => {
  const source = await readFile(sourcePath, 'utf8')
  const plugin = loadClient(source, { setTimeout: () => 0, clearTimeout: () => {} })
  const registrations = []
  const result = plugin.factory((name) => name === 'react' ? reactMock() : undefined)
  result.apply(clientContext(registrations, () => new Promise(() => {})))

  const settings = registrations.find(({ descriptor }) => descriptor.id === 'xiaobai-workspace').component({})
  const text = render(settings).join(' ')
  assert.match(text, /正在连接小白服务/)
  assert.doesNotMatch(text, /idle/)
})

test('Client renders a diagnostic and retry entry when Remote mounting fails', async () => {
  const source = await readFile(sourcePath, 'utf8')
  const plugin = loadClient(source)
  const registrations = []
  const result = plugin.factory((name) => name === 'react' ? reactMock() : undefined)
  result.apply(clientContext(registrations, async () => { throw new Error('host unavailable') }))
  await new Promise((resolve) => setTimeout(resolve, 10))

  const settings = registrations.find(({ descriptor }) => descriptor.id === 'xiaobai-workspace').component({})
  const text = render(settings).join(' ')
  assert.match(text, /主机服务不可用/)
  assert.match(text, /小白服务不可用/)
  assert.match(text, /重试连接/)
})

test('Client loads Projects for Settings after the Remote namespace mounts', async () => {
  const source = await readFile(sourcePath, 'utf8')
  const plugin = loadClient(source)
  const registrations = []
  let listCalls = 0
  const remoteService = {
    list: async () => {
      listCalls += 1
      return { ok: true, value: { status: 'ok', data: { projects: [] }, diagnostics: [] } }
    },
  }
  const result = plugin.factory((name) => name === 'react' ? reactMock() : undefined)
  result.apply(clientContext(registrations, async () => () => {}, remoteService))
  await new Promise((resolve) => setTimeout(resolve, 10))

  const settings = registrations.find(({ descriptor }) => descriptor.id === 'xiaobai-workspace').component({})
  const text = render(settings).join(' ')
  assert.equal(listCalls, 1)
  assert.match(text, /项目/)
  assert.match(text, /暂无项目配置/)
})

test('Client registers the @ Project source and preserves opaque Project identity', async () => {
  const source = await readFile(sourcePath, 'utf8')
  const plugin = loadClient(source)
  const registrations = []
  let projectSource
  const remoteService = {
    list: async () => ({ ok: true, value: { status: 'ok', data: { workspaceId: 'ws_client_test', projects: [{ workspaceId: 'ws_client_test', projectId: 'prj_client_test', sourceProjectId: 't-max', displayName: 'T-MAX' }] }, diagnostics: [] } }),
    projectCandidates: async () => ({ ok: true, value: { status: 'ok', data: { projects: [{ workspaceId: 'ws_client_test', projectId: 'prj_client_test', sourceProjectId: 't-max', displayName: 'T-MAX', knowledgeStatus: 'locked', repositoryStatus: 'locked' }] }, diagnostics: [] } }),
  }
  const inputTriggers = { registerSource: (value) => { projectSource = value; return () => {} } }
  const result = plugin.factory((name) => name === 'react' ? reactMock() : undefined)
  result.apply(clientContext(registrations, async () => () => {}, remoteService, undefined, inputTriggers))
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(projectSource.trigger, '@')
  assert.equal(projectSource.name, '项目')
  assert.equal(projectSource.showGroupTitle, undefined)
  const candidates = await projectSource.candidates({ sessionId: 'session_client_test' }, { query: 't-max', position: 'leading', signal: new AbortController().signal })
  assert.equal(candidates.length, 1)
  assert.match(candidates[0].name, /@t-max/)
  assert.doesNotMatch(JSON.stringify(candidates[0]), /(?:[a-z]:[\\/]|\\\\|\/Users\/|https?:\/\/)/u)
  const picked = projectSource.onPick({ candidate: candidates[0], session: { sessionId: 'session_client_test' }, position: 'leading', via: 'menu', span: { start: 0, end: 1, draftRev: 1 } })
  assert.equal(picked.insert.source, '项目')
  assert.equal(picked.insert.label, 't-max')
  assert.equal(picked.insert.clipboardText, '@t-max')
  assert.doesNotMatch(picked.insert.label, /^@/u)
  assert.equal(picked.insert.appearance, 'session')
  assert.match(await projectSource.codec.serialize(picked.insert.ref, new AbortController().signal), /project-id="prj_client_test"/)
  const restored = projectSource.matchSpace({ sessionId: 'session_client_test' }, '@t-max')
  assert.equal(restored.insert.label, 't-max')
  assert.equal(projectSource.matchSpace({ sessionId: 'session_client_test' }, '@t-max/config'), undefined)
  assert.match(source, /function projectFileMentionKeys\(/)
  assert.match(source, /data-xiaobai-project-file-row/)
  assert.match(source, /occurrence\.length/)
  assert.match(source, /data-at-file-dock/)
})

test('Client shows a persisted project in the session header and can prepare a replacement', async () => {
  const source = await readFile(sourcePath, 'utf8')
  const plugin = loadClient(source)
  const registrations = []
  const result = plugin.factory((name) => name === 'react' ? reactMock() : undefined)
  const project = { workspaceId: 'ws_header_test', projectId: 'prj_header_test', sourceProjectId: 't-max', displayName: 'T-MAX' }
  result.apply(clientContext(registrations, async () => () => {}, {
    list: async () => ({ ok: true, value: { status: 'ok', data: { workspaceId: project.workspaceId, projects: [project] }, diagnostics: [] } }),
  }))
  await new Promise((resolve) => setTimeout(resolve, 10))

  const input = { draft: '', occurrences: [] }
  let nextDraft = input.draft
  const header = registrations.find(({ descriptor }) => descriptor.id === 'xiaobai-project-header').component({
    sessionId: 'session_header_test',
    useInput: (selector) => selector(input),
    useSession: (selector) => selector({ chat: { nodes: { values: () => [{ kind: 'user', seq: 1, content: [{ type: 'text', text: '<xiaobai-project workspace-id="ws_header_test" project-id="prj_header_test">t-max</xiaobai-project>' }] } ] } } }),
    useSessions: (selector) => selector({ byId: { session_header_test: { displayTitle: '@t-max' } } }),
    inputActions: { setDraft: (value) => { nextDraft = value } },
  })
  assert.match(render(header).join(' '), /当前项目：t-max/)
  const change = findButton(header, '当前项目：t-max')
  assert.ok(change)
  change.props.onClick()
  assert.equal(nextDraft, '@')
})

test('Client resolves a legacy @ project from the session title when the snapshot has no project node', async () => {
  const source = await readFile(sourcePath, 'utf8')
  const plugin = loadClient(source)
  const registrations = []
  const project = { workspaceId: 'ws_legacy_title_test', projectId: 'prj_legacy_title_test', sourceProjectId: 't-max', displayName: 'T-MAX' }
  let candidateCalls = 0
  const remoteService = {
    list: async () => ({ ok: true, value: { status: 'ok', data: { workspaceId: project.workspaceId, projects: [] }, diagnostics: [] } }),
    projectCandidates: async () => {
      candidateCalls += 1
      return { ok: true, value: { status: 'ok', data: { projects: [project] }, diagnostics: [] } }
    },
  }
  let hookIndex = 0
  const hookState = []
  const result = plugin.factory((name) => name === 'react' ? reactMock({
    useState: (initial) => {
      const index = hookIndex++
      if (!(index in hookState)) hookState[index] = initial
      return [hookState[index], (value) => { hookState[index] = typeof value === 'function' ? value(hookState[index]) : value }]
    },
    useEffect: (effect) => { void effect() },
  }) : undefined)
  result.apply(clientContext(registrations, async () => () => {}, remoteService))
  await new Promise((resolve) => setTimeout(resolve, 10))

  const headerComponent = registrations.find(({ descriptor }) => descriptor.id === 'xiaobai-project-header').component
  const input = { draft: '', occurrences: [] }
  const renderHeader = () => {
    hookIndex = 0
    return headerComponent({
      sessionId: 'session_legacy_title_test',
      useInput: (selector) => selector(input),
      useSession: (selector) => selector({ chat: { nodes: { values: () => [] } } }),
      useSessions: (selector) => selector({ byId: { session_legacy_title_test: { displayTitle: '@t-max' } } }),
      inputActions: { setDraft: () => {} },
    })
  }

  assert.deepEqual(render(renderHeader()), [])
  await new Promise((resolve) => setTimeout(resolve, 20))
  const header = render(renderHeader()).join(' ')
  assert.match(header, /当前项目：t-max/)
  assert.equal(candidateCalls, 1)
})

function findButton(node, label) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label)
      if (found) return found
    }
    return undefined
  }
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return undefined
  if (typeof node.type === 'function') return findButton(node.type(node.props || {}), label)
  if (node.type === 'button' && render(node).join(' ').includes(label)) return node
  return findButton(node.children || [], label)
}

test('Client uses the dsh browse workspace service and submits the confirmed path', async () => {
  const source = await readFile(sourcePath, 'utf8')
  const plugin = loadClient(source)
  const registrations = []
  let picked
  const remoteService = {
    list: async () => ({ ok: true, value: { status: 'unsupported', diagnostics: [{ code: 'XIAOBAI_HOST_UNSUPPORTED', severity: 'error', message: 'Host native Directory Picker is unavailable' }] } }),
    pickDirectory: async (request) => {
      picked = request
      return { ok: true, value: { status: 'ok', data: { bindingRef: 'binding_browse_test', kind: request.kind, locator: 'binding/test', digest: `sha256:${'a'.repeat(64)}`, readOnly: false, trust: 'external' }, diagnostics: [] } }
    },
  }
  const workspaces = {
    listDirectory: async (path) => ({
      path: path || '/Users/demo',
      home: '/Users/demo',
      crumbs: [{ name: 'demo', path: '/Users/demo', hidden: false }],
      entries: [],
      truncated: false,
    }),
  }
  const result = plugin.factory((name) => name === 'react' ? reactMock() : undefined)
  result.apply(clientContext(registrations, async () => () => {}, remoteService, workspaces))
  await new Promise((resolve) => setTimeout(resolve, 10))

  let settings = registrations.find(({ descriptor }) => descriptor.id === 'xiaobai-workspace').component({})
  const chooseWorkspace = findButton(settings, '选择工作区目录')
  assert.ok(chooseWorkspace)
  chooseWorkspace.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))

  settings = registrations.find(({ descriptor }) => descriptor.id === 'xiaobai-workspace').component({})
  const chooseCurrent = findButton(settings, '选择此目录')
  assert.ok(chooseCurrent)
  chooseCurrent.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(picked.kind, 'workspace')
  assert.equal(picked.selectedPath, '/Users/demo')
})

test('Client prefers the dsh native workspace service over the browse UI', async () => {
  const source = await readFile(sourcePath, 'utf8')
  const plugin = loadClient(source)
  const registrations = []
  let picked
  const remoteService = {
    list: async () => ({ ok: true, value: { status: 'unsupported', diagnostics: [{ code: 'XIAOBAI_HOST_UNSUPPORTED', severity: 'error', message: 'Host native Directory Picker is unavailable' }] } }),
    pickDirectory: async (request) => {
      picked = request
      return { ok: true, value: { status: 'ok', data: { bindingRef: 'binding_native_test', kind: request.kind, locator: 'binding/test', digest: `sha256:${'b'.repeat(64)}`, readOnly: false, trust: 'external' }, diagnostics: [] } }
    },
  }
  const workspaces = {
    pickDirectory: async () => '/Users/demo',
    listDirectory: async () => ({ path: '/Users/demo', home: '/Users/demo', crumbs: [], entries: [], truncated: false }),
  }
  const result = plugin.factory((name) => name === 'react' ? reactMock() : undefined)
  result.apply(clientContext(registrations, async () => () => {}, remoteService, workspaces))
  await new Promise((resolve) => setTimeout(resolve, 10))

  let settings = registrations.find(({ descriptor }) => descriptor.id === 'xiaobai-workspace').component({})
  const chooseWorkspace = findButton(settings, '选择工作区目录')
  assert.ok(chooseWorkspace)
  chooseWorkspace.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.equal(picked.kind, 'workspace')
  assert.equal(Object.hasOwn(picked, 'selectedPath'), false)
  settings = registrations.find(({ descriptor }) => descriptor.id === 'xiaobai-workspace').component({})
  assert.equal(findButton(settings, '选择此目录'), undefined)
})
