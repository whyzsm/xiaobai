import { ERROR_CODES, ID_PATTERNS, PACKAGE_NAME } from './constants.js'
import { sha256Digest } from './canonical.js'
import { validateContract } from './contracts.js'
import { XiaobaiError } from './errors.js'
import { getHostService } from './host.js'

export function registerSkillProvider(ctx, skillPackage, options = {}) {
  const skill = validateContract('skillPackage', skillPackage)
  const service = getHostService(ctx, 'skills')
  if (!service || typeof service.registerProvider !== 'function') throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Host skills.registerProvider is unavailable', { phase: 'skill-registration' })
  if (!ID_PATTERNS.key.test(skill.name)) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, `Skill '${skill.name}' is not lowercase kebab-case`, { resourceId: skill.skillId, phase: 'skill-registration' })
  const definition = options.content ?? `# ${skill.name}\n\n${skill.purpose}`
  return service.registerProvider(() => ({
    name: `xiaobai-${skill.name}`,
    list: async () => [{ name: skill.name, description: skill.purpose, invocation: skill.invocation, source: 'custom', provider: `xiaobai-${skill.name}`, rank: 500, locator: skill.skillId }],
    get: async (candidate, resolutionOptions = {}) => {
      if (!candidate || typeof candidate !== 'object' || candidate.locator !== skill.skillId) return undefined
      if (resolutionOptions.invoker !== undefined) authorizeSkillInvocation(skill, resolutionOptions)
      return {
        ...candidate,
        content: definition,
        metadata: {
          skillId: skill.skillId,
          version: skill.version,
          source: PACKAGE_NAME,
          revision: skill.version,
          digest: sha256Digest(skill),
          trust: skill.trust,
          scope: resolutionOptions.projectId ?? options.projectId,
          requiredCapabilities: [...skill.capabilities],
        },
      }
    },
  }))
}

export function authorizeSkillInvocation(skillPackage, options = {}) {
  const skill = validateContract('skillPackage', skillPackage)
  const invoker = options.invoker ?? 'user'
  const allowed = invoker === 'model' ? skill.invocation.modelInvocable : invoker === 'user' ? skill.invocation.userInvocable : false
  if (!allowed) throw new XiaobaiError(ERROR_CODES.CAPABILITY_DENIED, `Skill '${skill.name}' is not invocable by '${invoker}'`, { resourceId: skill.skillId, phase: 'skill-authorization', expected: skill.invocation, actual: invoker, remediation: 'Use an authorized invocation path declared by the Skill Package.' })
  const available = new Set(options.capabilities ?? [])
  const missing = skill.capabilities.filter((capability) => !available.has(capability))
  if (missing.length > 0) throw new XiaobaiError(ERROR_CODES.CAPABILITY_DENIED, `Skill '${skill.name}' requires unavailable capabilities`, { resourceId: skill.skillId, phase: 'skill-authorization', expected: skill.capabilities, actual: [...available], remediation: 'Add the required Host capability to the Project policy or choose another Skill.' })
  return { skillId: skill.skillId, source: PACKAGE_NAME, revision: skill.version, digest: sha256Digest(skill), scope: options.projectId, trust: skill.trust, requiredCapabilities: [...skill.capabilities] }
}

export function resolveSkillContext(skillPackage, options = {}) {
  const context = authorizeSkillInvocation(skillPackage, { ...options, invoker: options.invoker ?? 'user' })
  if (!context.scope) throw new XiaobaiError(ERROR_CODES.SCOPE_REQUIRED, 'Skill context resolution requires an explicit Project scope', { resourceId: context.skillId, phase: 'skill-context', remediation: 'Resolve the Skill from a Project-scoped Host context.' })
  return context
}
