import { ERROR_CODES } from './constants.js'
import { XiaobaiError } from './errors.js'
import { redactLoadedWorkspace, redactWorkspaceDiagnostics } from './workspace.js'
import { resolveWorkspaceProject } from './project-target.js'

export const PROJECT_COMMAND_NAMES = Object.freeze(['project-bootstrap', 'project-assess', 'project-run'])
export const WORKSPACE_COMMAND_NAMES = Object.freeze(['project-load', 'project-list', 'loop-list', 'loop-assess', 'loop-plan', 'loop-run'])
export const CONFIG_COMMAND_NAMES = Object.freeze(['workspace-config-list', 'workspace-config-get', 'workspace-config-create-draft', 'workspace-config-validate', 'workspace-config-preview', 'workspace-config-pick-directory', 'workspace-config-request-approval', 'workspace-config-apply', 'workspace-config-history', 'workspace-config-rollback'])
export const COMMAND_NAMES = Object.freeze([...PROJECT_COMMAND_NAMES, ...WORKSPACE_COMMAND_NAMES, ...CONFIG_COMMAND_NAMES])

function parseObject(rawInput, commandName) {
  const text = rawInput.trim()
  if (text.length === 0) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, `${commandName} requires a JSON object`, { phase: 'command-input' })
  let value
  try { value = JSON.parse(text) } catch (error) { throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, `${commandName} input is not valid JSON`, { phase: 'command-input', cause: error }) }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, `${commandName} input must be a JSON object`, { phase: 'command-input' })
  return value
}

function success(value) {
  return { kind: 'success', text: JSON.stringify({ schemaVersion: 'xiaobai.command/v1', ok: true, value }) }
}

