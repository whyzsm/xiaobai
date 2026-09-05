import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Guards the compiled route CLI against stale builds: switching branches or
// editing sources without rebuilding must never let the host bridge route
// with an outdated engine. Pure decision logic stays separate from the npm
// spawn so tests can exercise it without building anything.
export function isBuildStale(cliPath, sourcePaths) {
  if (!existsSync(cliPath)) return true;
  const builtAt = statSync(cliPath).mtimeMs;
  return sourcePaths.some((sourcePath) => isPathNewer(path.resolve(sourcePath), builtAt));
}

export function ensureBuilt(projectRoot) {
  const cliPath = path.join(projectRoot, 'dist/loop-engineering/cli/loop.js');
  const sourcePaths = [
    path.join(projectRoot, 'loop-engineering/cli'),
    path.join(projectRoot, 'loop-engineering/packages'),
    path.join(projectRoot, 'tsconfig.json')
  ];
  if (!isBuildStale(cliPath, sourcePaths)) {
    return { ok: true, built: false };
  }
  const build = spawnSync('npm', ['run', 'build', '--silent'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  if (build.status !== 0 || !existsSync(cliPath)) {
    return { ok: false, built: true };
  }
  return { ok: true, built: true };
}

function isPathNewer(target, threshold) {
  let stats;
  try {
    stats = statSync(target);
  } catch {
    return false;
  }
  if (stats.isFile()) return stats.mtimeMs > threshold;
  if (!stats.isDirectory()) return false;
  for (const entry of readdirSync(target)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    if (isPathNewer(path.join(target, entry), threshold)) return true;
  }
  return false;
}
