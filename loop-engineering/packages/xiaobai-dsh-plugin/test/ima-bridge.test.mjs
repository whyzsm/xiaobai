// Unit tests for the read-only IMA bridge (no network, fake MCP + fake fetch).
// 只读 IMA 桥单元测试：全部使用注入的假 MCP 客户端与假 fetch，不触网、不碰凭据。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Buffer } from 'node:buffer'
import {
  ImaBridge,
  ImaBridgeError,
  ImaMcpStdioClient,
  canonicalDigest,
  parseNoteFrontmatter,
  READ_ONLY_TOOL_COUNT
} from '../lib/ima-bridge.js'

const KB = 'kb_test_1'

function fixtureConfig(overrides = {}) {
  return {
    listen: { host: '127.0.0.1', port: 0 },
    server: { command: 'node', args: ['unused'] },
    scopes: { 't-max': { knowledgeBaseId: KB } },
    limits: { manifestTtlMs: 60000, noteCacheTtlMs: 600000, maxCharacters: 12000, maxDownloadBytes: 2000000 },
    ...overrides
  }
}

function noteMarkdown(frontmatter, body = '正文 body text with 页面验收 keywords.') {
  const lines = Object.entries(frontmatter).map(([key, value]) => {
    if (Array.isArray(value)) return `${key}:\n${value.map((item) => `  - ${item}`).join('\n')}`
    return `${key}: ${value}`
  })
  return `---\n${lines.join('\n')}\n---\n${body}`
}

function fakeMcp({ inventory, notes, searchResults = { info_list: [] } } = {}) {
  const calls = []
  return {
    calls,
    running: true,
    async callTool(name, args) {
      calls.push({ name, args })
      if (name === 'ima_list_knowledge') {
        return { code: 0, msg: 'success', data: { knowledge_list: inventory, is_end: true, next_cursor: '' } }
      }
      if (name === 'ima_search_knowledge') {
        return { code: 0, msg: 'success', data: searchResults }
      }
      if (name === 'ima_get_media_info') {
        const note = notes[args.media_id]
        if (!note) return { code: 0, msg: 'success', data: {} }
        return {
          code: 0,
          msg: 'success',
          data: {
            media_type: 7,
            url_info: { url: `https://ima.example/${args.media_id}.md`, headers: { 'X-IMA-Sign': 'secret-sign' } }
          }
        }
      }
      throw new Error(`fake mcp does not implement ${name}`)
    }
  }
}

function fakeFetch(notes) {
  const impl = async (url, options) => {
    impl.fetched.push({ url, options })
    const id = decodeURIComponent(url.split('/').pop() ?? '').replace('.md', '')
    const text = notes[id]
    if (text === undefined) return { ok: false, status: 404, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) }
    const bytes = Buffer.from(text, 'utf8')
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'text/markdown; charset=utf-8']]),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    }
  }
  impl.fetched = []
  return impl
}

function standardNotes() {
  return {
    markdown_aaa: noteMarkdown({
      title: 'T-MAX 页面验收证据清单 / T-MAX Page Acceptance Evidence',
      sourceRevision: '2a28700bb7d7d19797bf8154a1a1b755df208362',
      contentDigest: `sha256:${'a'.repeat(64)}`,
      category: 'tmax-page-acceptance-checklist',
      scope: 't-max',
      updatedAt: '2026-09-02',
      evidenceRefs: ['xiaoneng3.0@2a28700:skills/qa-page-acceptance/SKILL.md']
    }, '页面验收 evidence checklist body for acceptance gates.'),
    markdown_bbb: noteMarkdown({
      title: 'Requirement Scope Clarification / 需求范围澄清',
      sourceRevision: '2a28700bb7d7d19797bf8154a1a1b755df208362',
      contentDigest: `sha256:${'b'.repeat(64)}`,
      category: 'requirement-scope-method',
      scope: 't-max'
    }, 'requirement scope method body for clarifying targets.'),
    markdown_ccc: noteMarkdown({
      revision: '9',
      sourceRevision: 'other-revision',
      contentDigest: `sha256:${'c'.repeat(64)}`,
      category: 'misc',
      scope: 't-max'
    }, 'misc body without shared keywords.')
  }
}

function standardInventory(notes) {
  return Object.keys(notes).map((mediaId, index) => ({
    media_id: mediaId,
    title: `title-${index}.md`,
    parent_folder_id: 'folder-1',
    media_type: 7
  }))
}

function buildBridge({ notes = standardNotes(), searchResults, config } = {}) {
  const inventory = [...standardInventory(notes), { media_id: 'pdf_x', title: 'guide.pdf', media_type: 1 }]
  const mcp = fakeMcp({ inventory, notes, searchResults })
  const fetcher = fakeFetch(notes)
  const bridge = new ImaBridge({ config: config ?? fixtureConfig(), mcp, fetchImpl: fetcher })
  return { bridge, mcp, fetcher }
}

