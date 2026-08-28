import { NoteEntry } from '../../memory-protocol/src';

export interface MemorySearchFilters {
  projectId: string;
  type?: string;
  kind?: string;
  tag?: string;
  confidence?: string;
  limit?: number;
}

export function applyMemoryFilters(notes: NoteEntry[], filters: MemorySearchFilters): NoteEntry[] {
  return notes.filter((note) => {
    if (note.projectId !== filters.projectId) return false;
    if (filters.type && note.type !== filters.type && note.kind !== filters.type) return false;
    if (filters.kind && note.kind !== filters.kind) return false;
    if (filters.tag && !note.tags.includes(filters.tag)) return false;
    if (filters.confidence && note.confidence !== filters.confidence) return false;
    return true;
  });
}
