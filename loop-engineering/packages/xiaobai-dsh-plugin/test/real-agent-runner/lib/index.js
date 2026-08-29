import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { runHostAgentTurn, runMinimumVerticalPath, bootstrapProjectBaseline } from '../../../lib/index.js'

export const name = 'xiaobai-real-agent-test'
export const inject = ['agents', 'agentDefaultModel']

function createUserMessage(text) {
  return {
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

async function run(ctx) {
  const reportPath = process.env.XIAOBAI_DSH_REAL_AGENT_REPORT ?? '/tmp/xiaobai-dsh-m0/real-agent-report.json'
  const workspacePath = `/tmp/xiaobai-dsh-real-workspace-${process.pid}`
  const repoA = join(workspacePath, 'project-a')
  const repoB = join(workspacePath, 'project-b')
  await mkdir(repoA, { recursive: true })
  await mkdir(repoB, { recursive: true })
  const projectA = bootstrapProjectBaseline({ key: 'project-a', owner: 'real-agent-owner', repository: { name: 'project-a', root: 'project-a', pathTemplate: 'project-a' } })
  const projectB = bootstrapProjectBaseline({ key: 'project-b', owner: 'real-agent-owner', repository: { name: 'project-b', root: 'project-b', pathTemplate: 'project-b' } })
  const defaultModel = ctx.get('agentDefaultModel')
  const selection = defaultModel?.currentSelection?.()
  const result = await runHostAgentTurn({
    ctx,
    sessionId: `session_xiaobai_real_${randomUUID().replaceAll('-', '')}`,
    userMessage: 'Run the fixed Xiaobai stage.',
    createUserMessage,
    agentOptions: selection ? { provider: selection.provider, model: selection.model } : undefined,
    captureEvidence: true,
    run: ({ ctx: agentCtx, agent }) => runMinimumVerticalPath({
      ctx: agentCtx,
      agent,
      workspacePath,
      projects: [projectA, projectB],
      gatePolicy: { decide: async () => 'allowed-once' },
      persistArtifacts: false,
      localBindings: {
        [projectA.repositories[0].repoId]: { path: repoA, approvedRoots: [workspacePath] },
        [projectB.repositories[0].repoId]: { path: repoB, approvedRoots: [workspacePath] },
      },
    }),
  })
  const events = result.result?.stageEvidence ? (result.sessionEvents ?? []) : []
  const report = {
    completed: true,
    hostAgentEvidence: result.agentEvidence,
    stageEvidence: result.result.stageEvidence,
    gateDecision: result.result.decision,
    projectIds: result.result.projects,
    sessionEvents: events.map((event) => ({ seq: event.seq, type: event.type, time: event.time })),
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return report
}

export function apply(ctx) {
  void ctx.inject(['agents', 'agentDefaultModel'], async (agentCtx) => {
    try {
      await run(agentCtx)
      process.exitCode = 0
    } catch (error) {
      const reportPath = process.env.XIAOBAI_DSH_REAL_AGENT_REPORT ?? '/tmp/xiaobai-dsh-m0/real-agent-report.json'
      await writeFile(reportPath, `${JSON.stringify({ completed: false, error: error instanceof Error ? error.stack : String(error) }, null, 2)}\n`, 'utf8')
      process.exitCode = 1
    } finally {
      setImmediate(() => process.exit(process.exitCode ?? 1))
    }
  })
}
