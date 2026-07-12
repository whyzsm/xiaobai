import path from 'node:path';
import { MemoryIndex } from '../../memory-protocol/src';
import { pathExists, readText } from '../../shared/src/fs';

export async function readMemoryIndex(indexPath: string, vaultRoot?: string): Promise<MemoryIndex> {
  if (!(await pathExists(indexPath))) {
    throw new Error(`Memory index not found. Run loop memory index --write first: ${indexPath}`);
  }
  try {
    const index = JSON.parse(await readText(indexPath)) as MemoryIndex;
    return vaultRoot ? rebaseMemoryIndex(index, path.resolve(vaultRoot)) : index;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid memory index ${path.basename(indexPath)}: ${message}`);
  }
}

function rebaseMemoryIndex(index: MemoryIndex, vaultRoot: string): MemoryIndex {
  const rebaseNote = <T extends MemoryIndex['notes'][number]>(note: T): T => ({
    ...note,
    path: path.join(vaultRoot, ...note.vaultRelativePath.split('/'))
  });
  const notes = index.notes.map(rebaseNote);
  const byId = new Map(notes.map((note) => [note.id, note]));
  return {
    ...index,
    vaultRoot,
    projects: index.projects.map((project) => ({
      ...project,
      memoryRoot: path.join(vaultRoot, ...project.memoryRoot.split('/')),
      entry: path.join(vaultRoot, ...project.entry.split('/'))
    })),
    notes,
    cases: index.cases.map((note) => byId.get(note.id) ?? rebaseNote(note)),
    patterns: index.patterns.map((note) => byId.get(note.id) ?? rebaseNote(note)),
    warnings: index.warnings.map((warning) => warning.path
      ? { ...warning, path: path.join(vaultRoot, ...path.relative(index.vaultRoot ?? vaultRoot, warning.path).split(path.sep)) }
      : warning)
  };
}
