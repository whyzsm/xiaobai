import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import {
  ERROR_CODES,
  MemoryDomain,
  ProjectRegistry,
  bootstrapProjectBaseline,
  createPluginClockTiming,
  openMemoryDomain,
  projectStageTiming,
  probeHostVersions,
  resolveAgentPolicy,
  resolveAgentProfileContext,
  resolveMemoryPolicy,
  resolveProjectPolicy,
  resolveProjectPolicies,
  resolveSkillContext,
  resolveWorkflowPolicy,
  sha256Digest,
} from '../lib/index.js'

function project(key = 'project-a') {
  return bootstrapProjectBaseline({ key, owner: `owner-${key}` })
}

function provenance(baseline) {
  const knowledge = baseline.knowledgeBindings[0]
  return { source: knowledge.source, revision: knowledge.revision, digest: knowledge.digest, scope: baseline.projectId, trust: knowledge.trust }
}

function record(baseline, body, overrides = {}) {
  return {
    projectId: baseline.projectId,
    namespaceId: baseline.memory.namespaceId,
    kind: 'state',
    body,
    sourceRef: 'test:memory',
    createdAt: '2026-08-30T00:00:00.000Z',
    provenance: provenance(baseline),
    retention: 'project',
    ...overrides,
  }
}

function fakeDomain() {
  const tables = new Map()
  let closeCount = 0
  const domain = {
    table(name) {
      if (!tables.has(name)) tables.set(name, new Map())
      const table = tables.get(name)
      return {
        get: (key) => table.get(key),
        entries: () => table.entries(),
        put: async (key, value) => table.set(key, value),
        delete: async (key) => table.delete(key),
      }
    },
    close: async () => { closeCount += 1 },
    get closeCount() { return closeCount },
    tables,
  }
  return domain
}

test('MemoryDomain is idempotent for equal values and records durable conflicts', async () => {
  const baseline = project()
  const domain = fakeDomain()
  const memory = new MemoryDomain(baseline, domain)
  const value = record(baseline, { decision: 'keep' })
  const first = await memory.put('decision', value)
  const second = await memory.put('decision', { ...value })
  assert.deepEqual(second, first)
  await assert.rejects(() => memory.put('decision', record(baseline, { decision: 'replace' })), (error) => error.code === ERROR_CODES.MEMORY_CONFLICT)
  const conflicts = [...domain.tables.get('conflicts').values()]
  assert.equal(conflicts.length, 1)
  assert.deepEqual(memory.get('decision').body, { decision: 'keep' })
})

