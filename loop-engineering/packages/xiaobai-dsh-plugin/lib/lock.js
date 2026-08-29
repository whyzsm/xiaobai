import { lstat, mkdir, writeFile, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CONTRACT_VERSION, ERROR_CODES, HOST_SUPPORT } from './constants.js'
import { cloneCanonical, sha256Digest, stableStringify } from './canonical.js'
import { validateContract } from './contracts.js'
import { XiaobaiError } from './errors.js'

function pathInside(root, candidate) {
  const rootPath = resolve(root)
  const candidatePath = resolve(candidate)
  const relation = relative(rootPath, candidatePath)
  if (relation === '' || (!relation.startsWith('..') && !relation.startsWith(`${requireSeparator()}`))) return candidatePath
  throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, `Path '${candidate}' escapes approved root '${root}'`, { phase: 'path-boundary', expected: rootPath, actual: candidatePath, remediation: 'Use a path inside the project artifact root.' })
}

function requireSeparator() {
  return process.platform === 'win32' ? '\\' : '/'
}

async function rejectSymlink(target) {
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, `Path '${target}' is a symbolic link`, { phase: 'path-boundary', actual: target, remediation: 'Use a canonical artifact root without symbolic-link components.' })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

export function assertPathWithin(root, candidate) {
  return pathInside(root, candidate)
}

export function buildRunLock(input) {
  const runId = input.runId ?? `run_${randomUUID().replaceAll('-', '')}`
  const lock = {
    schemaVersion: CONTRACT_VERSION,
    runId,
    host: input.host ?? HOST_SUPPORT,
    workspaceId: input.workspaceId,
    projectId: input.project.projectId,
    scopeKey: input.scopeKey,
    knowledge: input.knowledge,
    repositoryBindingDigest: input.repositoryBindingDigest ?? sha256Digest(input.project.repositories),
    agentPolicyDigest: input.agentPolicyDigest,
    skillRevision: input.skillRevision,
    workflowScriptDigest: input.workflowScriptDigest,
    policyDigest: input.policyDigest,
    memoryNamespaceId: input.memoryNamespaceId ?? input.project.memory.namespaceId,
    artifactRoot: input.artifactRoot ?? input.project.artifactRoot,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
  return validateContract('runLock', lock)
}

export function validateLock(lock, current) {
  const normalized = validateContract('runLock', lock)
  const checks = [
    ['workspaceId', normalized.workspaceId, current.workspaceId],
    ['projectId', normalized.projectId, current.projectId],
    ['scopeKey', normalized.scopeKey, current.scopeKey],
    ['repositoryBindingDigest', normalized.repositoryBindingDigest, current.repositoryBindingDigest],
    ['agentPolicyDigest', normalized.agentPolicyDigest, current.agentPolicyDigest],
    ['skillRevision', normalized.skillRevision, current.skillRevision],
    ['workflowScriptDigest', normalized.workflowScriptDigest, current.workflowScriptDigest],
    ['policyDigest', normalized.policyDigest, current.policyDigest],
    ['memoryNamespaceId', normalized.memoryNamespaceId, current.memoryNamespaceId],
  ]
  for (const [field, expected, actual] of checks) if (actual !== undefined && stableStringify(expected) !== stableStringify(actual)) throw new XiaobaiError(ERROR_CODES.LOCK_DRIFT, `Run lock drifted at '${field}'`, { resourceId: normalized.runId, phase: 'lock-validation', expected, actual, remediation: 'Discard the stale run and create a new lock.' })
  if (current.knowledgeDigest !== undefined && !normalized.knowledge.some((item) => item.digest === current.knowledgeDigest)) throw new XiaobaiError(ERROR_CODES.LOCK_DRIFT, 'Run lock Knowledge digest drifted', { resourceId: normalized.runId, phase: 'lock-validation', expected: normalized.knowledge, actual: current.knowledgeDigest, remediation: 'Refresh Knowledge lock before execution.' })
  return true
}

export async function persistLock(lock, artifactRoot, options = {}) {
  const normalized = validateContract('runLock', lock)
  if (!isAbsolute(artifactRoot)) throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, 'Artifact root must be absolute', { phase: 'path-boundary', actual: artifactRoot, remediation: 'Resolve the artifact root below the canonical Host Workspace before persisting.' })
  await rejectSymlink(artifactRoot)
  await mkdir(artifactRoot, { recursive: true })
  const artifactRealpath = await realpath(artifactRoot)
  if (options.approvedRoot !== undefined) {
    if (!isAbsolute(options.approvedRoot)) throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, 'Approved artifact root must be absolute', { phase: 'path-boundary', actual: options.approvedRoot })
    const approvedRealpath = await realpath(options.approvedRoot)
    pathInside(approvedRealpath, artifactRealpath)
  }
  const runsPath = pathInside(artifactRealpath, resolve(artifactRealpath, 'runs'))
  await rejectSymlink(runsPath)
  await mkdir(runsPath, { recursive: true })
  const runsRealpath = await realpath(runsPath)
  pathInside(artifactRealpath, runsRealpath)
  const runPath = pathInside(artifactRealpath, resolve(runsRealpath, normalized.runId))
  await rejectSymlink(runPath)
  await mkdir(runPath, { recursive: true })
  const runRealpath = await realpath(runPath)
  pathInside(artifactRealpath, runRealpath)
  const target = pathInside(artifactRealpath, resolve(runRealpath, 'lock.json'))
  await writeFile(target, `${stableStringify(normalized)}\n`, { encoding: 'utf8', flag: 'wx' })
  return target
}

export async function readLock(lockPath, artifactRoot) {
  if (!isAbsolute(artifactRoot)) throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, 'Artifact root must be absolute', { phase: 'path-boundary', actual: artifactRoot, remediation: 'Resolve the artifact root below the canonical Host Workspace before reading.' })
  await rejectSymlink(artifactRoot)
  const artifactRealpath = await realpath(artifactRoot)
  const target = pathInside(artifactRealpath, await realpath(resolve(artifactRealpath, lockPath)))
  return validateContract('runLock', JSON.parse(await readFile(target, 'utf8')))
}

export function lockDigest(lock) {
  return sha256Digest(validateContract('runLock', lock))
}
