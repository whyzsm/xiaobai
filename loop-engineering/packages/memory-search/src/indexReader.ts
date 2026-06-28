import path from 'node:path';
import { MemoryIndex } from '../../memory-protocol/src';
import { pathExists, readText } from '../../shared/src/fs';

export async function readMemoryIndex(indexPath: string): Promise<MemoryIndex> {
  if (!(await pathExists(indexPath))) {
    throw new Error(`Memory index not found. Run loop memory index --write first: ${indexPath}`);
  }
  try {
    return JSON.parse(await readText(indexPath)) as MemoryIndex;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid memory index ${path.basename(indexPath)}: ${message}`);
  }
}
