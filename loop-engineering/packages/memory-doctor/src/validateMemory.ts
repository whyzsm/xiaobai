import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { MemoryIndex } from '../../memory-protocol/src';
import { pathExists } from '../../shared/src/fs';
import { validateMemoryIndexSchema } from '../../memory-indexer/src';
import { validateJsonl } from './jsonl';
import { checkIndexFreshness } from './indexFreshness';

export interface MemoryValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export async function validateMemory(input: {
  repoRoot: string;
  vaultRoot: string;
  learningRoot: string;
  globalIndexRoot: string;
  projectRoot: string;
  index?: MemoryIndex;
}): Promise<MemoryValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const required of [input.learningRoot, input.globalIndexRoot, input.projectRoot]) {
    if (!(await pathExists(required))) errors.push(`Missing required path: ${required}`);
  }

  if (input.index) {
    errors.push(...(await validateMemoryIndexSchema(input.repoRoot, input.index)));
    warnings.push(...(await checkIndexFreshness(input.index)));
    const ids = new Set<string>();
    for (const note of input.index.notes) {
      if (ids.has(note.id)) errors.push(`Duplicate note id: ${note.id}`);
      ids.add(note.id);
    }
  }

  if (await pathExists(input.projectRoot)) {
    for (const jsonl of await listJsonl(input.projectRoot)) {
      errors.push(...(await validateJsonl(jsonl)));
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

async function listJsonl(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await listJsonl(entryPath)));
    if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(entryPath);
  }
  return files;
}
