import { MemoryIndex } from '../../memory-protocol/src';
import { applyMemoryFilters, MemorySearchFilters } from './filters';
import { scoreMemoryNote, ScoredMemoryMatch } from './scoring';

export interface MemorySearchOptions extends MemorySearchFilters {
  query: string;
}

export function searchMemory(index: MemoryIndex, options: MemorySearchOptions): ScoredMemoryMatch[] {
  if (!isNonEmptyString(options.projectId)) {
    throw new Error('Memory search requires projectId');
  }
  const hasQuery = options.query.trim() !== '';
  const filtered = applyMemoryFilters(index.notes, options);
  const scored = filtered
    .map((note) => scoreMemoryNote(note, options.query, options.projectId))
    .filter((match) => !hasQuery || hasQueryFieldMatch(match))
    .sort((a, b) => b.score - a.score || a.note.vaultRelativePath.localeCompare(b.note.vaultRelativePath));
  return scored.slice(0, options.limit ?? 10);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasQueryFieldMatch(match: ScoredMemoryMatch): boolean {
  return match.matchedFields.some((field) => field === 'title' || field === 'content' || field === 'tags');
}
