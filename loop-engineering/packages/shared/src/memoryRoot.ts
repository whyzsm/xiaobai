import path from 'node:path';
import { pathExists, readYamlFile, resolveWorkspacePath } from './fs';

interface WorkspaceLocalConfig {
  memoryRoot?: string;
}

const localConfigPath = 'workspace.local.yaml';

export async function resolveMemoryRoot(workspaceRoot: string): Promise<string> {
  const configPath = path.join(workspaceRoot, localConfigPath);
  if (await pathExists(configPath)) {
    const config = await readYamlFile<WorkspaceLocalConfig>(configPath);
    if (config.memoryRoot) {
      return resolveWorkspacePath(workspaceRoot, config.memoryRoot);
    }
  }

  return path.join(workspaceRoot, 'memory');
}

export function resolveMemoryPath(memoryRoot: string, memoryPath: string): string {
  if (path.isAbsolute(memoryPath)) {
    return memoryPath;
  }

  if (memoryPath === 'memory') {
    return memoryRoot;
  }

  if (memoryPath.startsWith('memory/')) {
    return path.join(memoryRoot, memoryPath.slice('memory/'.length));
  }

  return path.join(memoryRoot, memoryPath);
}
