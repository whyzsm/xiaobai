// Live integration test: real IMA bridge (stdio ima-mcp child) -> HTTP bridge
// -> ImaBridgeTransport -> ExecutionRuntime resolveImaContext against the real
// t-max knowledge binding in workspace/projects/t-max/.loop/project.yaml.
//
// Gate: only runs when XIAOBAI_IMA_LIVE=1 (needs local IMA credentials and the
// real ima.qq.com backend; the DSH-hosted bridge must be reachable or the test
// spawns its own bridge from the local scope-map config).
//
// 实机集成测试：真实 IMA 桥（stdio ima-mcp 子进程）→ HTTP 桥 → ImaBridgeTransport
// → ExecutionRuntime 的 resolveImaContext，绑定读取 workspace/projects/t-max 的
// project.yaml。仅当 XIAOBAI_IMA_LIVE=1 时执行（依赖本机 IMA 凭据与真实后端）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { ExecutionRuntime } from '../../../../../dist/loop-engineering/packages/execution-runtime/src/executionRuntime.js'
import { ImaBridgeTransport } from '../../../../../dist/loop-engineering/packages/connector-runtime/src/imaBridgeTransport.js'
import { LoopRuntime } from '../../../../../dist/loop-engineering/packages/loop-runtime/src/loopRuntime.js'
import { resolveMemoryRoot } from '../../../../../dist/loop-engineering/packages/shared/src/memoryRoot.js'
import { ImaBridge, ImaMcpStdioClient, loadImaBridgeConfig } from '../../lib/ima-bridge.js'

const LIVE = process.env.XIAOBAI_IMA_LIVE === '1'
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..')
const workspaceRoot = path.join(repoRoot, 'workspace')

async function startBridge() {
  // Reuse the DSH-hosted bridge when it is already listening; otherwise spawn
  // one from the local scope-map config on an ephemeral port.
  const preferred = process.env.XIAOBAI_IMA_BRIDGE_URL
  if (preferred) {
    const transport = new ImaBridgeTransport({ baseUrl: preferred })
    const health = await transport.call('ima_health', {}, { signal: AbortSignal.timeout(5000) }).catch(() => undefined)
    if (health) return { bridge: undefined, address: { url: preferred } }
  }
  const configPath = path.join(workspaceRoot, '.local', 'ima', 'scope-map.yaml')
  const config = loadImaBridgeConfig(configPath)
  assert(config, `live test requires IMA bridge config at ${configPath}`)
  const bridge = new ImaBridge({
    config: { ...config, listen: { host: '127.0.0.1', port: 0 } },
    mcp: new ImaMcpStdioClient({
      command: config.server?.command ?? 'node',
      args: config.server?.args ?? [],
      requestTimeoutMs: config.limits?.requestTimeoutMs
    })
  })
  bridge.ownsMcp = true
  const address = await bridge.startListen()
  return { bridge, address }
}

test('live IMA bridge serves the t-max knowledge manifest with a stable digest', { skip: !LIVE }, async (t) => {
  const { bridge, address } = await startBridge()
  t.after(() => bridge?.stop())
  const transport = new ImaBridgeTransport({ baseUrl: address.url })

  const first = await transport.call('ima_kb_manifest', { scope: 't-max' }, { signal: AbortSignal.timeout(60_000) })
  const second = await transport.call('ima_kb_manifest', { scope: 't-max' }, { signal: AbortSignal.timeout(60_000) })
  assert.equal(first.noteCount, 11)
  assert.equal(first.revision, '2a28700bb7d7d19797bf8154a1a1b755df208362')
  assert.equal(first.digest, second.digest, 'manifest digest must be deterministic across runs')
  assert.match(first.digest, /^sha256:[a-f0-9]{64}$/)
})

