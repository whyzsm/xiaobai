import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020';

const repoRoot = process.cwd();
const schemaRoot = path.join(repoRoot, 'loop-engineering', 'schemas');

async function loadValidator(schemaFile: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schema = JSON.parse(await readFile(path.join(schemaRoot, schemaFile), 'utf8'));
  return ajv.compile(schema);
}

test('memory index schema validates representative generated index', async () => {
  const validate = await loadValidator('memory-index.schema.json');
  const index = {
    schemaVersion: 1,
    generatedAt: '2026-06-28T00:00:00.000Z',
    vaultRoot: '/tmp/vault',
    learningRoot: '88-学习',
    globalIndexRoot: '88-学习/00-记忆索引',
    projectRoot: '88-学习/10-项目记忆',
    projects: [
      {
        id: 'demo',
        name: 'demo',
        status: 'active',
        memoryRoot: '88-学习/10-项目记忆/demo',
        entry: '88-学习/10-项目记忆/demo/index.md',
        tags: ['loop-engineering'],
        confidence: 'medium'
      }
    ],
    notes: [
      {
        id: 'note-demo-index',
        kind: 'project-index',
        projectId: 'demo',
        title: 'Demo Project',
        path: '/tmp/vault/88-学习/10-项目记忆/demo/index.md',
        vaultRelativePath: '88-学习/10-项目记忆/demo/index.md',
        obsidianLink: '[[88-学习/10-项目记忆/demo/index|Demo Project]]',
        tags: ['type/project-memory'],
        status: 'active',
        type: 'project-memory',
        domain: ['ai-engineering'],
        source: 'local',
        access: 'private',
        confidence: 'medium',
        summary: 'Demo project memory.',
        headings: ['Demo Project'],
        links: ['active-context'],
        keywords: ['demo', 'project'],
        mtimeMs: 1760000000000,
        sizeBytes: 100,
        contentHash: 'abc123'
      }
    ],
    cases: [],
    patterns: [],
    tags: [
      {
        tag: 'type/project-memory',
        count: 1,
        notes: ['note-demo-index']
      }
    ],
    links: [
      {
        from: 'note-demo-index',
        to: 'active-context',
        raw: '[[active-context]]'
      }
    ],
    warnings: []
  };

  assert.equal(validate(index), true, JSON.stringify(validate.errors, null, 2));
});

test('memory index schema rejects notes missing stable fields', async () => {
  const validate = await loadValidator('memory-index.schema.json');
  const invalid = {
    schemaVersion: 1,
    generatedAt: '2026-06-28T00:00:00.000Z',
    learningRoot: '88-学习',
    globalIndexRoot: '88-学习/00-记忆索引',
    projectRoot: '88-学习/10-项目记忆',
    projects: [],
    notes: [
      {
        id: 'broken-note',
        kind: 'unknown',
        title: 'Broken'
      }
    ],
    cases: [],
    patterns: [],
    tags: [],
    links: [],
    warnings: []
  };

  assert.equal(validate(invalid), false);
  assert.match(JSON.stringify(validate.errors), /vaultRelativePath|contentHash|summary/);
});

test('memory note schema accepts human-flexible frontmatter and rejects invalid enums', async () => {
  const validate = await loadValidator('memory-note.schema.json');
  const validCase = {
    id: 'case-1',
    title: 'Useful Case',
    status: 'draft',
    type: 'case',
    project: 'demo',
    loop: 'morning-triage',
    tags: ['status/seed', 'type/case'],
    domain: ['ai-engineering'],
    source: 'local',
    access: 'private',
    confidence: 'medium',
    source_project: 'demo',
    source_loop: 'morning-triage',
    source_run_id: 'run-1',
    promote_score: 1,
    custom_user_field: 'allowed'
  };
  const invalid = {
    title: 'Invalid',
    status: 'nope',
    type: 'case',
    confidence: 'certain'
  };

  assert.equal(validate(validCase), true, JSON.stringify(validate.errors, null, 2));
  assert.equal(validate(invalid), false);
  assert.match(JSON.stringify(validate.errors), /status|confidence/);
});
