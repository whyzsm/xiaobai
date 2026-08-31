import { ERROR_CODES, ID_PATTERNS } from './constants.js'
import { XiaobaiError } from './errors.js'

function projectIdOf(entry) {
  return entry?.baseline?.projectId ?? entry?.projectId
}

function projectAliases(entry) {
  return [
    projectIdOf(entry),
    entry?.sourceProjectId,
    entry?.baseline?.key,
    entry?.baseline?.displayName,
    entry?.displayName,
  ].filter((value) => typeof value === 'string' && value.length > 0)
}

function groupAliases(group) {
  return [group?.id, group?.name].filter((value) => typeof value === 'string' && value.length > 0)
}

function sameAlias(left, right) {
  return String(left ?? '').trim().toLowerCase().replaceAll(/[^a-z0-9]/g, '')
    === String(right ?? '').trim().toLowerCase().replaceAll(/[^a-z0-9]/g, '')
}

function candidates(workspace, target) {
  return (workspace?.projects ?? []).filter((entry) => projectAliases(entry).some((alias) => sameAlias(alias, target)))
}

function groupCandidates(workspace, target) {
  return (workspace?.projectGroups ?? []).filter((group) => groupAliases(group).some((alias) => sameAlias(alias, target)))
}

export function resolveWorkspaceProject(workspace, target, options = {}) {
  const phase = options.phase ?? 'project-resolution'
  if (!workspace) throw new XiaobaiError(ERROR_CODES.WORKSPACE_REQUIRED, 'Load an explicit Workspace before resolving a Project target', { phase })
  if (typeof target !== 'string' || target.trim().length === 0) {
    throw new XiaobaiError(ERROR_CODES.PROJECT_NOT_FOUND, 'A concrete Project target is required', { phase, remediation: 'Choose one child Project from the loaded Workspace.' })
  }

  const groups = groupCandidates(workspace, target)
  if (groups.length > 0) {
    const childIds = [...new Set(groups.flatMap((group) => Array.isArray(group.childProjectIds) ? group.childProjectIds : []))].sort()
    if (childIds.length > 0) {
      throw new XiaobaiError(
        ERROR_CODES.PROJECT_GROUP_TARGET,
        `ProjectGroup '${target}' cannot be used as an execution target. Choose a child Project: ${childIds.join(', ')}`,
        { phase, remediation: `Choose one child Project: ${childIds.join(', ')}` }
      )
    }
  }

  const matches = candidates(workspace, target)
  if (matches.length === 0) throw new XiaobaiError(ERROR_CODES.PROJECT_NOT_FOUND, `Project '${target}' is not registered in this Workspace`, { phase, resourceId: ID_PATTERNS.resource.test(target) ? target : undefined })
  if (matches.length > 1) {
    const ids = matches.map(projectIdOf).filter(Boolean).sort().join(', ')
    throw new XiaobaiError(ERROR_CODES.CONFIG_CONFLICT, `Project target '${target}' is ambiguous. Candidates: ${ids}`, { phase, remediation: `Choose one concrete Project: ${ids}` })
  }
  const entry = matches[0]
  return {
    entry,
    projectId: projectIdOf(entry),
    sourceProjectId: entry.sourceProjectId ?? entry.baseline?.key,
    parentGroupId: entry.parentGroupId,
  }
}

export function resolveLoopProject(workspace, loop, input = {}, phase = 'loop-resolution') {
  const target = input.projectId ?? input.targetProject ?? loop?.targetProjectId
  return resolveWorkspaceProject(workspace, target, { phase })
}

export function loopTargetsProject(workspace, loop, project) {
  const target = loop?.targetProjectId
  if (!target) return true
  if (projectAliases(project).some((alias) => sameAlias(alias, target))) return true
  const parentGroupId = project?.parentGroupId
  return (workspace?.projectGroups ?? []).some((group) =>
    groupAliases(group).some((alias) => sameAlias(alias, target))
    && (group.id === parentGroupId || group.childProjectIds?.includes(projectIdOf(project)))
  )
}

export function canonicalLoopForProject(workspace, loop, input = {}, phase = 'loop-resolution') {
  const resolved = resolveLoopProject(workspace, loop, input, phase)
  return {
    ...loop,
    targetProjectId: resolved.projectId,
    targetResolution: {
      ...(loop.targetResolution ?? {}),
      project: resolved.projectId,
    },
    projectId: resolved.projectId,
  }
}
