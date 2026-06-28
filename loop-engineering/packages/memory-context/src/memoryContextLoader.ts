import path from 'node:path';
import { MemoryIndex, NoteEntry } from '../../memory-protocol/src';
import { pathExists, readText } from '../../shared/src/fs';
import { searchMemory } from '../../memory-search/src';
import { fitContextBudget } from './budget';
import { MemoryContextBundle, MemoryContextItem } from './bundle';

export interface LoadMemoryContextOptions {
  index: MemoryIndex;
  projectId: string;
  loopId?: string;
  query?: string;
  maxCharacters: number;
}

export async function loadMemoryContext(options: LoadMemoryContextOptions): Promise<MemoryContextBundle> {
  const warnings: string[] = [];
  const coreNotes = selectCoreNotes(options.index.notes, options.projectId, options.loopId);
  const expansion = searchMemory(options.index, {
    query: options.query ?? '',
    project: options.projectId,
    limit: 6
  }).map((match) => match.note);
  const crossProject = searchMemory(options.index, {
    query: options.query ?? '',
    limit: 6
  })
    .map((match) => match.note)
    .filter((note) => note.projectId !== options.projectId && (note.kind === 'case' || note.kind === 'pattern'));

  const notes = uniqueNotes([...coreNotes, ...expansion, ...crossProject]);
  const items: MemoryContextItem[] = [];
  for (const note of notes) {
    if (!(await pathExists(note.path))) {
      warnings.push(`Missing context file: ${note.path}`);
      continue;
    }
    const content = await readText(note.path);
    items.push({
      path: note.path,
      title: note.title,
      kind: note.kind,
      priority: priority(note),
      characters: content.length,
      content
    });
  }

  const budget = fitContextBudget(items, options.maxCharacters);
  const content = budget.included
    .map((item) => `# ${item.title}\n\nSource: ${path.basename(item.path)}\n\n${item.content}`)
    .join('\n\n---\n\n');

  return {
    projectId: options.projectId,
    loopId: options.loopId,
    maxCharacters: options.maxCharacters,
    usedCharacters: budget.usedCharacters,
    included: budget.included,
    omitted: budget.omitted,
    warnings,
    content
  };
}

function selectCoreNotes(notes: NoteEntry[], projectId: string, loopId?: string): NoteEntry[] {
  const wanted = new Set(['project-index', 'project-profile', 'active-context', 'decision', 'inbox', 'loop-state']);
  return notes.filter((note) => {
    if (note.projectId !== projectId) return false;
    if (!wanted.has(note.kind)) return false;
    if (note.loopId && loopId && note.loopId !== loopId) return false;
    return true;
  });
}

function uniqueNotes(notes: NoteEntry[]): NoteEntry[] {
  const seen = new Set<string>();
  return notes.filter((note) => {
    if (seen.has(note.id)) return false;
    seen.add(note.id);
    return true;
  });
}

function priority(note: NoteEntry): number {
  switch (note.kind) {
    case 'project-index':
      return 100;
    case 'project-profile':
      return 95;
    case 'active-context':
      return 90;
    case 'decision':
      return 80;
    case 'loop-state':
      return 75;
    case 'inbox':
      return 70;
    case 'pattern':
      return 50;
    case 'case':
      return 40;
    default:
      return 10;
  }
}
