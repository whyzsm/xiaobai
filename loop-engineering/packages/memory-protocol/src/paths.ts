import path from 'node:path';
import { MemoryProtocolPathOptions, MemoryProtocolPaths } from './types';

const DEFAULT_LEARNING_ROOT = '88-学习';
const DEFAULT_GLOBAL_INDEX_ROOT = '00-记忆索引';
const DEFAULT_PROJECT_ROOT = '10-项目记忆';

export function resolveMemoryProtocolPaths(options: MemoryProtocolPathOptions): MemoryProtocolPaths {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const vaultRoot = path.resolve(options.vaultRoot ?? workspaceRoot);
  const learningRoot = path.join(vaultRoot, options.learningRootName ?? DEFAULT_LEARNING_ROOT);
  const globalIndexRoot = path.join(learningRoot, options.globalIndexRootName ?? DEFAULT_GLOBAL_INDEX_ROOT);
  const allProjectsRoot = path.join(learningRoot, options.projectRootName ?? DEFAULT_PROJECT_ROOT);
  const projectRoot = path.join(allProjectsRoot, options.projectId);

  return {
    workspaceRoot,
    vaultRoot,
    learningRoot,
    globalIndexRoot,
    allProjectsRoot,
    projectRoot,
    loopRoot: options.loopId ? path.join(projectRoot, 'loops', options.loopId) : undefined,
    casesRoot: path.join(projectRoot, 'cases'),
    patternsRoot: path.join(projectRoot, 'patterns'),
    reportsRoot: path.join(projectRoot, 'reports'),
    indexPath: path.join(globalIndexRoot, 'memory-index.json')
  };
}

export function resolveSafeWritePath(allowedRoot: string, targetPath: string): string {
  const root = path.resolve(allowedRoot);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside allowed root: ${target}`);
  }
  return target;
}

export function vaultRelativePath(vaultRoot: string, filePath: string): string {
  return path.relative(vaultRoot, filePath).replaceAll(path.sep, '/');
}

export function buildObsidianLink(vaultRelativeMarkdownPath: string, title: string): string {
  const withoutExtension = vaultRelativeMarkdownPath.replace(/\.md$/i, '');
  return `[[${withoutExtension}|${title}]]`;
}
