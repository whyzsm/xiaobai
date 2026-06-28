import { computeFileHash, MemoryIndex } from '../../memory-protocol/src';
import { pathExists } from '../../shared/src/fs';

export async function checkIndexFreshness(index: MemoryIndex): Promise<string[]> {
  const warnings: string[] = [];
  for (const note of index.notes) {
    if (!(await pathExists(note.path))) {
      warnings.push(`Indexed file missing from disk: ${note.path}`);
      continue;
    }
    const hash = await computeFileHash(note.path);
    if (hash !== note.contentHash) {
      warnings.push(`Indexed file is stale: ${note.path}`);
    }
  }
  return warnings;
}