test('MemoryDomain prunes expired records and projects the same domain to Obsidian', async () => {
  const baseline = project()
  const domain = fakeDomain()
  const memory = new MemoryDomain(baseline, domain)
  await memory.put('expired', record(baseline, { value: 1 }, { expiresAt: '2026-08-29T00:00:00.000Z' }))
  await memory.put('kept', record(baseline, { value: 2 }, { expiresAt: '2026-09-01T00:00:00.000Z' }))
  assert.deepEqual(await memory.pruneExpired('2026-08-30T00:00:00.000Z'), { removed: [`${baseline.projectId}:expired`], count: 1 })
  const root = await mkdtemp(join(tmpdir(), 'xiaobai-memory-'))
  try {
    const projection = await memory.projectObsidian({ path: 'project-a.md', approvedRoot: root, write: true, provenance: provenance(baseline) })
    assert.equal(projection.contentDigest, sha256Digest(projection.content))
    assert.match(projection.content, /Memory Projection/)
    assert.equal(await readFile(join(root, 'project-a.md'), 'utf8'), projection.content)
    assert.equal(domain.tables.get('projections').size, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Memory wrappers for multiple Project scopes share one Host domain and close it after the last wrapper', async () => {
  const first = project('project-a')
  const second = project('project-b')
  const domain = fakeDomain()
  let opens = 0
  const ctx = { get: (key) => key === 'storageDomain' ? { open: async () => { opens += 1; return domain } } : undefined }
  const firstMemory = await openMemoryDomain(ctx, first, { scope: { project: first, scopeKey: {}, ctx } })
  const secondMemory = await openMemoryDomain(ctx, second, { scope: { project: second, scopeKey: {}, ctx } })
  assert.equal(opens, 1)
  await firstMemory.close()
  assert.equal(domain.closeCount, 0)
  await secondMemory.close()
  assert.equal(domain.closeCount, 1)
  await secondMemory.close()
  assert.equal(domain.closeCount, 1)
})

test('Memory provenance is required to stay in the owning Project scope', async () => {
  const baseline = project()
  const memory = new MemoryDomain(baseline, fakeDomain())
  await assert.rejects(() => memory.put('foreign', record(baseline, {}, { provenance: { ...provenance(baseline), scope: 'prj_foreign_scope' } })), (error) => error.code === ERROR_CODES.CAPABILITY_DENIED)
})

test('ProjectRegistry bridges a live Host Agent context into a child Project scope', async () => {
  const root = new Context()
  const baseline = project()
  const registry = new ProjectRegistry(root)
  registry.registerBaseline(baseline)
  const agentCtx = createScope(root, { agentId: 'agent_host_turn' }).ctx
  const agent = { id: 'agent_host_turn', status: 'running', ctx: agentCtx }
  const handle = registry.openProjectForAgent(baseline.projectId, agent)
  assert.notEqual(handle.ctx, agent.ctx)
  assert.equal(scopeOf(handle.ctx), handle.scopeKey)
  await registry.closeProject(baseline.projectId, handle.ctx)
})

test('X + X-policy resolution returns auditable metadata for every domain policy', () => {
  const baseline = project()
  const policies = resolveProjectPolicies(baseline)
  assert.deepEqual(Object.keys(policies).sort(), ['agent', 'memory', 'project', 'workflow'])
  for (const value of Object.values(policies)) {
    assert.match(value.digest, /^sha256:[a-f0-9]{64}$/)
    assert.equal(value.scope, baseline.projectId)
    assert.ok(value.source && value.revision && value.trust)
  }
  assert.equal(resolveAgentPolicy(baseline).policyId, 'xiaobai-agent-policy/default')
  assert.equal(resolveMemoryPolicy(baseline).policyId, 'xiaobai-memory-policy/default')
  assert.equal(resolveWorkflowPolicy(baseline).policyId, 'xiaobai-workflow-policy/fixed-script')
  assert.equal(resolveProjectPolicy(baseline).policyId, 'xiaobai-project-policy/default')
  const profile = resolveAgentProfileContext(baseline, baseline.agentProfiles[0])
  assert.equal(profile.context.scope, baseline.projectId)
  assert.throws(() => resolveSkillContext(baseline.skills[0]), (error) => error.code === ERROR_CODES.SCOPE_REQUIRED)
  assert.equal(resolveSkillContext(baseline.skills[0], { projectId: baseline.projectId }).scope, baseline.projectId)
})

test('stage timing projects Host wait pairs and preserves the duration equation', () => {
  const evidence = ['workflow:run_1']
  const result = projectStageTiming({
    stageId: 'stage_timing_a',
    stageStartSeq: 1,
    stageEndSeq: 10,
    evidence,
    events: [
      { seq: 1, type: 'turn/start', time: 100 },
      { seq: 2, type: 'tool/call', time: 110 },
      { seq: 3, type: 'tool/result', time: 160 },
      { seq: 4, type: 'model/requested', time: 170 },
      { seq: 5, type: 'model/completed', time: 190 },
      { seq: 6, type: 'approval/asked', time: 200 },
      { seq: 7, type: 'approval/decided', time: 230 },
      { seq: 8, type: 'error/blocked', time: 240 },
      { seq: 9, type: 'error/resolved', time: 260 },
      { seq: 10, type: 'turn/end', time: 300 },
    ],
  })
  assert.equal(result.timingSource, 'host-session')
  assert.deepEqual(result.waitingReasons, ['error-blocking', 'external-api', 'permission-wait', 'tool-execution'])
  assert.equal(result.durationMs, 200)
  assert.equal(result.waitingMs, 120)
  assert.equal(result.activeMs + result.waitingMs, result.durationMs)
  const unpaired = projectStageTiming({ stageId: 'stage_timing_b', events: [{ seq: 1, type: 'turn/start', time: 100 }, { seq: 2, type: 'tool/call', time: 120 }, { seq: 3, type: 'turn/end', time: 180 }] })
  assert.equal(unpaired.waitingMs, 60)
  assert.equal(unpaired.waitingReason, 'tool-execution')
  const unmeasured = projectStageTiming({ stageId: 'stage_timing_c', events: [{ seq: 1, type: 'turn/start' }, { seq: 2, type: 'turn/end' }] })
  assert.equal(unmeasured.status, 'unmeasured')
  assert.equal(unmeasured.timingSource, 'unmeasured')
  const pluginClock = createPluginClockTiming({ stageId: 'stage_timing_d', enteredAt: '2026-08-30T00:00:00.000Z', firstActionAt: '2026-08-30T00:00:00.010Z', exitedAt: '2026-08-30T00:00:00.100Z', waitingIntervals: [{ reason: 'permission-wait', startedAt: '2026-08-30T00:00:00.050Z', endedAt: '2026-08-30T00:00:00.080Z' }], evidence })
  assert.equal(pluginClock.timingSource, 'plugin-clock')
  assert.equal(pluginClock.activeMs + pluginClock.waitingMs, pluginClock.durationMs)
})

test('Host version probe distinguishes verified, conditional, and mismatched packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xiaobai-host-probe-'))
  try {
    const packages = [
      ['@deepseek-ai/dsh', '0.1.0-rc.6'],
      ['@deepseek-ai/cordis', '4.0.1'],
      ['@deepseek-ai/dsh-scope', '0.1.0-rc.6'],
      ['@deepseek-ai/dsh-storage-domain', '0.1.0-rc.6'],
      ['@deepseek-ai/dsh-skill', '0.1.0-rc.6'],
      ['@deepseek-ai/dsh-workflow', '0.1.0-rc.6'],
      ['@deepseek-ai/dsh-user-approval', '0.1.0-rc.6'],
      ['@deepseek-ai/dsh-invariants', '0.1.0-rc.6'],
      ['@deepseek-ai/dsh-typert-registry', '0.1.0-rc.6'],
      ['@deepseek-ai/dsh-workspace', '0.1.0-rc.6'],
      ['@deepseek-ai/dsh-agent', '0.1.0-rc.6'],
      ['@deepseek-ai/dsh-agent-loop', '0.1.0-rc.6'],
      ['@deepseek-ai/dsh-headless', '0.1.0-rc.6'],
    ]
    for (const [name, version] of packages) {
      const packageRoot = join(root, 'node_modules', ...name.split('/'))
      await mkdir(packageRoot, { recursive: true })
      await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name, version }))
    }
    assert.equal(probeHostVersions({ searchPaths: [root] }).status, 'verified')
    const mismatch = probeHostVersions({ searchPaths: [root], expected: { dsh: '0.1.0-rc.6', cordis: '4.0.1', seams: { scope: '9.9.9', storageDomain: '0.1.0-rc.6', skill: '0.1.0-rc.6', workflow: '0.1.0-rc.6', approval: '0.1.0-rc.6', invariants: '0.1.0-rc.6', typert: '0.1.0-rc.6', workspace: '0.1.0-rc.6' }, runtimes: { agent: '0.1.0-rc.6', agentLoop: '0.1.0-rc.6', headless: '0.1.0-rc.6' } } })
    assert.equal(mismatch.status, 'unsupported')
    assert.ok(mismatch.mismatches.includes('seams.scope'))
    assert.equal(probeHostVersions({ searchPaths: [join(root, 'missing')] }).status, 'conditional')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
