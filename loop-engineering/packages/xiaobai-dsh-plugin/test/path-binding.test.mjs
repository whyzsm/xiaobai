import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  ERROR_CODES,
  bootstrapProjectBaseline,
  resolveRepositoryBinding,
  validateRepositoryBinding,
} from '../lib/index.js'

test('resolves a repository below the Host Workspace boundary', async () => {
  const workspace = await mkdtemp(join('/tmp', 'xiaobai-binding-'))
  try {
    const project = bootstrapProjectBaseline({ key: 'project-a', owner: 'owner-a', repository: { name: 'project-a', root: 'repos/project-a' } })
    await mkdir(join(workspace, 'repos/project-a'), { recursive: true })
    const resolved = await resolveRepositoryBinding({ project, repositoryId: project.repositories[0].repoId, workspacePath: workspace })
    assert.equal(resolved.realpath, await realpath(join(workspace, 'repos/project-a')))
    assert.equal(resolved.logicalPath, 'repos/project-a')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('rejects a symlinked repository that escapes the approved Workspace root', async () => {
  const workspace = await mkdtemp(join('/tmp', 'xiaobai-binding-'))
  const outside = await mkdtemp(join('/tmp', 'xiaobai-outside-'))
  try {
    const project = bootstrapProjectBaseline({ key: 'project-a', owner: 'owner-a', repository: { name: 'project-a', root: 'repos/project-a' } })
    await mkdir(join(workspace, 'repos'), { recursive: true })
    await symlink(outside, join(workspace, 'repos/project-a'))
    await assert.rejects(
      () => resolveRepositoryBinding({ project, repositoryId: project.repositories[0].repoId, workspacePath: workspace }),
      (error) => error.code === ERROR_CODES.PATH_ESCAPE,
    )
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('requires repository ownership and classification to match the Project baseline', () => {
  assert.throws(
    () => validateRepositoryBinding({ repoId: 'repo_project_a', name: 'project-a', root: 'repos/project-a', pathTemplate: 'repos/project-a', source: 'local', readOnly: false, owner: 'other-owner', classification: 'internal', worktrees: [] }, { owner: 'owner-a', classification: 'internal' }),
    /owner does not match/,
  )
  assert.throws(
    () => validateRepositoryBinding({ repoId: 'repo_project_a', name: 'project-a', root: 'repos/project-a', pathTemplate: 'repos/project-a', source: 'local', readOnly: false, owner: 'owner-a', classification: 'public', worktrees: [] }, { owner: 'owner-a', classification: 'confidential' }),
    /classification cannot be less restrictive/,
  )
})
