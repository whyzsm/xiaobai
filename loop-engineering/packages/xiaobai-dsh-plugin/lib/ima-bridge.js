// Xiaobai read-only IMA bridge — DSH Host side.
// 小白只读 IMA 桥（DSH Host 侧）。
//
// Responsibilities / 职责:
//   1. Logical project scope -> real IMA knowledge-base ID mapping (local config only).
//   2. Read-only call wrappers over the official `ima-mcp` stdio server
//      (ima_search_knowledge / ima_list_knowledge / ima_get_knowledge_base /
//       ima_get_media_info + signed-URL content download).
//   3. Markdown frontmatter extraction (revision / contentDigest / scope, plus
//      sourceRevision fallback) from the downloaded note bytes.
//   4. Normalization of IMA fields into the Xiaobai document contract consumed by
//      loop-engineering's ImaAdapter (id/title/content/source/revision/digest/scope).
//   5. Exposure over a loopback-only HTTP endpoint so the engine CLI can inject
//      this bridge as its ImaTransport without touching credentials.
//
// Read-only enforcement / 只读强制:
//   The bridge only ever calls a fixed allowlist of read tools on the MCP server.
//   Write tools (ima_create_note, ima_append_note, ima_import_urls,
//   ima_add_note_to_knowledge, ima_check_repeated_names,
//   ima_upload_file_to_knowledge, ima_raw_call) are rejected before any transport
//   hop. The bridge never reads, logs, or forwards credentials; the child process
//   loads them itself from ~/.config/ima.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

export const IMA_BRIDGE_CONFIG_ENV = 'XIAOBAI_IMA_BRIDGE_CONFIG'
export const IMA_BRIDGE_VERSION = 'ima-bridge-v1'

// The only MCP tools this bridge may call. Anything else is a write or an
// unbounded escape hatch (ima_raw_call) and must fail closed.
const READ_ONLY_MCP_TOOLS = new Set([
  'ima_search_notes',
  'ima_list_notes',
  'ima_list_notebooks',
  'ima_get_note_content',
  'ima_search_knowledge_bases',
  'ima_get_addable_knowledge_bases',
  'ima_get_knowledge_base',
  'ima_list_knowledge',
  'ima_search_knowledge',
  'ima_get_media_info'
])

// Operations exposed on the bridge surface (HTTP /call and service API).
export const IMA_BRIDGE_OPERATIONS = [
  'ima_health',
  'ima_search_knowledge',
  'ima_get_note_content',
  'ima_get_media_info',
  'ima_download_media',
  'ima_kb_manifest'
]

// Test seam: the exact size of the read-only allowlist.
export const READ_ONLY_TOOL_COUNT = READ_ONLY_MCP_TOOLS.size

const DEFAULT_LIMITS = {
  maxLimit: 20,
  listPageSize: 20,
  maxCharacters: 12000,
  requestTimeoutMs: 30000,
  downloadTimeoutMs: 15000,
  maxDownloadBytes: 2000000,
  manifestTtlMs: 60000,
  noteCacheTtlMs: 600000
}

export class ImaBridgeError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'ImaBridgeError'
    this.code = code
    this.details = details
  }
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

// Canonical JSON digest with sorted keys (matches loop-engineering digestJson
// semantics closely enough for a stable manifest fingerprint).
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

export function canonicalDigest(value) {
  return `sha256:${sha256Hex(Buffer.from(canonicalJson(value), 'utf8'))}`
}

/**
 * Parse the handwritten YAML frontmatter block at the start of a downloaded
 * IMA markdown note. Tolerant by design: absent or malformed frontmatter
 * returns { frontmatter: null, body } so callers can fail closed explicitly.
 */
