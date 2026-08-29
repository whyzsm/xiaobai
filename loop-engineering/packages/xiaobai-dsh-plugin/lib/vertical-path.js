import { randomUUID } from 'node:crypto'
import { sha256Digest } from './canonical.js'
import { bootstrapProjectBaseline } from './contracts.js'
import { buildContextLock } from './knowledge.js'
import { assertPathWithin, buildRunLock, persistLock } from './lock.js'
import { ProjectRegistry } from './project.js'
import { registerSkillProvider } from './skill.js'
import { executeFixedStage, FIXED_DIGEST_WORKFLOW_SCRIPT_HASH } from './workflow.js'
import { evaluateStage, requireEvaluationPass } from './evaluator.js'
import { requestGate, assertGateSuccess, registerGateAnswerer } from './gate.js'
import { openMemoryDomain } from './memory.js'
import { validateContract, validateProjectBaseline } from './contracts.js'
import { resolve } from 'node:path'
import { scopeRequired } from './errors.js'
import { createPluginClockTiming, projectStageTiming } from './timing.js'
import { resolveProjectPolicies } from './policy.js'

function sessionEvents(agent) {
  return Array.isArray(agent?.session?.events) ? agent.session.events : []
}

function nextSessionSeq(agent) {
  const sequences = sessionEvents(agent).map((event) => event?.seq).filter(Number.isSafeInteger)
  return sequences.length === 0 ? 0 : Math.max(...sequences) + 1
}

function memoryProvenance(knowledge) {
  return { source: knowledge.source, revision: knowledge.revision, digest: knowledge.digest, scope: knowledge.scope, trust: knowledge.trust }
}