function redactMessage(value) {
  return String(value ?? 'Command failed')
    .replaceAll(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
    .replaceAll(/(^|[\s'"(])\/(?!\/)[^\s'"),]*/g, '$1[redacted-path]')
}

function failure(error) {
  const details = typeof error?.toJSON === 'function' ? error.toJSON() : {}
  return {
    kind: 'error',
    text: JSON.stringify({
      schemaVersion: 'xiaobai.command/v1',
      ok: false,
      error: {
        code: details.code ?? error?.code ?? ERROR_CODES.CONTRACT_INVALID,
        message: redactMessage(details.message ?? error?.message),
        contractVersion: details.contractVersion,
        ...(details.resourceId ? { resourceId: details.resourceId } : {}),
        ...(details.phase ? { phase: details.phase } : {}),
        ...(details.remediation ? { remediation: redactMessage(details.remediation) } : {}),
        ...(details.evidenceRef ? { evidenceRef: details.evidenceRef } : {}),
      },
    }),
  }
}

function configResult(result) {
  const ok = result?.status === 'ok'
  return {
    kind: ok ? 'success' : 'error',
    text: JSON.stringify({
      schemaVersion: 'xiaobai.command/v1',
      ok,
      value: result,
    }),
  }
}

async function invoke(operation) {
  try {
    return success(await operation())
  } catch (error) {
    if (error instanceof XiaobaiError) return failure(error)
    throw error
  }
}

function bootstrapInput(input) {
  const { workspacePath, workspaceTitle, baseline, ...inlineBaseline } = input
  return { baseline: baseline ?? inlineBaseline, workspacePath, workspaceTitle }
}

function workspaceRoot(input, commandName) {
  const root = input.workspaceRoot ?? input.workspacePath
  if (typeof root !== 'string' || root.length === 0) throw new XiaobaiError(ERROR_CODES.WORKSPACE_REQUIRED, `${commandName} requires an explicit workspaceRoot`, { phase: 'command-input' })
  return root
}

function resolveCommandProject(workspace, target, phase) {
  // A Host adapter may expose an explicit Workspace before it can enumerate
  // Projects. Preserve that adapter contract; a loaded project catalog still
  // always goes through the canonical child resolver.
  if ((workspace?.projects?.length ?? 0) === 0
    && (workspace?.projectGroups?.length ?? 0) === 0
    && typeof target === 'string'
    && target.length > 0) {
    return { projectId: target }
  }
  return resolveWorkspaceProject(workspace, target, { phase })
}

async function ensureWorkspace(input, commandName, workspaceService, loopService) {
  const root = workspaceRoot(input, commandName)
  const current = workspaceService.current
  const loaded = current?.workspaceRoot === root || current?.workspaceRoot === undefined
    ? current ?? await workspaceService.load({ workspaceRoot: root, workspaceTitle: input.workspaceTitle })
    : await workspaceService.load({ workspaceRoot: root, workspaceTitle: input.workspaceTitle })
  if (loopService) {
    if (!loopService.current || loopService.current.workspaceRoot !== loaded.workspaceRoot) await loopService.load(loaded.workspaceRoot, loaded)
  }
  return loaded
}

export function registerProjectCommands(ctx, projectService, workspaceService, loopService, configService) {
  if (!ctx?.commands || typeof ctx.commands.register !== 'function') throw new Error('dsh commands service is unavailable')
  const disposers = []
  try {
    disposers.push(ctx.commands.register({
      name: 'project-bootstrap',
      description: 'Create and register a validated Xiaobai Project baseline.',
      input: { hint: '{"key":"project-key","owner":"team"}' },
      handler: async (invocation) => {
        const input = bootstrapInput(parseObject(invocation.rawInput, 'project-bootstrap'))
        return invoke(() => projectService.bootstrapBaseline(input.baseline, { workspacePath: input.workspacePath, workspaceTitle: input.workspaceTitle }))
      },
    }))
    disposers.push(ctx.commands.register({
      name: 'project-assess',
      description: 'Assess a Xiaobai Project baseline and return missing fields and blockers.',
      input: { hint: '{"schemaVersion":"xiaobai.contracts/v1",...}' },
      handler: async (invocation) => {
        const input = parseObject(invocation.rawInput, 'project-assess')
        if (workspaceService && (input.workspaceRoot || input.workspacePath)) {
          return invoke(async () => {
            await ensureWorkspace(input, 'project-assess', workspaceService, loopService)
            const resolved = resolveCommandProject(workspaceService.current, input.projectId, 'project-assessment')
            const assessment = workspaceService.assessProject({ projectId: resolved.projectId })
            return {
              ...assessment,
              diagnostics: redactWorkspaceDiagnostics(assessment?.diagnostics, workspaceService.current?.workspaceRoot),
            }
          })
        }
        return invoke(() => projectService.assessBaseline(input))
      },
    }))
    disposers.push(ctx.commands.register({
      name: 'project-run',
      description: 'Run a Xiaobai Project stage inside the current Host Agent turn.',
      input: { hint: '{"workspacePath":"/absolute/path","projectId":"prj_..."}' },
      handler: async (invocation) => {
        const input = parseObject(invocation.rawInput, 'project-run')
        return invoke(async () => {
          if (workspaceService && (input.workspaceRoot || input.workspacePath)) {
            await ensureWorkspace(input, 'project-run', workspaceService, loopService)
            const resolved = resolveCommandProject(workspaceService.current, input.projectId ?? input.targetProject, 'project-run')
            return projectService.run({ ...input, projectId: resolved.projectId, workspacePath: workspaceService.current.workspaceRoot, agent: invocation.agent })
          }
          return projectService.run({ ...input, agent: invocation.agent })
        })
      },
    }))
    if (workspaceService) {
      disposers.push(ctx.commands.register({
        name: 'project-load',
        description: 'Load one Host Workspace and its Project baselines from explicit configuration.',
          input: { hint: '{"workspaceRoot":"/absolute/path/to/workspace"}' },
          handler: async (invocation) => {
            const input = parseObject(invocation.rawInput, 'project-load')
            return invoke(async () => redactLoadedWorkspace(await ensureWorkspace(input, 'project-load', workspaceService, loopService)))
          },
      }))
      disposers.push(ctx.commands.register({
        name: 'project-list',
        description: 'List Projects in the explicitly loaded Host Workspace.',
          input: { hint: '{"workspaceRoot":"/absolute/path/to/workspace"}' },
          handler: async (invocation) => {
            const input = parseObject(invocation.rawInput, 'project-list')
            return invoke(async () => redactLoadedWorkspace(await ensureWorkspace(input, 'project-list', workspaceService, loopService)))
          },
      }))
      disposers.push(ctx.commands.register({
        name: 'loop-list',
        description: 'List the read-only Loop catalog for the explicit Workspace.',
          input: { hint: '{"workspaceRoot":"/absolute/path/to/workspace","projectId":"t-max"}' },
          handler: async (invocation) => {
            const input = parseObject(invocation.rawInput, 'loop-list')
            return invoke(async () => {
              await ensureWorkspace(input, 'loop-list', workspaceService, loopService)
              return loopService.list(input)
            })
          },
      }))
      disposers.push(ctx.commands.register({
        name: 'loop-assess',
        description: 'Assess one Loop contract without executing it.',
          input: { hint: '{"workspaceRoot":"/absolute/path/to/workspace","loopId":"morning-triage"}' },
          handler: async (invocation) => {
            const input = parseObject(invocation.rawInput, 'loop-assess')
            return invoke(async () => {
              await ensureWorkspace(input, 'loop-assess', workspaceService, loopService)
              return loopService.assess(input)
            })
          },
      }))
      disposers.push(ctx.commands.register({
        name: 'loop-plan',
        description: 'Create a planning-only Loop execution plan.',
          input: { hint: '{"workspaceRoot":"/absolute/path/to/workspace","loopId":"morning-triage"}' },
          handler: async (invocation) => {
            const input = parseObject(invocation.rawInput, 'loop-plan')
            return invoke(async () => {
              await ensureWorkspace(input, 'loop-plan', workspaceService, loopService)
              return loopService.plan(input)
            })
          },
      }))
      disposers.push(ctx.commands.register({
        name: 'loop-run',
        description: 'Run a Loop only through a verified Host execution bridge.',
          input: { hint: '{"workspaceRoot":"/absolute/path/to/workspace","loopId":"morning-triage","projectId":"prj_..."}' },
          handler: async (invocation) => {
            const input = parseObject(invocation.rawInput, 'loop-run')
            return invoke(async () => {
              await ensureWorkspace(input, 'loop-run', workspaceService, loopService)
              return loopService.run({ ...input, agent: invocation.agent })
            })
          },
      }))
    }
    if (configService) {
      const registerConfig = (name, description, operation, enrich = (input) => input) => {
        disposers.push(ctx.commands.register({
          name,
          description,
          input: { hint: '{"workspaceId":"ws_...","projectId":"prj_..."}' },
          handler: async (invocation) => {
            const input = parseObject(invocation.rawInput, name)
            const result = await operation(enrich(input, invocation))
            return configResult(result)
          },
        }))
      }
      registerConfig('workspace-config-list', 'List redacted Project configuration metadata for the loaded Workspace.', (input) => configService.list(input))
      registerConfig('workspace-config-get', 'Read one redacted Project configuration snapshot.', (input) => configService.get(input))
      registerConfig('workspace-config-create-draft', 'Create a persisted Project configuration draft.', (input) => configService.createDraft(input))
      registerConfig('workspace-config-validate', 'Validate one Project configuration draft.', (input) => configService.validate(input))
      registerConfig('workspace-config-preview', 'Preview the files and risks for one Project configuration draft.', (input) => configService.preview(input))
      registerConfig('workspace-config-pick-directory', 'Pick a Host directory and return a redacted binding reference.', (input) => configService.pickDirectory(input))
      registerConfig('workspace-config-request-approval', 'Request a Host approval pair for one Project configuration draft.', (input, invocation) => configService.requestApproval({ ...input, agent: invocation.agent }))
      registerConfig('workspace-config-apply', 'Apply an approved Project configuration draft atomically.', (input, invocation) => configService.apply({ ...input, agent: invocation.agent }))
      registerConfig('workspace-config-history', 'List recorded Project configuration revisions.', (input) => configService.history(input))
      registerConfig('workspace-config-rollback', 'Restore a recorded Project configuration revision after approval.', (input, invocation) => configService.rollback({ ...input, agent: invocation.agent }))
    }
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
