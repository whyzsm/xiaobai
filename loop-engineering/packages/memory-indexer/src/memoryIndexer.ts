import { lstat, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  buildObsidianLink,
  computeFileHash,
  extractMarkdown,
  MemoryIndex,
  MemoryWarning,
  NoteEntry,
  parseFrontmatter,
  ProjectEntry,
  resolveMemoryProtocolPaths,
  vaultRelativePath
} from '../../memory-protocol/src';
import { pathExists, readText } from '../../shared/src/fs';
import { classifyNote } from './noteClassifier';

export interface BuildMemoryIndexOptions {
  workspaceRoot: string;
  vaultRoot: string;
  projectId?: string;
  now?: Date;
}

export async function buildMemoryIndex(options: BuildMemoryIndexOptions): Promise<MemoryIndex> {
  const paths = resolveMemoryProtocolPaths({
    workspaceRoot: options.workspaceRoot,
    vaultRoot: options.vaultRoot,
    projectId: options.projectId ?? '__all__'
  });
  const warnings: MemoryWarning[] = [];
  const projectsRoot = paths.allProjectsRoot;
  const projectDirs = (await pathExists(projectsRoot))
    ? (await readdir(projectsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && (!options.projectId || entry.name === options.projectId))
        .map((entry) => entry.name)
        .sort()
    : [];

  const notes: NoteEntry[] = [];
  const projects: ProjectEntry[] = [];

  for (const projectId of projectDirs) {
    const projectRoot = path.join(projectsRoot, projectId);
    const files = await listMarkdownFiles(projectRoot, warnings);
    let projectEntry: ProjectEntry | undefined;

    for (const filePath of files) {
      const note = await readNote({
        vaultRoot: paths.vaultRoot,
        projectRoot,
        projectId,
        filePath,
        warnings
      });
      notes.push(note);
      if (note.kind === 'project-index') {
        projectEntry = {
          id: projectId,
          name: note.title,
          status: note.status ?? 'active',
          memoryRoot: vaultRelativePath(paths.vaultRoot, projectRoot),
          entry: note.vaultRelativePath,
          tags: note.tags,
          confidence: note.confidence ?? 'medium'
        };
      }
    }

    projects.push(
      projectEntry ?? {
        id: projectId,
        name: projectId,
        status: 'active',
        memoryRoot: vaultRelativePath(paths.vaultRoot, projectRoot),
        entry: vaultRelativePath(paths.vaultRoot, path.join(projectRoot, 'index.md')),
        tags: [],
        confidence: 'medium'
      }
    );
  }

  return {
    schemaVersion: 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    vaultRoot: paths.vaultRoot,
    learningRoot: vaultRelativePath(paths.vaultRoot, paths.learningRoot),
    globalIndexRoot: vaultRelativePath(paths.vaultRoot, paths.globalIndexRoot),
    projectRoot: vaultRelativePath(paths.vaultRoot, paths.allProjectsRoot),
    projects,
    notes: notes.sort((a, b) => a.vaultRelativePath.localeCompare(b.vaultRelativePath)),
    cases: notes.filter((note) => note.kind === 'case'),
    patterns: notes.filter((note) => note.kind === 'pattern'),
    tags: buildTags(notes),
    links: notes.flatMap((note) =>
      note.links.map((link) => ({
        from: note.id,
        to: link,
        raw: `[[${link}]]`
      }))
    ),
    warnings
  };
}

async function readNote(input: {
  vaultRoot: string;
  projectRoot: string;
  projectId: string;
  filePath: string;
  warnings: MemoryWarning[];
}): Promise<NoteEntry> {
  const content = await readText(input.filePath);
  const parsed = parseFrontmatter(content);
  for (const warning of parsed.warnings) {
    input.warnings.push({
      level: 'warning',
      code: 'invalid-frontmatter',
      message: warning,
      path: input.filePath
    });
  }
  const markdown = extractMarkdown({
    filePath: input.filePath,
    frontmatter: parsed.data,
    body: parsed.body
  });
  const fileStat = await stat(input.filePath);
  const relative = vaultRelativePath(input.vaultRoot, input.filePath);
  const classification = classifyNote({
    projectRoot: input.projectRoot,
    filePath: input.filePath,
    frontmatterType: stringValue(parsed.data.type)
  });

  return {
    id: stringValue(parsed.data.id) || stableNoteId(input.projectId, relative),
    kind: classification.kind,
    projectId: input.projectId,
    loopId: stringValue(parsed.data.loop) || classification.loopId,
    title: markdown.title,
    path: input.filePath,
    vaultRelativePath: relative,
    obsidianLink: buildObsidianLink(relative, markdown.title),
    tags: arrayValue(parsed.data.tags),
    status: stringValue(parsed.data.status) || defaultStatus(classification.kind),
    type: stringValue(parsed.data.type) || defaultType(classification.kind),
    domain: arrayValue(parsed.data.domain),
    source: stringValue(parsed.data.source) || 'local',
    access: stringValue(parsed.data.access) || 'private',
    confidence: confidenceValue(parsed.data.confidence) ?? 'medium',
    summary: markdown.summary,
    headings: markdown.headings,
    links: markdown.links,
    keywords: markdown.keywords,
    mtimeMs: fileStat.mtimeMs,
    sizeBytes: fileStat.size,
    contentHash: await computeFileHash(input.filePath),
    promoteScore: numberValue(parsed.data.promote_score),
    sourceCases: arrayValue(parsed.data.source_cases)
  };
}

async function listMarkdownFiles(root: string, warnings: MemoryWarning[]): Promise<string[]> {
  if (!(await pathExists(root))) {
    return [];
  }
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    const entryStat = await lstat(entryPath);
    if (entryStat.isSymbolicLink()) {
      warnings.push({
        level: 'warning',
        code: 'skipped-symlink',
        message: `Skipped symlink: ${entryPath}`,
        path: entryPath
      });
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(entryPath, warnings)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function buildTags(notes: NoteEntry[]) {
  const tagMap = new Map<string, Set<string>>();
  for (const note of notes) {
    for (const tag of note.tags) {
      if (!tagMap.has(tag)) tagMap.set(tag, new Set());
      tagMap.get(tag)?.add(note.id);
    }
  }
  return [...tagMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, ids]) => ({
      tag,
      count: ids.size,
      notes: [...ids].sort()
    }));
}

function stableNoteId(projectId: string, relativePath: string): string {
  return `${projectId}:${relativePath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function arrayValue(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return [...new Set(raw.map((item) => String(item).trim()).filter(Boolean))];
}

function confidenceValue(value: unknown): 'low' | 'medium' | 'high' | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function defaultStatus(kind: string): string {
  return kind === 'case' || kind === 'pattern' ? 'seed' : 'active';
}

function defaultType(kind: string): string {
  switch (kind) {
    case 'project-index':
      return 'project-memory';
    case 'loop-state':
      return 'loop-state';
    default:
      return kind;
  }
}