export async function runMinimumVerticalPath({ ctx, workspacePath, projects, agent, gatePolicy, gateInput = {}, projectRegistry, localBindings = {}, persistArtifacts = true }) {
  if (!agent) throw new Error('runMinimumVerticalPath requires a live Host Agent for workflow and approval seams')
  const registry = projectRegistry ?? new ProjectRegistry(ctx)
  const opened = []
  const registered = []
  let workspace
  let baselines
  let primary
  let skillDisposer
  let memory
  let gateDisposer
  let primaryFailure
  try {
    workspace = await registry.attachWorkspace(workspacePath, 'xiaobai-workspace')
    baselines = (projects ?? [{ key: 'project-a', owner: 'owner-a' }, { key: 'project-b', owner: 'owner-b' }]).map((input) => input?.schemaVersion ? validateProjectBaseline(input) : bootstrapProjectBaseline(input))
    for (const baseline of baselines) {
      if (typeof registry.get === 'function' && registry.get(baseline.projectId)) continue
      registry.registerBaseline(baseline)
      registered.push(baseline.projectId)
    }
    for (const [index, baseline] of baselines.entries()) {
      if (index === 0 && typeof registry.openProjectForAgent === 'function') opened.push(registry.openProjectForAgent(baseline.projectId, agent))
      else opened.push(registry.openProject(baseline.projectId))
    }
    primary = opened[0]
    const executionCtx = primary.ctx
    if (!executionCtx) throw scopeRequired(primary.project.projectId, 'project-run')
    registry.assertProjectContext?.(primary.project.projectId, primary.ctx)
    const repository = primary.project.repositories[0]
    const repositoryBinding = typeof registry.resolveRepository === 'function'
      ? await registry.resolveRepository(primary.project.projectId, repository.repoId, { workspacePath: workspace.path, localBindings })
      : undefined
    const repositoryBindingDigest = sha256Digest({ projectId: primary.project.projectId, repository: repositoryBinding?.repository ?? repository, worktree: repositoryBinding?.worktree, logicalPath: repositoryBinding?.logicalPath ?? repository.pathTemplate ?? repository.root })
    const skill = primary.project.skills[0]
    skillDisposer = registerSkillProvider(executionCtx, skill, { content: `# ${skill.name}\n\n${skill.purpose}`, projectId: primary.project.projectId })
    const knowledge = primary.project.knowledgeBindings[0]
    const policies = resolveProjectPolicies(primary.project)
    const contextLock = buildContextLock({ project: primary.project, workspaceId: workspace.id, knowledge, agentPolicyDigest: policies.agent.digest, skillRevision: skill.version, memoryNamespaceId: primary.project.memory.namespaceId })
    const runLock = buildRunLock({ runId: `run_${randomUUID().replaceAll('-', '')}`, workspaceId: workspace.id, project: primary.project, scopeKey: `scope:${primary.project.projectId}`, knowledge: [knowledge], repositoryBindingDigest, agentPolicyDigest: contextLock.agentPolicyDigest, skillRevision: skill.version, workflowScriptDigest: FIXED_DIGEST_WORKFLOW_SCRIPT_HASH, policyDigest: sha256Digest(policies), memoryNamespaceId: primary.project.memory.namespaceId, artifactRoot: primary.project.artifactRoot })
    const artifactRoot = resolve(workspace.path, primary.project.artifactRoot)
    assertPathWithin(workspace.path, artifactRoot)
    const lockPath = persistArtifacts ? await persistLock(runLock, artifactRoot, { approvedRoot: workspace.path }) : undefined
    const stageId = `stage_${randomUUID().replaceAll('-', '')}`
    const stageInput = { stageId, inputDigest: sha256Digest({ contextLock, runLock }), outputContract: 'stage-result/v1' }
    memory = await openMemoryDomain(executionCtx, primary.project, { scope: primary, projectRegistry: registry })
    // dsh resolves approval/request against the live Agent scope, while the policy remains
    // closed over this Project's execution context and is therefore still project-specific.
    gateDisposer = registerGateAnswerer(agent.ctx, gatePolicy)
    const provenance = memoryProvenance(knowledge)
    const enteredAt = new Date()
    let firstActionAt = enteredAt
    let workflowFinishedAt = enteredAt
    let gateAskedAt = enteredAt
    let exitedAt = enteredAt
    await memory.put(`run-context:${runLock.runId}`, { projectId: primary.project.projectId, namespaceId: primary.project.memory.namespaceId, kind: 'run', body: { runId: runLock.runId, contextDigest: contextLock.contextDigest }, sourceRef: `run:${runLock.runId}`, createdAt: enteredAt.toISOString(), provenance, retention: primary.project.memory.retention })
    const stageStartSeq = nextSessionSeq(agent)
    firstActionAt = new Date()
    const stageRun = await executeFixedStage({ ctx: executionCtx, parent: agent, ...stageInput })
    workflowFinishedAt = new Date()
    const evaluated = evaluateStage({ evaluatorId: primary.project.agentProfiles[0].agentId, stageId, output: stageRun.result, outputContract: stageInput.outputContract, evidence: [`workflow:${stageRun.runId}`, `lock:${runLock.runId}`] })
    const evaluation = requireEvaluationPass(evaluated)
    await memory.checkpoint({ checkpointId: `run_${runLock.runId.slice(4)}`, projectId: primary.project.projectId, namespaceId: primary.project.memory.namespaceId, inputDigest: stageInput.inputDigest, auditDigest: sha256Digest(evaluation), sourceRef: `evaluator:${primary.project.agentProfiles[0].agentId}`, createdAt: workflowFinishedAt.toISOString(), provenance })
    gateAskedAt = new Date()
    const decision = await requestGate({ ctx: executionCtx, agent, input: gateInput, actor: 'xiaobai-human-gate', reason: 'Approve the evaluated fixed stage', evidence: evaluation.evidence, signal: gatePolicy?.signal })
    exitedAt = new Date()
    assertGateSuccess(decision)
    const evidence = [...evaluation.evidence, `gate:${decision.gateId}`]
    const stageEndSeq = nextSessionSeq(agent) - 1
    const hostTiming = projectStageTiming({ stageId, events: sessionEvents(agent), stageStartSeq, stageEndSeq, status: 'completed', evidence })
    const stageEvidence = hostTiming.timingSource === 'host-session'
      ? hostTiming
      : createPluginClockTiming({ stageId, enteredAt, firstActionAt, exitedAt, status: 'completed', waitingIntervals: [{ reason: 'permission-wait', startedAt: gateAskedAt, endedAt: exitedAt }], evidence })
    await memory.audit({ auditId: `evidence_${runLock.runId.slice(4)}`, projectId: primary.project.projectId, namespaceId: primary.project.memory.namespaceId, eventType: 'stage/completed', sourceEventRef: `gate:${decision.gateId}`, evidence: stageEvidence.evidence, createdAt: exitedAt.toISOString(), provenance })
    const successEvidence = { ...stageEvidence, lock: runLock, policyDigest: runLock.policyDigest, memoryNamespaceId: runLock.memoryNamespaceId }
    if (typeof executionCtx.emit === 'function') executionCtx.emit('xiaobai/stage-success', successEvidence)
    return { workspace, projects: baselines.map((item) => item.projectId), repositoryBinding, contextLock, policies, runLock, lockPath, evaluation, decision, stageEvidence }
  } catch (error) {
    primaryFailure = error
    throw error
  } finally {
    const cleanupErrors = []
    if (gateDisposer) try { await gateDisposer() } catch (error) { cleanupErrors.push(error) }
    if (memory) try { await memory.close() } catch (error) { cleanupErrors.push(error) }
    if (skillDisposer) try { await skillDisposer() } catch (error) { cleanupErrors.push(error) }
    for (const entry of [...opened].reverse()) {
      try { await registry.closeProject(entry.project.projectId, entry.ctx) } catch (error) { cleanupErrors.push(error) }
    }
    if (typeof registry.unregisterBaseline === 'function') {
      for (const projectId of [...registered].reverse()) {
        try { registry.unregisterBaseline(projectId) } catch (error) { cleanupErrors.push(error) }
      }
    }
    if (cleanupErrors.length > 0 && primaryFailure) primaryFailure.cleanupErrors = cleanupErrors
    if (cleanupErrors.length > 0 && !primaryFailure) throw new AggregateError(cleanupErrors, 'Xiaobai vertical path cleanup failed')
  }
}