export function parseNoteFrontmatter(text) {
  if (typeof text !== 'string' || !text.startsWith('---')) {
    return { frontmatter: null, body: text ?? '' }
  }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { frontmatter: null, body: text }
  const block = text.slice(3, end).replace(/^\r?\n/, '')
  const body = text.slice(end + 4).replace(/^\r?\n+/, '')
  const frontmatter = {}
  const arrays = {}
  let currentArrayKey = null
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.trim().length === 0) continue
    const listMatch = line.match(/^\s+-\s+(.*)$/)
    if (listMatch && currentArrayKey) {
      arrays[currentArrayKey].push(listMatch[1].trim())
      continue
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!kv) {
      currentArrayKey = null
      continue
    }
    const key = kv[1]
    const value = kv[2].trim()
    if (value.length === 0) {
      currentArrayKey = key
      arrays[key] = []
      frontmatter[key] = arrays[key]
    } else {
      currentArrayKey = null
      frontmatter[key] = value
    }
  }
  for (const key of Object.keys(arrays)) {
    if (arrays[key].length === 0) delete frontmatter[key]
  }
  return { frontmatter, body }
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

/** Minimal stdio JSON-RPC MCP client for the official ima-mcp server. */
export class ImaMcpStdioClient {
  constructor({ command = 'node', args = [], cwd, requestTimeoutMs = 30000 } = {}) {
    this.command = command
    this.args = args
    this.cwd = cwd
    this.requestTimeoutMs = requestTimeoutMs
    this.child = undefined
    this.buffer = ''
    this.nextId = 1
    this.pending = new Map()
    this.starting = undefined
    this.stopped = false
  }

  get running() {
    return this.child !== undefined && this.child.exitCode === null
  }

  async ensureStarted() {
    if (this.stopped) throw new ImaBridgeError('not-configured', 'IMA MCP client is stopped')
    if (this.running) return
    if (!this.starting) this.starting = this.spawnAndInitialize().finally(() => {
      this.starting = undefined
    })
    return this.starting
  }

  async spawnAndInitialize() {
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    })
    this.child = child
    this.buffer = ''
    child.stdout.on('data', (chunk) => this.onStdout(chunk))
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      // Never log credential content; ima-mcp only prints error text here.
      if (text.trim().length > 0) console.warn?.(`[xiaobai-ima-bridge][mcp-stderr] ${text.trim().slice(0, 400)}`)
    })
    const exited = new Promise((resolve) => child.once('exit', () => resolve()))
    exited.then(() => {
      for (const [, reject] of this.pending) reject(new ImaBridgeError('transport', 'IMA MCP child exited'))
      this.pending.clear()
    })
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'xiaobai-ima-bridge', version: IMA_BRIDGE_VERSION }
    })
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }

  onStdout(chunk) {
    this.buffer += chunk.toString('utf8')
    let index
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new ImaBridgeError('mcp-error', `IMA MCP error: ${JSON.stringify(message.error).slice(0, 400)}`))
        else resolve(message.result)
      }
    }
  }

  send(object) {
    if (!this.child?.stdin?.writable) throw new ImaBridgeError('transport', 'IMA MCP stdin is not writable')
    this.child.stdin.write(`${JSON.stringify(object)}\n`)
  }

  request(method, params) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new ImaBridgeError('timeout', `IMA MCP ${method} timed out after ${this.requestTimeoutMs}ms`))
      }, this.requestTimeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  async callTool(name, args) {
    if (!READ_ONLY_MCP_TOOLS.has(name)) {
      throw new ImaBridgeError('forbidden', `IMA bridge refuses non-read tool '${name}'`)
    }
    await this.ensureStarted()
    const result = await this.request('tools/call', { name, arguments: args })
    return unwrapToolResult(name, result)
  }

  async stop() {
    this.stopped = true
    const child = this.child
    this.child = undefined
    if (child && child.exitCode === null) {
      child.kill()
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  }
}

function unwrapToolResult(name, result) {
  if (result && Array.isArray(result.content)) {
    const text = result.content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
    if (result.isError) throw new ImaBridgeError('mcp-error', `IMA MCP tool ${name} failed: ${text.slice(0, 400)}`)
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && parsed.error !== undefined) {
        throw new ImaBridgeError('mcp-error', `IMA MCP tool ${name} failed: ${JSON.stringify(parsed).slice(0, 400)}`)
      }
      return parsed
    } catch (error) {
      if (error instanceof ImaBridgeError) throw error
      throw new ImaBridgeError('mcp-error', `IMA MCP tool ${name} returned a non-JSON response`)
    }
  }
  if (result && result.structuredContent !== undefined) return result.structuredContent
  return result
}

