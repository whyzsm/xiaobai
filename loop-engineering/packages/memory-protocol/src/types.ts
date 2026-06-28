export type MemoryConfidence = 'low' | 'medium' | 'high';

export interface MemoryProtocolPathOptions {
  workspaceRoot: string;
  projectId: string;
  loopId?: string;
  vaultRoot?: string;
  learningRootName?: string;
  globalIndexRootName?: string;
  projectRootName?: string;
}

export interface MemoryProtocolPaths {
  workspaceRoot: string;
  vaultRoot: string;
  learningRoot: string;
  globalIndexRoot: string;
  allProjectsRoot: string;
  projectRoot: string;
  loopRoot?: string;
  casesRoot: string;
  patternsRoot: string;
  reportsRoot: string;
  indexPath: string;
}

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
  warnings: string[];
}

export interface MarkdownExtractionInput {
  filePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface MarkdownExtraction {
  title: string;
  headings: string[];
  links: string[];
  summary: string;
  keywords: string[];
}

export interface MemoryTemplateOptions {
  projectId: string;
  loopId?: string;
  date: string;
}

export interface MemoryTemplate {
  path: string;
  content: string;
}

export type MemoryNoteKind =
  | 'project-index'
  | 'project-profile'
  | 'active-context'
  | 'decision'
  | 'inbox'
  | 'loop-state'
  | 'case'
  | 'pattern'
  | 'report'
  | 'unknown';

export interface ProjectEntry {
  id: string;
  name: string;
  status: string;
  memoryRoot: string;
  entry: string;
  tags: string[];
  confidence: MemoryConfidence;
}

export interface NoteEntry {
  id: string;
  kind: MemoryNoteKind;
  projectId?: string;
  loopId?: string;
  title: string;
  path: string;
  vaultRelativePath: string;
  obsidianLink: string;
  tags: string[];
  status?: string;
  type?: string;
  domain?: string[];
  source?: string;
  access?: string;
  confidence?: MemoryConfidence;
  summary: string;
  headings: string[];
  links: string[];
  keywords: string[];
  mtimeMs: number;
  sizeBytes: number;
  contentHash: string;
  promoteScore?: number;
  sourceCases?: string[];
}

export interface TagEntry {
  tag: string;
  count: number;
  notes: string[];
}

export interface LinkEntry {
  from: string;
  to: string;
  raw: string;
}

export interface MemoryWarning {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  path?: string;
}

export interface MemoryIndex {
  schemaVersion: 1;
  generatedAt: string;
  vaultRoot?: string;
  learningRoot: string;
  globalIndexRoot: string;
  projectRoot: string;
  projects: ProjectEntry[];
  notes: NoteEntry[];
  cases: NoteEntry[];
  patterns: NoteEntry[];
  tags: TagEntry[];
  links: LinkEntry[];
  warnings: MemoryWarning[];
}

export interface MemoryCommandResult {
  ok: boolean;
  command: string;
  errors: string[];
  warnings: string[];
  preview?: boolean;
  [key: string]: unknown;
}
