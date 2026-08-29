import { ERROR_CODES } from './constants.js'
import { sha256Digest } from './canonical.js'
import { XiaobaiError } from './errors.js'
import { getHostService } from './host.js'

export const FIXED_DIGEST_WORKFLOW_SCRIPT = `return { stage: args.stageId, inputDigest: args.inputDigest, contractVersion: args.outputContract }`
export const FIXED_DIGEST_WORKFLOW_SCRIPT_HASH = sha256Digest(FIXED_DIGEST_WORKFLOW_SCRIPT)

export function assertFixedWorkflowScript(script = FIXED_DIGEST_WORKFLOW_SCRIPT, expectedDigest = FIXED_DIGEST_WORKFLOW_SCRIPT_HASH) {
  if (script !== FIXED_DIGEST_WORKFLOW_SCRIPT || sha256Digest(script) !== expectedDigest) throw new XiaobaiError(ERROR_CODES.WORKFLOW_SCRIPT_UNTRUSTED, 'Workflow orchestration script is not the approved fixed script', { phase: 'workflow-script-policy', expected: expectedDigest, actual: sha256Digest(script), remediation: 'Use a plugin-owned fixed script and update its reviewed digest.' })
  return expectedDigest
}

export function startFixedStage({ ctx, parent, stageId, inputDigest, outputContract, signal, maxTotalAgents }) {
  const engine = getHostService(ctx, 'workflowEngine')
  if (!engine || typeof engine.start !== 'function') throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Host workflowEngine.start is unavailable in this scope', { phase: 'workflow-start' })
  const script = FIXED_DIGEST_WORKFLOW_SCRIPT
  const workflowScriptDigest = assertFixedWorkflowScript(script)
  const run = engine.start({
    script,
    meta: { name: 'xiaobai-fixed-stage', description: 'Run one fixed Xiaobai stage', phases: [{ title: 'stage' }] },
    args: { stageId, inputDigest, outputContract },
    parent,
    signal,
    ...(maxTotalAgents === undefined ? {} : { maxTotalAgents }),
  })
  return { run, workflowScriptDigest }
}

export async function executeFixedStage(input) {
  const started = startFixedStage(input)
  try {
    const result = await started.run.result
    if (result.stopReason !== 'completed') throw new XiaobaiError(ERROR_CODES.WORKFLOW_SCRIPT_UNTRUSTED, `Fixed stage stopped with '${result.stopReason}'`, { phase: 'workflow-result', actual: result, remediation: 'Inspect the Host workflow result and rerun the stage.' })
    return { result: result.value, workflowScriptDigest: started.workflowScriptDigest, runId: started.run.id }
  } finally {
    await started.run.dispose()
  }
}