/** Extract the OpenAPI envelope payload regardless of wrapper shape. */
function apiPayload(response) {
  if (response && typeof response === 'object' && 'code' in response) {
    if (response.code !== 0) {
      throw new ImaBridgeError('mcp-error', `IMA OpenAPI error ${response.code}: ${String(response.msg ?? '').slice(0, 200)}`)
    }
    return response.data ?? {}
  }
  return response ?? {}
}

export class ImaBridge {
  constructor({ config, mcp, fetchImpl, now = () => Date.now() } = {}) {
    this.config = config
    this.limits = { ...DEFAULT_LIMITS, ...(config?.limits ?? {}) }
    this.mcp = mcp
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.now = now
    this.server = undefined
    this.address = undefined
    this.inventoryCache = new Map()
    this.noteCache = new Map()
    this.manifestCache = new Map()
  }

  get configured() {
    return this.config !== undefined && this.mcp !== undefined
  }

  scopeTarget(scope) {
    const entry = this.config?.scopes?.[scope]
    if (!entry || typeof entry.knowledgeBaseId !== 'string' || entry.knowledgeBaseId.length === 0) {
      throw new ImaBridgeError('unknown-scope', `IMA bridge has no knowledge-base mapping for scope '${scope}'`)
    }
    return entry
  }

  /** List every entry of the locked knowledge base (paginated, short cache). */
  async inventory(scope) {
    const { knowledgeBaseId } = this.scopeTarget(scope)
    const cached = this.inventoryCache.get(scope)
    if (cached && this.now() - cached.fetchedAt < this.limits.manifestTtlMs) return cached
    const items = []
    let cursor = ''
    for (let page = 0; page < 20; page++) {
      const response = apiPayload(await this.mcp.callTool('ima_list_knowledge', {
        knowledge_base_id: knowledgeBaseId,
        limit: Math.min(this.limits.listPageSize, 20),
        ...(cursor ? { cursor } : {})
      }))
      const list = Array.isArray(response.knowledge_list) ? response.knowledge_list : []
      for (const item of list) {
        const id = firstString(item.media_id, item.id)
        if (!id) continue
        items.push({
          mediaId: id,
          title: firstString(item.title, id),
          mediaType: typeof item.media_type === 'number' ? item.media_type : undefined,
          folderId: firstString(item.parent_folder_id, item.folder_id)
        })
      }
      if (response.is_end !== false) break
      cursor = firstString(response.next_cursor) ?? ''
      if (!cursor) break
    }
    const value = { scope, knowledgeBaseId, items, fetchedAt: this.now() }
    this.inventoryCache.set(scope, value)
    return value
  }

