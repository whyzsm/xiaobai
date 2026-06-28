import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MemoryIndex } from '../../memory-protocol/src';
import { formatJson } from '../../shared/src/fs';

export async function writeMemoryIndexAtomic(indexPath: string, index: MemoryIndex): Promise<void> {
  await mkdir(path.dirname(indexPath), { recursive: true });
  const tempPath = `${indexPath}.tmp`;
  await writeFile(tempPath, formatJson(index), 'utf8');
  await rename(tempPath, indexPath);
}
