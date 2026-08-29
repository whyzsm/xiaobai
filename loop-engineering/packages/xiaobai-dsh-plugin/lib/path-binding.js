import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { ERROR_CODES, ID_PATTERNS } from './constants.js'
import { cloneCanonical } from './canonical.js'
import { contractError, XiaobaiError } from './errors.js'

const CLASSIFICATION_LEVEL = Object.freeze({ public: 0, internal: 1, confidential: 2, restricted: 3 })

function pathInside(root, target) {
  const relativePath = relative(root, target)
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

function pathFailure(message, details = {}) {
  return new XiaobaiError(ERROR_CODES.PATH_ESCAPE, message, {
    phase: 'repository-path-binding',
    remediation: 'Use an approved local path binding whose realpath stays inside its approved root.',
    ...details,
  })
}

function validateRelativeTemplate(value, field) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value) || value.includes('\0')) throw contractError(`${field} must be a non-absolute path template`)
  if (value.split(/[\\/]+/).includes('..')) throw contractError(`${field} cannot contain a parent traversal segment`)
  for (const token of value.match(/\{[^}]+\}/g) ?? []) if (!['{projectKey}', '{repoId}', '{worktreeId}'].includes(token)) throw contractError(`${field} contains an unsupported template token '${token}'`)
  return value
}

function expandTemplate(template, values) {
  return template.replace(/\{(projectKey|repoId|worktreeId)\}/g, (_match, key) => values[key] ?? '')
}

function assertId(value, field, prefix) {
  if (typeof value !== 'string' || !ID_PATTERNS.resource.test(value) || !value.startsWith(`${prefix}_`)) throw contractError(`${field} must use the ${prefix}_ resource id prefix`)
}

export function validateRepositoryBinding(binding, project = {}) {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) throw contractError('repository binding must be an object')
  assertId(binding.repoId, 'repository.repoId', 'repo')
  if (typeof binding.name !== 'string' || binding.name.length === 0) throw contractError('repository.name must be non-blank')
  if (!['local', 'remote', 'mount'].includes(binding.source)) throw contractError('repository.source is unsupported')
  validateRelativeTemplate(binding.root, 'repository.root')
  validateRelativeTemplate(binding.pathTemplate ?? binding.root, 'repository.pathTemplate')
  if (typeof binding.readOnly !== 'boolean') throw contractError('repository.readOnly must be boolean')
  if (typeof binding.owner !== 'string' || binding.owner.length === 0) throw contractError('repository.owner must be non-blank')
  if (binding.owner !== project.owner) throw contractError(`repository '${binding.repoId}' owner does not match Project owner`)
  const projectLevel = CLASSIFICATION_LEVEL[project.classification]
  const repositoryLevel = CLASSIFICATION_LEVEL[binding.classification]
  if (binding.classification === undefined || repositoryLevel === undefined) throw contractError('repository.classification is required and unsupported values are rejected')
  if (projectLevel !== undefined && repositoryLevel !== undefined && repositoryLevel < projectLevel) throw contractError(`repository '${binding.repoId}' classification cannot be less restrictive than its Project`)
  if (binding.worktrees !== undefined) {
    if (!Array.isArray(binding.worktrees)) throw contractError('repository.worktrees must be an array')
    for (const worktree of binding.worktrees) {
      assertId(worktree.worktreeId, 'worktree.worktreeId', 'worktree')
      validateRelativeTemplate(worktree.root, 'worktree.root')
      validateRelativeTemplate(worktree.pathTemplate ?? worktree.root, 'worktree.pathTemplate')
      if (typeof worktree.readOnly !== 'boolean') throw contractError('worktree.readOnly must be boolean')
      if (worktree.owner !== undefined && worktree.owner !== project.owner) throw contractError(`worktree '${worktree.worktreeId}' owner does not match Project owner`)
      if (worktree.classification !== undefined && CLASSIFICATION_LEVEL[worktree.classification] === undefined) throw contractError('worktree.classification is unsupported')
    }
  }
  return cloneCanonical(binding)
}

export function assertApprovedPath(target, approvedRoots, details = {}) {
  if (!Array.isArray(approvedRoots) || approvedRoots.length === 0 || !approvedRoots.every((root) => typeof root === 'string' && isAbsolute(root))) throw pathFailure('At least one absolute approved root is required', details)
  if (!approvedRoots.some((root) => pathInside(root, target))) throw pathFailure(`Resolved path '${target}' escapes all approved roots`, { actual: target, expected: approvedRoots, ...details })
  return target
}

export async function resolveRepositoryBinding({ project, repositoryId, workspacePath, localBindings = {}, worktreeId }) {
  if (!project?.projectId || !Array.isArray(project.repositories)) throw new XiaobaiError(ERROR_CODES.SCOPE_REQUIRED, 'Repository resolution requires a validated Project baseline', { phase: 'repository-resolution' })
  const repository = project.repositories.find((candidate) => candidate.repoId === repositoryId)
  if (!repository) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, `Repository '${repositoryId}' is not bound to Project '${project.projectId}'`, { resourceId: repositoryId, phase: 'repository-resolution' })
  const normalized = validateRepositoryBinding(repository, project)
  const worktree = worktreeId === undefined ? undefined : normalized.worktrees?.find((candidate) => candidate.worktreeId === worktreeId)
  if (worktreeId !== undefined && !worktree) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, `Worktree '${worktreeId}' is not bound to Repository '${repositoryId}'`, { resourceId: worktreeId, phase: 'worktree-resolution' })
  if (!workspacePath || typeof workspacePath !== 'string' || !isAbsolute(workspacePath)) throw pathFailure('Host Workspace path must be absolute', { actual: workspacePath, resourceId: repositoryId })
  let workspaceRealpath
  try {
    workspaceRealpath = await realpath(workspacePath)
  } catch (error) {
    throw pathFailure(`Host Workspace path '${workspacePath}' cannot be resolved`, { actual: workspacePath, resourceId: repositoryId, cause: error })
  }
  const local = localBindings[repositoryId]
  const binding = typeof local === 'string' ? { path: local } : local
  if (!binding && normalized.source !== 'local') throw pathFailure(`Repository '${repositoryId}' requires an explicit local path binding`, { resourceId: repositoryId })
  const template = worktree?.pathTemplate ?? worktree?.root ?? normalized.pathTemplate ?? normalized.root
  const logicalPath = expandTemplate(template, { projectKey: project.key, repoId: normalized.repoId, worktreeId: worktree?.worktreeId })
  const candidate = binding?.path ?? resolve(workspaceRealpath, logicalPath)
  if (!isAbsolute(candidate)) throw pathFailure('Resolved repository path must be absolute', { actual: candidate, resourceId: repositoryId })
  const approvedRoots = binding?.approvedRoots ?? [workspaceRealpath]
  let target
  try {
    target = await realpath(candidate)
  } catch (error) {
    throw pathFailure(`Repository path '${candidate}' cannot be resolved`, { actual: candidate, resourceId: repositoryId, cause: error })
  }
  const realRoots = []
  for (const root of approvedRoots) {
    if (!isAbsolute(root)) throw pathFailure(`Approved root '${root}' must be absolute`, { actual: root, resourceId: repositoryId })
    try { realRoots.push(await realpath(root)) } catch (error) { throw pathFailure(`Approved root '${root}' cannot be resolved`, { actual: root, resourceId: repositoryId, cause: error }) }
  }
  assertApprovedPath(target, realRoots, { resourceId: repositoryId, expected: realRoots })
  return { projectId: project.projectId, repository: normalized, worktree, logicalPath, realpath: target, approvedRoots: realRoots }
}
