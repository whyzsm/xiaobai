import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { mkdir, lstat, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { ERROR_CODES, ID_PATTERNS } from './constants.js'
import { sha256Digest, stableStringify } from './canonical.js'
import { validateContract } from './contracts.js'
import { MemoryAuditSchema, MemoryCheckpointSchema, MemoryConflictSchema, MemoryProjectionSchema, MemoryRecordSchema } from './typed.js'
import { contractError, memoryConflict, scopeRequired, XiaobaiError } from './errors.js'
import { assertPathWithin } from './lock.js'

export const MEMORY_DOMAIN_NAME = 'xiaobai_memory'

export const memoryDomainSpec = defineDomain({
  name: MEMORY_DOMAIN_NAME,
  version: 1,
  tables: {
    records: { valueSchema: MemoryRecordSchema },
    checkpoints: { valueSchema: MemoryCheckpointSchema },
    audits: { valueSchema: MemoryAuditSchema },
    conflicts: { valueSchema: MemoryConflictSchema },
    projections: { valueSchema: MemoryProjectionSchema },
  },
})

const openDomains = new WeakMap()

function tableEntries(table) {
  return typeof table?.entries === 'function' ? [...table.entries()] : []
}

function assertMemoryValue(project, value) {
  if (!value || value.projectId !== project.projectId || value.namespaceId !== project.memory.namespaceId) {
    throw new XiaobaiError(ERROR_CODES.CAPABILITY_DENIED, `Memory value is outside project '${project.projectId}' namespace`, {
      resourceId: project.projectId,
      phase: 'memory-boundary',
      expected: { projectId: project.projectId, namespaceId: project.memory.namespaceId },
      actual: value && { projectId: value.projectId, namespaceId: value.namespaceId },
      remediation: 'Use the Memory API from the owning Project scope.',
    })
  }
  if (!value.provenance || value.provenance.scope !== project.projectId) {
    throw new XiaobaiError(ERROR_CODES.CAPABILITY_DENIED, `Memory provenance is outside project '${project.projectId}' scope`, {
      resourceId: project.projectId,
      phase: 'memory-provenance',
      expected: project.projectId,
      actual: value.provenance?.scope,
      remediation: 'Bind the record to the owning Project scope before writing it.',
    })
  }
}

function assertDate(value, field) {
  if (!Number.isFinite(Date.parse(value))) throw contractError(`${field} must be an ISO-8601 date`, { phase: 'memory-validation', actual: value })
}

async function acquireDomain(ctx, spec) {
  let domains = openDomains.get(ctx)
  if (!domains) {
    domains = new Map()
    openDomains.set(ctx, domains)
  }
  const existing = domains.get(spec.name)
  if (existing) {
    if (existing.opening) await existing.opening
    existing.refs += 1
    return { domain: existing.domain, release: () => releaseDomain(ctx, spec.name, existing) }
  }
  const storage = ctx.get('storageDomain')
  const entry = { refs: 0, domain: undefined, opening: undefined }
  entry.opening = storage.open(spec)
  domains.set(spec.name, entry)
  try {
    entry.domain = await entry.opening
    entry.opening = undefined
    entry.refs = 1
    return { domain: entry.domain, release: () => releaseDomain(ctx, spec.name, entry) }
  } catch (error) {
    domains.delete(spec.name)
    throw error
  }
}

async function releaseDomain(ctx, name, entry) {
  if (entry.refs <= 0) return
  entry.refs -= 1
  if (entry.refs > 0) return
  const domains = openDomains.get(ctx)
  if (domains?.get(name) === entry) domains.delete(name)
  await entry.domain.close()
}

async function projectionTarget(path, approvedRoot) {
  if (approvedRoot === undefined) return path
  if (!isAbsolute(approvedRoot)) throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, 'Obsidian projection root must be absolute', { phase: 'memory-projection', actual: approvedRoot })
  await mkdir(approvedRoot, { recursive: true })
  const root = await realpath(approvedRoot)
  const target = isAbsolute(path) ? resolve(path) : resolve(root, path)
  assertPathWithin(root, target)
  for (let current = target; current !== root && current !== dirname(current); current = dirname(current)) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, `Obsidian projection path '${current}' is a symbolic link`, { phase: 'memory-projection', actual: current })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  return target
}

function assertProjectRecord(project, value) {
  if (!value || value.projectId !== project.projectId || value.namespaceId !== project.memory.namespaceId) throw new XiaobaiError(ERROR_CODES.CAPABILITY_DENIED, `Memory record is outside project '${project.projectId}' namespace`, { resourceId: project.projectId, phase: 'memory-boundary', expected: { projectId: project.projectId, namespaceId: project.memory.namespaceId }, actual: value && { projectId: value.projectId, namespaceId: value.namespaceId }, remediation: 'Use the Memory API from the owning Project scope.' })
}

export class MemoryDomain {
  constructor(project, domain, options = {}) {
    this.project = validateContract('projectBaseline', project)
    this.domain = domain
    this.release = options.release
    this.closed = false
  }

  key(recordId) {
    return `${this.project.projectId}:${recordId}`
  }

