import { realpath } from 'node:fs/promises';
import path from 'node:path';

export async function isXiaobaiProjectContext(projectRoot, targetCwd) {
  const [resolvedProjectRoot, resolvedTargetCwd] = await Promise.all([
    resolveRealPath(projectRoot),
    resolveRealPath(targetCwd)
  ]);

  if (!containsPath(resolvedProjectRoot, resolvedTargetCwd)) {
    return false;
  }

  // Mounted external repositories live under this ignored directory. A conversation
  // opened through a mount must retain the external host's own routing boundary.
  return !containsPath(path.join(resolvedProjectRoot, 'workspace', '.local'), resolvedTargetCwd);
}

async function resolveRealPath(value) {
  try {
    return await realpath(path.resolve(value));
  } catch {
    return path.resolve(value);
  }
}

function containsPath(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative));
}
