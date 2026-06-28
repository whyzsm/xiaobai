import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import {
  buildObsidianLink,
  computeFileHash,
  createMemoryTemplates,
  extractMarkdown,
  parseFrontmatter,
  resolveMemoryProtocolPaths,
  resolveSafeWritePath
} from '../packages/memory-protocol/src';

test('memory path resolution supports absolute vaults and Chinese path segments', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'memory-protocol-paths-'));
  const vaultRoot = path.join(tempRoot, '知识库');
  await mkdir(path.join(vaultRoot, '.obsidian'), { recursive: true });

  const paths = resolveMemoryProtocolPaths({
    workspaceRoot: path.join(tempRoot, 'workspace'),
    vaultRoot,
    projectId: 'demo',
    loopId: 'morning-triage'
  });

  assert.equal(paths.vaultRoot, vaultRoot);
  assert.equal(paths.learningRoot, path.join(vaultRoot, '88-学习'));
  assert.equal(paths.globalIndexRoot, path.join(vaultRoot, '88-学习', '00-记忆索引'));
  assert.equal(paths.projectRoot, path.join(vaultRoot, '88-学习', '10-项目记忆', 'demo'));
  assert.equal(paths.loopRoot, path.join(paths.projectRoot, 'loops', 'morning-triage'));
  assert.equal(
    resolveSafeWritePath(paths.learningRoot, path.join(paths.projectRoot, 'index.md')),
    path.join(paths.projectRoot, 'index.md')
  );
  assert.throws(() => resolveSafeWritePath(paths.learningRoot, path.join(tempRoot, 'outside.md')), /outside/);
});

test('frontmatter parser tolerates missing and malformed frontmatter and normalizes tags', () => {
  const missing = parseFrontmatter('# Title\n\nBody');
  assert.deepEqual(missing.data, {});
  assert.equal(missing.body, '# Title\n\nBody');
  assert.deepEqual(missing.warnings, []);

  const parsed = parseFrontmatter(`---
title: Demo
tags:
  - type/case
  - type/case
  - status/seed
domain: ai-engineering
---

# Demo
`);
  assert.equal(parsed.data.title, 'Demo');
  assert.deepEqual(parsed.data.tags, ['type/case', 'status/seed']);
  assert.deepEqual(parsed.data.domain, ['ai-engineering']);

  const malformed = parseFrontmatter(`---
title: [broken
---
Body`);
  assert.equal(malformed.body, 'Body');
  assert.match(malformed.warnings.join('\n'), /frontmatter/i);
});

test('markdown extraction handles Chinese headings, aliases, fallback titles, and summaries', () => {
  const parsed = extractMarkdown({
    filePath: '/tmp/知识库/88-学习/10-项目记忆/demo/index.md',
    frontmatter: { tags: ['type/project-memory'], title: '项目入口' },
    body: `# 忽略的 H1

这里是第一段摘要，用于检索。

## 二级标题

链接到 [[active-context|当前上下文]] 和 [[patterns/p1]]。
`
  });

  assert.equal(parsed.title, '项目入口');
  assert.deepEqual(parsed.headings, ['忽略的 H1', '二级标题']);
  assert.deepEqual(parsed.links, ['active-context', 'patterns/p1']);
  assert.match(parsed.summary, /第一段摘要/);
  assert(parsed.keywords.includes('项目入口'));

  const fallback = extractMarkdown({
    filePath: '/tmp/no-h1.md',
    frontmatter: {},
    body: 'plain body'
  });
  assert.equal(fallback.title, 'no-h1');
});

test('content hash is deterministic and refuses symlinks', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'memory-protocol-hash-'));
  const file = path.join(tempRoot, 'a.md');
  const link = path.join(tempRoot, 'link.md');
  await writeFile(file, 'same', 'utf8');
  await symlink(file, link);

  const first = await computeFileHash(file);
  const second = await computeFileHash(file);
  assert.equal(first, second);
  await writeFile(file, 'changed', 'utf8');
  assert.notEqual(await computeFileHash(file), first);
  await assert.rejects(() => computeFileHash(link), /symlink/i);
});

test('templates parse and include controlled frontmatter and sections', () => {
  const templates = createMemoryTemplates({
    projectId: 'demo',
    loopId: 'morning-triage',
    date: '2026-06-28'
  });

  for (const template of templates) {
    const parsed = parseFrontmatter(template.content);
    assert.equal(parsed.warnings.length, 0, `${template.path}: ${parsed.warnings.join(', ')}`);
    assert(parsed.data.title, `${template.path} missing title`);
    assert(parsed.data.tags, `${template.path} missing tags`);
  }

  const caseTemplate = templates.find((template) => template.path.includes('/cases/'));
  assert(caseTemplate);
  assert.match(caseTemplate.content, /## Trigger/);
  assert.match(caseTemplate.content, /## Reuse Hint/);
});

test('obsidian links are stable for vault relative markdown paths', () => {
  assert.equal(
    buildObsidianLink('88-学习/10-项目记忆/demo/index.md', 'Demo Project'),
    '[[88-学习/10-项目记忆/demo/index|Demo Project]]'
  );
});