test('live ExecutionRuntime resolves IMA context through the bridge and fails closed on drift', { skip: !LIVE }, async (t) => {
  const { bridge, address } = await startBridge()
  t.after(() => bridge?.stop())
  const transport = new ImaBridgeTransport({ baseUrl: address.url })

  // Bind from the REAL t-max project.yaml so the pinned values are the live lock.
  const projectYaml = parseYaml(await readFile(path.join(workspaceRoot, 'projects', 't-max', '.loop', 'project.yaml'), 'utf8'))
  const liveBinding = projectYaml.knowledgeBindings?.find((binding) => binding.source === 'ima')
  assert(liveBinding, 'real t-max project.yaml must carry the ima knowledge binding')
  assert.notEqual(liveBinding.revision, 'pending-live-resolution')

  const loopPath = path.join(workspaceRoot, 'loops', 'morning-triage.loop.yaml')
  const loop = parseYaml(await readFile(loopPath, 'utf8'))
  const stage = loop.workflow?.stages?.[0]
  assert(stage, 'morning-triage loop must expose a first stage')
  const plan = {
    loopId: loop.metadata?.id ?? loop.metadata?.name ?? 'morning-triage',
    projectContext: { projectId: 't-max-live-ima', projectName: 't-max-live-ima' },
    contextBindings: [{
      knowledgeId: liveBinding.knowledgeId,
      source: 'ima',
      locator: liveBinding.locator,
      scope: liveBinding.scope,
      scopeKind: liveBinding.scopeKind,
      revision: liveBinding.revision,
      digest: liveBinding.digest,
      readOnly: liveBinding.readOnly,
      trust: liveBinding.trust,
      requiredCapabilities: liveBinding.requiredCapabilities
    }],
    workflow: {
      ...loop.workflow,
      stages: loop.workflow.stages.map((stage) => ({ ...stage, dependsOn: stage.dependsOn ?? [] }))
    }
  }

  const runtimeOptions = {
    workspaceRoot,
    memoryRoot: await resolveMemoryRoot(workspaceRoot),
    loop,
    plan,
    imaTransport: transport
  }
  // The harness identity check compares against loop.generator.agent minus the
  // .agent.yaml suffix ('generator') and the harness yaml metadata.id
  // ('coding-harness') — not the stage file references.
  // harness 身份校验比对的是 loop.generator.agent 去后缀（'generator'）与
  // harness yaml 的 metadata.id（'coding-harness'），不是 stage 里的文件引用。
  const noopExecutor = {
    id: 'live-ima-noop-executor',
    async execute(input) {
      const executedStage = plan.workflow.stages.find((item) => item.id === input.stageId) ?? plan.workflow.stages[0]
      return {
        status: 'completed',
        submission: {
          runId: input.runId,
          taskId: input.taskId,
          agentId: 'generator',
          harnessId: 'coding-harness',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          loadedContext: ['repository-skill', 'project-skill', 'task-brief', 'relevant-files', 'previous-memory'],
          contextCharactersUsed: 8000,
          toolsUsed: ['read_file', 'run_tests', 'git_diff'],
          completedConditions: [...(executedStage.requiredChecks ?? [])],
          output: Object.fromEntries((executedStage.outputs ?? []).map((field) => [field, `${field} result`])),
          evidence: (executedStage.requiredChecks ?? []).map((checkId) => ({
            checkId,
            type: 'review',
            value: `${checkId} independently verified`
          }))
        },
        evidence: []
      }
    }
  }
  const runOptions = {
    runId: `run-live-ima-${Date.now()}`,
    taskId: `task-live-ima-${Date.now()}`,
    stageId: stage.id,
    subject: { imaQuery: '页面验收' }
  }

  const result = await new ExecutionRuntime(runtimeOptions).execute(runOptions, noopExecutor)
  assert.equal(result.status, 'passed', result.reasons.join('\n'))
  const retrieval = JSON.parse(await readFile(path.join(runtimeOptions.memoryRoot, 'loops', 'morning-triage', 'runs', runOptions.runId, 'ima-retrieval.json'), 'utf8'))
  assert.equal(retrieval.documents.length > 0, true)
  assert.match(retrieval.documents[0].digest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(retrieval.documents[0].revision, liveBinding.revision)

  // Drift-forcing run: corrupt the pinned revision in the loaded plan to prove
  // the manifest verification blocks execution before any retrieval.
  const driftedPlan = structuredClone(plan)
  driftedPlan.contextBindings[0].revision = 'dead0000dead0000dead0000dead0000dead0000'
  const driftResult = await new ExecutionRuntime({ ...runtimeOptions, plan: driftedPlan }).execute(
    { ...runOptions, runId: `${runOptions.runId}-drift` },
    noopExecutor
  )
  assert.equal(driftResult.status, 'failed')
  assert.match(driftResult.reasons.join('\n'), /failed closed|drifted/)
})
