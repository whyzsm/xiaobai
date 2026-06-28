import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';

export async function computeFileHash(filePath: string): Promise<string> {
  const stat = await lstat(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to hash symlink: ${filePath}`);
  }
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}
