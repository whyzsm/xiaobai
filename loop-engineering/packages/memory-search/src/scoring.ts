import { NoteEntry } from '../../memory-protocol/src';

export interface ScoredMemoryMatch {
  note: NoteEntry;
  score: number;
  matchedFields: string[];
}

export function scoreMemoryNote(note: NoteEntry, query: string, sameProject?: string): ScoredMemoryMatch {
  const terms = tokenize(query);
  const matchedFields: string[] = [];
  let score = 0;

  if (terms.length === 0) {
    score += 1;
  }

  if (containsAll(note.title, terms)) {
    score += 20;
    matchedFields.push('title');
  }
  if (containsAny(note.summary, terms) || containsAny(note.keywords.join(' '), terms)) {
    score += 30;
    matchedFields.push('content');
  }
  if (containsAny(note.tags.join(' '), terms)) {
    score += 20;
    matchedFields.push('tags');
  }
  if (sameProject && note.projectId === sameProject) {
    score += 15;
    matchedFields.push('project');
  }
  if (note.confidence === 'high') score += 10;
  if (note.confidence === 'medium') score += 5;
  if (note.promoteScore) score += note.promoteScore;

  const daysOld = Math.max(0, (Date.now() - note.mtimeMs) / 86400000);
  score += Math.max(0, 5 - Math.floor(daysOld / 30));

  return {
    note,
    score,
    matchedFields
  };
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{Letter}\p{Number}]+/u)
    .map((term) => term.trim())
    .filter(Boolean);
}

function containsAny(value: string, terms: string[]): boolean {
  const lower = value.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function containsAll(value: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const lower = value.toLowerCase();
  return terms.every((term) => lower.includes(term));
}