  async put(recordId, value) {
    assertMemoryValue(this.project, value)
    const normalized = validateContract('memoryRecord', value)
    assertDate(normalized.createdAt, 'memoryRecord.createdAt')
    if (normalized.expiresAt !== undefined) assertDate(normalized.expiresAt, 'memoryRecord.expiresAt')
    const table = this.domain.table('records')
    const key = this.key(recordId)
    const existing = table.get(key)
    if (existing) {
      const existingDigest = sha256Digest(existing)
      const incomingDigest = sha256Digest(normalized)
      if (existingDigest === incomingDigest) return existing
      const conflict = validateContract('memoryConflict', {
        conflictId: `conflict_${incomingDigest.slice(7, 19)}`,
        projectId: this.project.projectId,
        namespaceId: this.project.memory.namespaceId,
        recordKey: key,
        existingDigest,
        incomingDigest,
        createdAt: new Date().toISOString(),
        provenance: normalized.provenance,
      })
      await this.domain.table('conflicts').put(this.key(conflict.conflictId), conflict)
      throw memoryConflict(key, existingDigest, incomingDigest)
    }
    await table.put(key, normalized)
    return normalized
  }

  get(recordId) {
    const value = this.domain.table('records').get(this.key(recordId))
    if (!value) return value
    assertMemoryValue(this.project, value)
    return validateContract('memoryRecord', value)
  }

  async checkpoint(value) {
    assertMemoryValue(this.project, value)
    const normalized = validateContract('memoryCheckpoint', value)
    assertDate(normalized.createdAt, 'memoryCheckpoint.createdAt')
    await this.domain.table('checkpoints').put(this.key(normalized.checkpointId), normalized)
    return normalized
  }

  async audit(value) {
    assertMemoryValue(this.project, value)
    const normalized = validateContract('memoryAudit', value)
    assertDate(normalized.createdAt, 'memoryAudit.createdAt')
    await this.domain.table('audits').put(this.key(normalized.auditId), normalized)
    return normalized
  }

  async pruneExpired(now = new Date()) {
    const timestamp = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now)
    if (!Number.isFinite(timestamp)) throw contractError('Memory prune time must be a valid date', { phase: 'memory-retention', actual: now })
    const removed = []
    for (const [key, value] of tableEntries(this.domain.table('records'))) {
      if (value.expiresAt === undefined || Date.parse(value.expiresAt) > timestamp) continue
      await this.domain.table('records').delete(key)
      removed.push(key)
    }
    return { removed, count: removed.length }
  }

  async projectObsidian(options = {}) {
    const provenance = options.provenance
    if (!provenance) throw new XiaobaiError(ERROR_CODES.MEMORY_AUDIT_FAILED, 'Obsidian projection requires provenance', { resourceId: this.project.projectId, phase: 'memory-projection' })
    assertMemoryValue(this.project, { projectId: this.project.projectId, namespaceId: this.project.memory.namespaceId, provenance })
    const records = tableEntries(this.domain.table('records')).sort(([left], [right]) => left.localeCompare(right))
    const content = [
      `# Memory Projection: ${this.project.projectId}`,
      '',
      `Namespace: ${this.project.memory.namespaceId}`,
      '',
      ...records.flatMap(([key, value]) => [`## ${key}`, '', '```json', stableStringify(value), '```', '']),
    ].join('\n')
    const targetPath = options.path ?? `memory/${this.project.key}.md`
    const outputPath = await projectionTarget(targetPath, options.approvedRoot)
    if (options.write === true) {
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(outputPath, content, 'utf8')
    }
    const projection = validateContract('memoryProjection', {
      projectionId: options.projectionId ?? `projection_${sha256Digest({ projectId: this.project.projectId, path: outputPath, content }).slice(7, 19)}`,
      projectId: this.project.projectId,
      namespaceId: this.project.memory.namespaceId,
      target: 'obsidian',
      path: outputPath,
      contentDigest: sha256Digest(content),
      sourceRecordIds: records.map(([key]) => key),
      content,
      createdAt: options.createdAt ?? new Date().toISOString(),
      provenance,
    })
    await this.domain.table('projections').put(this.key(projection.projectionId), projection)
    return projection
  }

  async close() {
    if (this.closed) return
    this.closed = true
    if (this.release) return this.release()
    return this.domain.close()
  }
}

export async function openMemoryDomain(ctx, project, options = {}) {
  if (!project?.projectId || !project.memory?.namespaceId || !ID_PATTERNS.resource.test(project.memory.namespaceId)) throw new XiaobaiError(ERROR_CODES.SCOPE_REQUIRED, 'Memory requires a validated Project scope and namespace', { phase: 'memory-open' })
  const scope = options.scope
  if (!scope || scope.ctx !== ctx || scope.project?.projectId !== project.projectId || scope.scopeKey === undefined) throw scopeRequired(project.projectId, 'memory-open')
  options.projectRegistry?.assertProjectContext?.(project.projectId, ctx)
  if (typeof ctx?.get !== 'function' || !ctx.get('storageDomain')) throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Host storageDomain is unavailable', { phase: 'memory-open' })
  const spec = options.spec ?? memoryDomainSpec
  const acquired = await acquireDomain(ctx, spec)
  try {
    return new MemoryDomain(project, acquired.domain, { release: acquired.release })
  } catch (error) {
    try { await acquired.release() } catch (closeError) {
      if (error && typeof error === 'object') error.cleanupError = closeError
    }
    throw error
  }
}

export function projectMemoryRecord(project, input) {
  const normalized = validateContract('projectBaseline', project)
  const record = { ...input, projectId: normalized.projectId, namespaceId: normalized.memory.namespaceId }
  return record
}
