import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readText(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

export async function readYamlFile<T>(filePath: string): Promise<T> {
  const content = await readText(filePath);
  return YAML.parse(content) as T;
}

export async function findLoopSpec(workspaceRoot: string, loopId?: string): Promise<string> {
  const loopsDir = path.join(workspaceRoot, 'loops');
  if (loopId) {
    const explicit = loopId.endsWith('.yaml')
      ? path.resolve(workspaceRoot, loopId)
      : path.join(loopsDir, `${loopId}.loop.yaml`);
    if (!(await pathExists(explicit))) {
      throw new Error(`Loop spec not found: ${explicit}`);
    }
    return explicit;
  }

  const files = (await readdir(loopsDir)).filter((file) => file.endsWith('.loop.yaml'));
  if (files.length === 0) {
    throw new Error(`No loop specs found in ${loopsDir}`);
  }
  if (files.length > 1) {
    throw new Error(`Multiple loop specs found. Pass --loop. Candidates: ${files.join(', ')}`);
  }
  return path.join(loopsDir, files[0]);
}

export function resolveWorkspacePath(workspaceRoot: string, relativeOrAbsolute: string): string {
  return path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.join(workspaceRoot, relativeOrAbsolute);
}

export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
