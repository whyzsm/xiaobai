import { MemoryIndex } from '../../memory-protocol/src';

export interface MemoryDoctorReport {
  score: number;
  warnings: string[];
  stats: {
    projects: number;
    notes: number;
    cases: number;
    patterns: number;
  };
}

export function doctorMemory(index: MemoryIndex): MemoryDoctorReport {
  const warnings: string[] = [];
  for (const note of index.notes) {
    if (note.sizeBytes > 500 * 1024) warnings.push(`Oversized note: ${note.vaultRelativePath}`);
    if (note.tags.length === 0) warnings.push(`Missing tags: ${note.vaultRelativePath}`);
    if (!note.confidence) warnings.push(`Missing confidence: ${note.vaultRelativePath}`);
    if (note.kind === 'case' && (note.promoteScore ?? 0) >= 3 && note.status !== 'reviewed') {
      warnings.push(`High promote score case is not reviewed: ${note.vaultRelativePath}`);
    }
  }

  const score = Math.max(0, 100 - warnings.length * 5 - index.warnings.length * 3);
  return {
    score,
    warnings: [...warnings, ...index.warnings.map((warning) => warning.message)],
    stats: {
      projects: index.projects.length,
      notes: index.notes.length,
      cases: index.cases.length,
      patterns: index.patterns.length
    }
  };
}
