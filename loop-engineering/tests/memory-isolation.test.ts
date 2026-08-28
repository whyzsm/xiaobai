import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { loadMemoryContext } from '../packages/memory-context/src';
import { searchMemory } from '../packages/memory-search/src';
import { MemoryIndex, NoteEntry } from '../packages/memory-protocol/src';

function note(
  root: string,
  projectId: string,
  id: string,
  title: string
): NoteEntry {
  return {
    id,
    kind: 'case',
    projectId,
    loopId: 'frontend-delivery',
    title,
    path: path.join(root, `${id}.md`),
    vaultRelativePath: `88-学习/10-项目记忆/${projectId}/cases/${id}.md`,
    obsidianLink: `[[${id}|${title}]]`,
    tags: [`project/${projectId}`, 'type/case'],
    status: 'draft',
    type: 'case',
    domain: ['ai-engineering'],
    source: 'local',
    access: 'private',
    confidence: 'medium',
    summary: 'shared memory isolation evidence',
    headings: [title],
    links: [],
    keywords: ['shared', 'memory', 'isolation'],
    mtimeMs: Date.now(),
    sizeBytes: 32,
    contentHash: `${projectId}-${id}`
  };
}

function index(notes: NoteEntry[]): MemoryIndex {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-28T00:00:00.000Z',
    learningRoot: '88-学习',
    globalIndexRoot: '88-学习/00-记忆索引',
    projectRoot: '88-学习/10-项目记忆',
    projects: [],
    notes,
    cases: notes,
    patterns: [],
    tags: [],
    links: [],
    warnings: []
  };
}

test('memory search requires projectId and never returns another project', () => {
  const notes = [
    note('/tmp/t-max', 't-max', 't-max-case', 'T-MAX shared case'),
    note('/tmp/app-a', 'app-a', 'app-a-case', 'App A shared case')
  ];

  assert.throws(
    () => searchMemory(index(notes), { query: 'shared', projectId: '' }),
    /requires projectId/
  );

  const matches = searchMemory(index(notes), {
    query: 'shared',
    projectId: 't-max'
  });
  assert.deepEqual(matches.map((match) => match.note.projectId), ['t-max']);
});

test('memory context does not inject cross-project cases or patterns', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'memory-isolation-'));
  const own = note(root, 't-max', 't-max-case', 'T-MAX shared case');
  const foreign = note(root, 'app-a', 'app-a-case', 'App A shared case');
  await writeFile(own.path, '# T-MAX shared case\n\nOwn project memory.\n', 'utf8');
  await writeFile(foreign.path, '# App A shared case\n\nForeign project memory.\n', 'utf8');

  const bundle = await loadMemoryContext({
    index: index([own, foreign]),
    projectId: 't-max',
    loopId: 'frontend-delivery',
    query: 'shared',
    maxCharacters: 4_000
  });

  assert.deepEqual(bundle.included.map((item) => item.path), [own.path]);
  assert.doesNotMatch(bundle.content, /Foreign project memory/);
});
