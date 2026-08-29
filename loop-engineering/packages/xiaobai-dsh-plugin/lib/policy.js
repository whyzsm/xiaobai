import { PACKAGE_NAME } from './constants.js'
import { sha256Digest } from './canonical.js'
import { validateProjectBaseline, validateContract } from './contracts.js'
import { PolicyContextSchema, ResolvedContextSchema } from './typed.js'

export const POLICY_KINDS = Object.freeze(['agent', 'memory', 'workflow', 'project'])

const DEFAULT_POLICIES = Object.freeze({
  agent: { policyId: 'xiaobai-agent-policy/default', revision: '1.0.0', trust: 'bundled', values: { context: 'locked-project-only', modelOutput: 'nondeterministic' }, requiredCapabilities: [] },
  memory: { policyId: 'xiaobai-memory-policy/default', revision: '1.0.0', trust: 'bundled', values: { namespace: 'project', appendOnly: ['run', 'finding', 'metric'], humanManaged: ['state', 'inbox', 'decision'] }, requiredCapabilities: ['storageDomain'] },
  workflow: { policyId: 'xiaobai-workflow-policy/fixed-script', revision: '1.0.0', trust: 'bundled', values: { orchestration: 'plugin-fixed-script', modelGeneratedScript: false }, requiredCapabilities: ['workflowEngine'] },
  project: { policyId: 'xiaobai-project-policy/default', revision: '1.0.0', trust: 'bundled', values: { crossProjectAccess: 'explicit-read-only-binding', workspaceModel: 'one-host-workspace-many-project-scopes' }, requiredCapabilities: ['workspaceRegistry', 'scope'] },
})

function resolveDefault(kind, project, options = {}) {
  if (!POLICY_KINDS.includes(kind)) throw new Error(`Unknown Xiaobai policy kind '${kind}'`)
  const baseline = validateProjectBaseline(project)
  const defaults = DEFAULT_POLICIES[kind]
  const ref = baseline.policyRefs?.[kind] ?? defaults.policyId
  const resolved = {
    kind,
    policyId: ref,
    values: options.values ?? defaults.values,
    source: options.source ?? PACKAGE_NAME,
    revision: options.revision ?? defaults.revision,
    scope: options.scope ?? baseline.projectId,
    trust: options.trust ?? defaults.trust,
    requiredCapabilities: options.requiredCapabilities ?? defaults.requiredCapabilities,
  }
  resolved.digest = sha256Digest({ kind: resolved.kind, policyId: resolved.policyId, values: resolved.values, revision: resolved.revision, scope: resolved.scope })
  return validateContract('policyContext', PolicyContextSchema.parse(resolved))
}

export function resolvePolicyContext(kind, project, options = {}) {
  return resolveDefault(kind, project, options)
}

export function resolveAgentPolicy(project, options = {}) {
  return resolveDefault('agent', project, options)
}

export function resolveMemoryPolicy(project, options = {}) {
  return resolveDefault('memory', project, options)
}

export function resolveWorkflowPolicy(project, options = {}) {
  return resolveDefault('workflow', project, options)
}

export function resolveProjectPolicy(project, options = {}) {
  return resolveDefault('project', project, options)
}

export function resolveProjectPolicies(project, options = {}) {
  return Object.fromEntries(POLICY_KINDS.map((kind) => [kind, resolveDefault(kind, project, options[kind] ?? {})]))
}

export function resolveAgentProfileContext(project, profile, options = {}) {
  const baseline = validateProjectBaseline(project)
  const context = {
    source: options.source ?? PACKAGE_NAME,
    revision: options.revision ?? '1.0.0',
    digest: sha256Digest(profile),
    scope: options.scope ?? baseline.projectId,
    trust: options.trust ?? 'project',
    requiredCapabilities: [...profile.capabilities],
  }
  return { profile, context: ResolvedContextSchema.parse(context) }
}

export function createPolicyService() {
  return Object.freeze({
    resolve: resolvePolicyContext,
    resolveAgent: resolveAgentPolicy,
    resolveMemory: resolveMemoryPolicy,
    resolveWorkflow: resolveWorkflowPolicy,
    resolveProject: resolveProjectPolicy,
    resolveAll: resolveProjectPolicies,
  })
}

export function registerPolicyService(ctx) {
  if (!ctx || typeof ctx.provide !== 'function') return undefined
  return ctx.provide('xiaobaiPolicy', createPolicyService())
}