  /** Download one markdown note and parse its handwritten frontmatter. */
  async note(scope, mediaId) {
    this.scopeTarget(scope)
    const cached = this.noteCache.get(mediaId)
    if (cached && this.now() - cached.fetchedAt < this.limits.noteCacheTtlMs) return cached
    const media = await this.mediaInfo(mediaId)
    const urlInfo = media?.url_info
    if (!urlInfo || typeof urlInfo.url !== 'string') {
      throw new ImaBridgeError('download-failed', `IMA media ${mediaId} has no downloadable URL`)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.limits.downloadTimeoutMs)
    let response
    try {
      response = await this.fetchImpl(urlInfo.url, {
        headers: urlInfo.headers ?? {},
        signal: controller.signal
      })
    } catch (error) {
      throw new ImaBridgeError('download-failed', `IMA media ${mediaId} download failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      throw new ImaBridgeError('download-failed', `IMA media ${mediaId} download returned HTTP ${response.status}`)
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > this.limits.maxDownloadBytes) {
      throw new ImaBridgeError('download-too-large', `IMA media ${mediaId} is ${bytes.byteLength} bytes, above the ${this.limits.maxDownloadBytes} bridge limit`)
    }
    const text = bytes.toString('utf8')
    const { frontmatter, body } = parseNoteFrontmatter(text)
    const value = {
      mediaId,
      byteDigest: `sha256:${sha256Hex(bytes)}`,
      byteLength: bytes.byteLength,
      frontmatter,
      body,
      fetchedAt: this.now()
    }
    this.noteCache.set(mediaId, value)
    return value
  }

  async mediaInfo(mediaId) {
    return apiPayload(await this.mcp.callTool('ima_get_media_info', { media_id: mediaId }))
  }

  /** IMA fields -> Xiaobai document contract normalization. */
  normalizeNote(scope, mediaId, listing, note) {
    const frontmatter = note.frontmatter ?? {}
    const revision = firstString(frontmatter.revision, frontmatter.sourceRevision)
    if (!revision) {
      throw new ImaBridgeError(
        'missing-revision',
        `IMA note ${mediaId} carries neither frontmatter revision nor sourceRevision; refusing to normalize without a server-declared version`
      )
    }
    const scopeValue = firstString(frontmatter.scope)
    if (!scopeValue) {
      throw new ImaBridgeError('missing-scope', `IMA note ${mediaId} has no frontmatter scope`)
    }
    if (scopeValue !== scope) {
      throw new ImaBridgeError(
        'out-of-scope',
        `IMA note ${mediaId} declares scope '${scopeValue}' but was retrieved under locked scope '${scope}'`
      )
    }
    const title = firstString(frontmatter.title, listing?.title, mediaId)
    return {
      id: mediaId,
      noteId: mediaId,
      title,
      content: note.body.slice(0, this.limits.maxCharacters),
      ...(firstString(frontmatter.category) ? { category: firstString(frontmatter.category) } : {}),
      source: `ima://${scope}/${mediaId}`,
      revision,
      digest: note.byteDigest,
      scope,
      ...(firstString(frontmatter.updatedAt) ? { updatedAt: firstString(frontmatter.updatedAt) } : {}),
      frontmatter: {
        ...frontmatter,
        ...(firstString(frontmatter.contentDigest) ? { contentDigest: firstString(frontmatter.contentDigest) } : {}),
        ...(firstString(frontmatter.sourceRevision) ? { sourceRevision: firstString(frontmatter.sourceRevision) } : {})
      }
    }
  }

  /** Best-effort server-side search; merged into candidates when it returns ids. */
  async serverSearchCandidates(scope, query) {
    const { knowledgeBaseId } = this.scopeTarget(scope)
    let response
    try {
      response = apiPayload(await this.mcp.callTool('ima_search_knowledge', {
        knowledge_base_id: knowledgeBaseId,
        query
      }))
    } catch (error) {
      if (error instanceof ImaBridgeError && error.code === 'mcp-error') return []
      throw error
    }
    const list = Array.isArray(response.info_list) ? response.info_list : []
    const ids = new Set()
    for (const item of list) {
      const id = firstString(item.media_id, item.id, item.note_id)
      if (id) ids.add(id)
    }
    return ids
  }

  /**
   * Read-only scoped search: enumerate the locked knowledge base, match the
   * query against file titles, frontmatter titles/categories and body text,
   * merge best-effort server search candidates, then download + normalize.
   */
  async search(input) {
    const scope = requireInputString(input, 'scope')
    const query = requireInputString(input, 'query')
    const limit = clampLimit(input?.limit ?? this.limits.maxLimit, this.limits.maxLimit)
    const inventory = await this.inventory(scope)
    const markdownItems = inventory.items.filter((item) => item.mediaType === undefined || item.mediaType === 7)
    const notes = new Map()
    for (const item of markdownItems) {
      try {
        notes.set(item.mediaId, { item, note: await this.note(scope, item.mediaId) })
      } catch (error) {
        if (error instanceof ImaBridgeError && (error.code === 'missing-revision' || error.code === 'missing-scope' || error.code === 'out-of-scope')) {
          // Knowledge that fails the frontmatter contract is excluded and
          // surfaced through the manifest, not silently returned.
          continue
        }
        throw error
      }
    }
    const serverIds = await this.serverSearchCandidates(scope, query)
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    const scored = []
    for (const [mediaId, { item, note }] of notes) {
      const frontmatter = note.frontmatter ?? {}
      const fileTitle = (item.title ?? '').toLowerCase()
      const fmTitle = String(frontmatter.title ?? '').toLowerCase()
      const category = String(frontmatter.category ?? '').toLowerCase()
      const body = note.body.toLowerCase()
      const combined = `${fileTitle} ${fmTitle} ${category} ${body}`
      const matched = serverIds.has(mediaId) || tokens.every((token) => combined.includes(token))
      if (!matched) continue
      let score = 0
      if (serverIds.has(mediaId)) score += 4
      if (tokens.every((token) => fmTitle.includes(token))) score += 3
      if (tokens.every((token) => fileTitle.includes(token))) score += 2
      if (tokens.every((token) => category.includes(token))) score += 1
      scored.push({ mediaId, item, note, score })
    }
    scored.sort((left, right) => right.score - left.score || left.mediaId.localeCompare(right.mediaId))
    const items = scored.slice(0, limit).map(({ mediaId, item, note }) => this.normalizeNote(scope, mediaId, item, note))
    return { items, matchedCount: scored.length, inventoryCount: inventory.items.length }
  }

  async getNote(input) {
    const scope = requireInputString(input, 'scope')
    const id = requireInputString(input, 'id')
    const inventory = await this.inventory(scope)
    const listing = inventory.items.find((item) => item.mediaId === id)
    if (!listing) {
      throw new ImaBridgeError('out-of-scope', `IMA media ${id} is not part of the knowledge base locked for scope '${scope}'`)
    }
    const note = await this.note(scope, id)
    return { items: [this.normalizeNote(scope, id, listing, note)] }
  }

  /** Media info without leaking signed URL parameters or signing headers. */
  async mediaInfoOp(input) {
    const mediaId = requireInputString(input, 'media_id')
    const media = await this.mediaInfo(mediaId)
    const urlInfo = media?.url_info
    return {
      media_id: mediaId,
      media_type: media?.media_type,
      downloadAvailable: Boolean(urlInfo && typeof urlInfo.url === 'string'),
      notebook_ext_info: media?.notebook_ext_info ?? null
    }
  }

  /** Bounded signed-URL content download. */
  async downloadMedia(input) {
    const mediaId = requireInputString(input, 'media_id')
    const media = await this.mediaInfo(mediaId)
    const urlInfo = media?.url_info
    if (!urlInfo || typeof urlInfo.url !== 'string') {
      throw new ImaBridgeError('download-failed', `IMA media ${mediaId} has no downloadable URL`)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.limits.downloadTimeoutMs)
    let response
    try {
      response = await this.fetchImpl(urlInfo.url, { headers: urlInfo.headers ?? {}, signal: controller.signal })
    } catch (error) {
      throw new ImaBridgeError('download-failed', `IMA media ${mediaId} download failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      throw new ImaBridgeError('download-failed', `IMA media ${mediaId} download returned HTTP ${response.status}`)
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > this.limits.maxDownloadBytes) {
      throw new ImaBridgeError('download-too-large', `IMA media ${mediaId} is ${bytes.byteLength} bytes, above the ${this.limits.maxDownloadBytes} bridge limit`)
    }
    const contentType = String(response.headers?.get?.('content-type') ?? '')
    const asText = /text|json|markdown|utf-8/i.test(contentType) || contentType === ''
    return {
      media_id: mediaId,
      bytes: bytes.byteLength,
      contentType,
      digest: `sha256:${sha256Hex(bytes)}`,
      ...(asText && bytes.byteLength <= this.limits.maxCharacters ? { content: bytes.toString('utf8') } : {})
    }
  }

  /**
   * Knowledge-base manifest: the uniform server-declared revision plus a
   * canonical digest over every markdown entry. This is the lock value stored
   * in project context bindings and re-verified before each IMA retrieval.
   */
  async manifest(input) {
    const scope = requireInputString(input, 'scope')
    const cached = this.manifestCache.get(scope)
    if (cached && this.now() - cached.computedAt < this.limits.manifestTtlMs) return cached.value
    const inventory = await this.inventory(scope)
    const entries = []
    const excluded = []
    for (const item of inventory.items) {
      if (item.mediaType !== undefined && item.mediaType !== 7) continue
      try {
        const note = await this.note(scope, item.mediaId)
        const record = this.normalizeNote(scope, item.mediaId, item, note)
        entries.push({
          id: record.id,
          title: record.title,
          revision: record.revision,
          contentDigest: record.frontmatter.contentDigest ?? null,
          digest: record.digest
        })
      } catch (error) {
        if (error instanceof ImaBridgeError) {
          excluded.push({ id: item.mediaId, title: item.title, reason: error.code, message: error.message })
          continue
        }
        throw error
      }
    }
    if (entries.length === 0) {
      throw new ImaBridgeError('empty-result', `Knowledge base for scope '${scope}' exposes no contract-compliant markdown notes`)
    }
    const revisions = [...new Set(entries.map((entry) => entry.revision))]
    if (revisions.length > 1) {
      throw new ImaBridgeError(
        'non-uniform-revision',
        `Knowledge base for scope '${scope}' carries mixed revisions ${revisions.join(', ')}; refusing to lock a single binding revision`
      )
    }
    entries.sort((left, right) => left.id.localeCompare(right.id))
    const value = {
      scope,
      knowledgeBaseId: inventory.knowledgeBaseId,
      inventoryCount: inventory.items.length,
      noteCount: entries.length,
      revision: revisions[0],
      digest: canonicalDigest(entries),
      adapterVersion: IMA_BRIDGE_VERSION,
      entries,
      ...(excluded.length > 0 ? { excluded } : {})
    }
    this.manifestCache.set(scope, { computedAt: this.now(), value })
    return value
  }

  async health() {
    const scopes = Object.keys(this.config?.scopes ?? {})
    return {
      ok: this.configured,
      adapterVersion: IMA_BRIDGE_VERSION,
      configured: this.configured,
      scopes: scopes.map((scope) => ({ scope, ...this.config.scopes[scope] })),
      listen: this.address ?? null,
      mcpRunning: this.mcp?.running ?? false,
      caches: {
        inventory: this.inventoryCache.size,
        notes: this.noteCache.size,
        manifests: this.manifestCache.size
      }
    }
  }

  async handle(tool, input) {
    switch (tool) {
      case 'ima_health':
        return this.health()
      case 'ima_search_knowledge':
        return this.search(input ?? {})
      case 'ima_get_note_content':
        return this.getNote(input ?? {})
      case 'ima_get_media_info':
        return this.mediaInfoOp(input ?? {})
      case 'ima_download_media':
        return this.downloadMedia(input ?? {})
      case 'ima_kb_manifest':
        return this.manifest(input ?? {})
      default:
        throw new ImaBridgeError('unknown-tool', `IMA bridge does not expose '${tool}'`)
    }
  }

  api() {
    return {
      version: IMA_BRIDGE_VERSION,
      call: (tool, input) => this.handle(tool, input),
      health: () => this.health(),
      address: () => this.address
    }
  }

  /** Loopback-only HTTP surface: POST /call, GET /health. */
  async startListen() {
    if (this.server) return this.address
    if (!this.configured) throw new ImaBridgeError('not-configured', 'IMA bridge is not configured')
    const host = this.config.listen?.host ?? '127.0.0.1'
    const port = this.config.listen?.port ?? 8791
    const server = createServer((request, response) => {
      this.handleHttpRequest(request, response).catch((error) => {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: false, error: { code: 'internal', message: String(error?.message ?? error).slice(0, 400) } }))
      })
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    this.server = server
    const address = server.address()
    this.address = {
      host,
      port: typeof address === 'object' && address !== null ? address.port : port,
      url: `http://${host}:${typeof address === 'object' && address !== null ? address.port : port}`
    }
    return this.address
  }

  async handleHttpRequest(request, response) {
    const send = (status, payload) => {
      response.writeHead(status, { 'content-type': 'application/json', 'x-ima-bridge': IMA_BRIDGE_VERSION })
      response.end(JSON.stringify(payload))
    }
    if (request.method === 'GET' && (request.url === '/health' || request.url === '/')) {
      return send(200, { ok: true, result: await this.health() })
    }
    if (request.method !== 'POST' || request.url !== '/call') {
      return send(request.method === 'POST' ? 404 : 405, { ok: false, error: { code: 'not-found', message: 'IMA bridge serves POST /call and GET /health only' } })
    }
    const chunks = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.byteLength
      if (size > 1024 * 1024) {
        return send(413, { ok: false, error: { code: 'payload-too-large', message: 'IMA bridge request body exceeds 1MB' } })
      }
      chunks.push(chunk)
    }
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return send(400, { ok: false, error: { code: 'invalid-json', message: 'IMA bridge request body is not valid JSON' } })
    }
    const tool = body?.tool
    if (typeof tool !== 'string' || tool.length === 0) {
      return send(400, { ok: false, error: { code: 'invalid-input', message: 'IMA bridge requires { tool, input }' } })
    }
    try {
      const result = await this.handle(tool, body.input ?? {})
      return send(200, { ok: true, result })
    } catch (error) {
      if (error instanceof ImaBridgeError) {
        const status = error.code === 'forbidden' ? 403 : error.code === 'unknown-tool' ? 404 : error.code === 'unknown-scope' || error.code === 'out-of-scope' ? 409 : 502
        return send(status, { ok: false, error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } })
      }
      return send(500, { ok: false, error: { code: 'internal', message: String(error?.message ?? error).slice(0, 400) } })
    }
  }

  async stop() {
    if (this.server) {
      const server = this.server
      this.server = undefined
      this.address = undefined
      await new Promise((resolve) => {
        server.close(() => resolve())
        // Keep-alive clients (undici/fetch) otherwise keep the loopback
        // listener open forever; force-close lingering sockets after close.
        server.closeAllConnections?.()
        setTimeout(() => {
          server.closeAllConnections?.()
          resolve()
        }, 250).unref?.()
      })
    }
    this.inventoryCache.clear()
    this.noteCache.clear()
    this.manifestCache.clear()
    if (this.ownsMcp && this.mcp) await this.mcp.stop()
  }
}