test('parseNoteFrontmatter extracts scalar and list fields and strips the block from the body', () => {
  const { frontmatter, body } = parseNoteFrontmatter(noteMarkdown({
    title: '标题 / Title',
    revision: '3',
    evidenceRefs: ['ref-1', 'ref-2']
  }, 'BODY-START'))
  assert.equal(frontmatter.title, '标题 / Title')
  assert.equal(frontmatter.revision, '3')
  assert.deepEqual(frontmatter.evidenceRefs, ['ref-1', 'ref-2'])
  assert.equal(body.startsWith('BODY-START'), true)
  assert.equal(parseNoteFrontmatter('# no frontmatter').frontmatter, null)
})

test('normalization prefers explicit revision, stamps the locked scope, and locks the downloaded bytes', async () => {
  const { bridge } = buildBridge()
  const result = await bridge.handle('ima_get_note_content', { id: 'markdown_ccc', scope: 't-max' })
  const record = result.items[0]
  assert.equal(record.id, 'markdown_ccc')
  assert.equal(record.revision, '9')
  assert.equal(record.scope, 't-max')
  assert.equal(record.source, 'ima://t-max/markdown_ccc')
  assert.match(record.digest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(record.frontmatter.sourceRevision, 'other-revision')
  assert.equal(record.content.includes('---'), false)
})

test('normalization fails closed without any revision and on scope mismatch', async () => {
  const notes = {
    markdown_norev: noteMarkdown({ contentDigest: `sha256:${'d'.repeat(64)}`, scope: 't-max' }),
    markdown_wrongscope: noteMarkdown({ sourceRevision: 'r', contentDigest: `sha256:${'e'.repeat(64)}`, scope: 'other' })
  }
  const { bridge } = buildBridge({ notes })
  await assert.rejects(
    () => bridge.handle('ima_get_note_content', { id: 'markdown_norev', scope: 't-max' }),
    (error) => error instanceof ImaBridgeError && error.code === 'missing-revision'
  )
  await assert.rejects(
    () => bridge.handle('ima_get_note_content', { id: 'markdown_wrongscope', scope: 't-max' }),
    (error) => error instanceof ImaBridgeError && error.code === 'out-of-scope'
  )
})

test('read-only enforcement rejects write tools and the raw escape hatch', async () => {
  const client = new ImaMcpStdioClient({ command: 'node', args: [] })
  for (const tool of ['ima_create_note', 'ima_append_note', 'ima_import_urls', 'ima_add_note_to_knowledge', 'ima_check_repeated_names', 'ima_upload_file_to_knowledge', 'ima_raw_call']) {
    await assert.rejects(
      () => client.callTool(tool, {}),
      (error) => error instanceof ImaBridgeError && error.code === 'forbidden'
    )
  }
  const { bridge } = buildBridge()
  await assert.rejects(
    () => bridge.handle('ima_create_note', { content: 'x' }),
    (error) => error instanceof ImaBridgeError && error.code === 'unknown-tool'
  )
  await assert.rejects(
    () => bridge.handle('ima_raw_call', { api_path: 'openapi/wiki/v1/anything' }),
    (error) => error instanceof ImaBridgeError && error.code === 'unknown-tool'
  )
})

test('unknown scope fails closed before any MCP call', async () => {
  const { bridge, mcp } = buildBridge()
  await assert.rejects(
    () => bridge.handle('ima_search_knowledge', { query: 'x', scope: 'nope' }),
    (error) => error instanceof ImaBridgeError && error.code === 'unknown-scope'
  )
  assert.equal(mcp.calls.length, 0)
})

test('search matches Chinese and English queries and bounds the result set', async () => {
  const { bridge } = buildBridge()
  const chinese = await bridge.handle('ima_search_knowledge', { query: '页面验收', scope: 't-max' })
  assert.equal(chinese.items.length, 1)
  assert.equal(chinese.items[0].id, 'markdown_aaa')

  const english = await bridge.handle('ima_search_knowledge', { query: 'requirement scope', scope: 't-max' })
  assert.equal(english.items.length, 1)
  assert.equal(english.items[0].id, 'markdown_bbb')

  const limited = await bridge.handle('ima_search_knowledge', { query: 't-max', scope: 't-max', limit: 1 })
  assert.equal(limited.items.length, 1)
})

test('search merges best-effort server search candidates above token matching', async () => {
  const { bridge } = buildBridge({ searchResults: { info_list: [{ media_id: 'markdown_bbb' }] } })
  const server = await bridge.handle('ima_search_knowledge', { query: 'zzz-no-token-match', scope: 't-max' })
  assert.equal(server.items.length, 1)
  assert.equal(server.items[0].id, 'markdown_bbb')
})

test('manifest is deterministic, excludes non-markdown media, and locks a uniform revision', async () => {
  const uniformNotes = {
    markdown_aaa: noteMarkdown({ sourceRevision: '2a28700bb7d7d19797bf8154a1a1b755df208362', scope: 't-max' }, 'a body'),
    markdown_bbb: noteMarkdown({ sourceRevision: '2a28700bb7d7d19797bf8154a1a1b755df208362', scope: 't-max' }, 'b body')
  }
  const first = buildBridge({ notes: uniformNotes })
  const second = buildBridge({ notes: uniformNotes })
  const a = await first.bridge.handle('ima_kb_manifest', { scope: 't-max' })
  const b = await second.bridge.handle('ima_kb_manifest', { scope: 't-max' })
  assert.equal(a.revision, '2a28700bb7d7d19797bf8154a1a1b755df208362')
  assert.equal(a.digest, b.digest)
  assert.match(a.digest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(a.noteCount, 2)
  assert.equal(a.inventoryCount, 3)
  assert.equal(a.entries.some((entry) => entry.id === 'pdf_x'), false)
  assert.deepEqual(a.entries.map((entry) => entry.id), [...a.entries.map((entry) => entry.id)].sort())

  const mixed = buildBridge({
    notes: {
      markdown_a: noteMarkdown({ sourceRevision: 'rev-1', scope: 't-max' }),
      markdown_b: noteMarkdown({ sourceRevision: 'rev-2', scope: 't-max' })
    }
  })
  await assert.rejects(
    () => mixed.bridge.handle('ima_kb_manifest', { scope: 't-max' }),
    (error) => error instanceof ImaBridgeError && error.code === 'non-uniform-revision'
  )
})

test('media info never leaks signed URLs or signing headers', async () => {
  const { bridge } = buildBridge()
  const info = await bridge.handle('ima_get_media_info', { media_id: 'markdown_aaa' })
  assert.equal(info.media_id, 'markdown_aaa')
  assert.equal(info.downloadAvailable, true)
  assert.equal(JSON.stringify(info).includes('X-IMA-Sign'), false)
  assert.equal(JSON.stringify(info).includes('https://ima.example'), false)
})

test('content download is bounded and digested', async () => {
  const notes = { markdown_big: noteMarkdown({ revision: '1', scope: 't-max' }, 'x'.repeat(100)) }
  const { bridge } = buildBridge({ notes, config: fixtureConfig({ limits: { maxDownloadBytes: 50 } }) })
  await assert.rejects(
    () => bridge.handle('ima_download_media', { media_id: 'markdown_big' }),
    (error) => error instanceof ImaBridgeError && error.code === 'download-too-large'
  )
  const ok = buildBridge()
  const download = await ok.bridge.handle('ima_download_media', { media_id: 'markdown_aaa' })
  assert.equal(typeof download.bytes, 'number')
  assert.match(download.digest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(typeof download.content, 'string')
})

test('loopback HTTP surface serves /call and /health and rejects writes with 403/404', async (t) => {
  const { bridge } = buildBridge()
  t.after(() => bridge.stop())
  const address = await bridge.startListen()
  assert.equal(address.host, '127.0.0.1')
  const health = await (await fetch(`${address.url}/health`)).json()
  assert.equal(health.ok, true)
  assert.equal(health.result.scopes[0].scope, 't-max')

  const search = await (await fetch(`${address.url}/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: 'ima_search_knowledge', input: { query: '页面验收', scope: 't-max' } })
  })).json()
  assert.equal(search.ok, true)
  assert.equal(search.result.items[0].id, 'markdown_aaa')

  const write = await fetch(`${address.url}/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: 'ima_create_note', input: { content: 'x' } })
  })
  assert.equal(write.status, 404)
  const raw = await fetch(`${address.url}/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: 'ima_raw_call', input: {} })
  })
  assert.equal(raw.status, 404)

  const badJson = await fetch(`${address.url}/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{invalid'
  })
  assert.equal(badJson.status, 400)
})

test('canonicalDigest matches sorted-key JSON semantics', () => {
  assert.equal(
    canonicalDigest({ b: 1, a: [2, { d: null, c: 'x' }] }),
    canonicalDigest({ a: [2, { c: 'x', d: null }], b: 1 })
  )
  assert.match(canonicalDigest({}), /^sha256:[a-f0-9]{64}$/)
})

test('read-only allowlist covers exactly the official read tools', () => {
  assert.equal(READ_ONLY_TOOL_COUNT, 10)
})
