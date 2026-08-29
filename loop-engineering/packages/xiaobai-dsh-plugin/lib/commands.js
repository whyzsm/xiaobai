import { ERROR_CODES } from './constants.js'
import { XiaobaiError } from './errors.js'

export const PROJECT_COMMAND_NAMES = Object.freeze(['project-bootstrap', 'project-assess', 'project-run'])

function parseObject(rawInput, commandName) {
  const text = rawInput.trim()
  if (text.length === 0) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, `${commandName} requires a JSON object`, { phase: 'command-input' })
  let value
  try { value = JSON.parse(text) } catch (error) { throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, `${commandName} input is not valid JSON`, { phase: 'command-input', cause: error }) }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, `${commandName} input must be a JSON object`, { phase: 'command-input' })
  return value
}

function success(value) {
  return { kind: 'success', text: JSON.stringify(value) }
}

function bootstrapInput(input) {
  const { workspacePath, workspaceTitle, baseline, ...inlineBaseline } = input
  return { baseline: baseline ?? inlineBaseline, workspacePath, workspaceTitle }
}

export function registerProjectCommands(ctx, projectService) {
  if (!ctx?.commands || typeof ctx.commands.register !== 'function') throw new Error('dsh commands service is unavailable')
  const disposers = []
  try {
    disposers.push(ctx.commands.register({
      name: 'project-bootstrap',
      description: 'Create and register a validated Xiaobai Project baseline.',
      input: { hint: '{"key":"project-key","owner":"team"}' },
      handler: async (invocation) => {
        const input = bootstrapInput(parseObject(invocation.rawInput, 'project-bootstrap'))
        return success(await projectService.bootstrapBaseline(input.baseline, { workspacePath: input.workspacePath, workspaceTitle: input.workspaceTitle }))
      },
    }))
    disposers.push(ctx.commands.register({
      name: 'project-assess',
      description: 'Assess a Xiaobai Project baseline and return missing fields and blockers.',
      input: { hint: '{"schemaVersion":"xiaobai.contracts/v1",...}' },
      handler: async (invocation) => success(projectService.assessBaseline(parseObject(invocation.rawInput, 'project-assess'))),
    }))
    disposers.push(ctx.commands.register({
      name: 'project-run',
      description: 'Run a Xiaobai Project stage inside the current Host Agent turn.',
      input: { hint: '{"workspacePath":"/absolute/path","projectId":"prj_..."}' },
      handler: async (invocation) => {
        const input = parseObject(invocation.rawInput, 'project-run')
        return success(await projectService.run({ ...input, agent: invocation.agent }))
      },
    }))
    return () => Promise.all(disposers.reverse().map((dispose) => dispose()))
  } catch (error) {
    for (const dispose of disposers.reverse()) {
      try {
        const result = dispose()
        if (result && typeof result.then === 'function') result.catch(() => {})
      } catch {
        // Preserve the original registration error; cleanup is best effort.
      }
    }
    throw error
  }
}