function requireInputString(input, key) {
  const value = input?.[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ImaBridgeError('invalid-input', `IMA bridge operation requires string input '${key}'`)
  }
  return value.trim()
}

function clampLimit(value, max) {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : max
  return Math.min(Math.max(parsed, 1), Math.min(max, 20))
}

export function defaultBridgeConfigPath() {
  const override = process.env[IMA_BRIDGE_CONFIG_ENV]
  if (override) return override
  const pluginLib = dirname(fileURLToPath(import.meta.url))
  const repoRoot = resolveDir(pluginLib, 4)
  return join(repoRoot, 'workspace', '.local', 'ima', 'scope-map.yaml')
}

function resolveDir(from, levels) {
  let current = from
  for (let index = 0; index < levels; index++) {
    current = dirname(current)
  }
  return current
}

export function loadImaBridgeConfig(configPath = defaultBridgeConfigPath()) {
  if (!existsSync(configPath)) return undefined
  let parsed
  try {
    parsed = parseYaml(readFileSync(configPath, 'utf8'))
  } catch (error) {
    throw new ImaBridgeError('invalid-config', `IMA bridge config ${configPath} is not valid YAML: ${error.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.scopes || typeof parsed.scopes !== 'object') {
    throw new ImaBridgeError('invalid-config', `IMA bridge config ${configPath} has no scopes mapping`)
  }
  return parsed
}

/**
 * Build the production bridge from local config: spawns the official ima-mcp
 * stdio server (which loads its own credentials) and listens on loopback.
 * Returns undefined when no local config exists — the DSH host stays dormant
 * and the engine CLI keeps failing closed on IMA retrieval.
 */
export function createImaBridgeFromEnvironment({ configPath, logger } = {}) {
  const path = configPath ?? defaultBridgeConfigPath()
  const config = loadImaBridgeConfig(path)
  if (!config) {
    logger?.info?.(`IMA bridge dormant: no config at ${path}`)
    return undefined
  }
  const server = config.server ?? {}
  const mcp = new ImaMcpStdioClient({
    command: server.command ?? 'node',
    args: Array.isArray(server.args) ? server.args : [],
    requestTimeoutMs: config.limits?.requestTimeoutMs
  })
  const bridge = new ImaBridge({ config, mcp })
  bridge.ownsMcp = true
  return bridge
}
