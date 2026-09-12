import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
const projectsRoot = path.resolve(projectDir, '..');
const projectConfigPath = path.join(projectDir, '.loop', 'project.yaml');
const localPathsPath = path.join(projectDir, '.loop', 'local.paths.yaml');

const projectConfig = readYaml(projectConfigPath);
const localPaths = readYaml(localPathsPath);

const desiredMounts = [
  {
    label: `background:${projectConfig.background.id}`,
    target: readConfiguredPath(localPaths.background, projectConfig.background.localPathKey),
    mount: path.resolve(projectDir, projectConfig.background.mount)
  },
  ...projectConfig.repositories.map((repo) => ({
    label: `repository:${repo.id}`,
    target: readConfiguredPath(localPaths.repositories, repo.localPathKey),
    mount: path.resolve(projectDir, repo.mount)
  }))
];

// Standalone child projects (kind: Project) may declare mounts inside this same
// mounts root, e.g. KPIUI mounting the shared xigua background and its own
// repository. They have no mount script of their own, so this script maintains
// them alongside the project-group mounts.
const desiredBackgroundMounts = [desiredMounts[0].mount];
for (const extra of await collectStandaloneProjectMounts()) {
  if (desiredMounts.some((desired) => samePath(desired.mount, extra.mount))) {
    continue;
  }
  desiredMounts.push(extra);
  if (extra.isBackground) {
    desiredBackgroundMounts.push(extra.mount);
  }
}

const errors = [];
for (const desired of desiredMounts) {
  if (!desired.target) {
    errors.push(`${desired.label} is missing from ${desired.localPathsPath}`);
    continue;
  }

  if (!fs.existsSync(desired.target)) {
    errors.push(`${desired.label} target does not exist: ${desired.target}`);
    continue;
  }

  if (!fs.statSync(desired.target).isDirectory()) {
    errors.push(`${desired.label} target is not a directory: ${desired.target}`);
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

removeStaleBackgroundSymlinks(desiredBackgroundMounts);

for (const desired of desiredMounts) {
  refreshSymlink(desired.target, desired.mount);
  console.log(`${path.relative(path.resolve(projectDir, '../..'), desired.mount)} -> ${desired.target}`);
}

async function collectStandaloneProjectMounts() {
  const mountsRoot = path.resolve(projectDir, projectConfig.root);
  const extras = [];
  let projectDirs = [];
  try {
    projectDirs = fs.readdirSync(projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return extras;
  }

  for (const siblingName of projectDirs) {
    if (path.join(projectsRoot, siblingName) === projectDir) {
      continue;
    }
    const siblingRoot = path.join(projectsRoot, siblingName);
    const siblingConfigPath = path.join(siblingRoot, '.loop', 'project.yaml');
    if (!fs.existsSync(siblingConfigPath)) {
      continue;
    }
    const siblingConfig = readYaml(siblingConfigPath);
    if (siblingConfig.kind !== 'Project') {
      continue;
    }
    const siblingLocalPathsPath = siblingConfig.localPaths
      ? path.join(siblingRoot, siblingConfig.localPaths)
      : undefined;
    const siblingLocalPaths = siblingLocalPathsPath && fs.existsSync(siblingLocalPathsPath)
      ? readYaml(siblingLocalPathsPath)
      : {};

    if (siblingConfig.background) {
      const backgroundMount = path.resolve(siblingRoot, siblingConfig.background.mount);
      if (containsPath(mountsRoot, backgroundMount)) {
        extras.push({
          label: `${siblingConfig.id} background:${siblingConfig.background.id}`,
          target: readConfiguredPath(siblingLocalPaths.background, siblingConfig.background.localPathKey),
          mount: backgroundMount,
          isBackground: true,
          localPathsPath: siblingLocalPathsPath
        });
      }
    }

    for (const repo of siblingConfig.repositories ?? []) {
      const repoMount = path.resolve(siblingRoot, repo.mount);
      if (!containsPath(mountsRoot, repoMount)) {
        continue;
      }
      extras.push({
        label: `${siblingConfig.id} repository:${repo.id}`,
        target: readConfiguredPath(siblingLocalPaths.repositories, repo.localPathKey),
        mount: repoMount,
        isBackground: false,
        localPathsPath: siblingLocalPathsPath
      });
    }
  }

  return extras;
}

function readYaml(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing file: ${filePath}`);
    process.exit(1);
  }

  return YAML.parse(fs.readFileSync(filePath, 'utf8'));
}

function readConfiguredPath(section, key) {
  const value = section?.[key];
  if (typeof value === 'string') {
    return normalizeLocalPath(value);
  }

  if (value && typeof value.path === 'string') {
    return normalizeLocalPath(value.path);
  }

  return undefined;
}

function normalizeLocalPath(value) {
  const expanded = value
    .replace(/^~(?=$|[/\\])/, os.homedir())
    .replace(/\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/gi, (_, braced, bare) => {
      const name = braced || bare;
      return process.env[name] ?? '';
    });

  return path.resolve(expanded);
}

function removeStaleBackgroundSymlinks(desiredBackgroundMounts) {
  const backgroundDirs = [...new Set(desiredBackgroundMounts.map((mount) => path.dirname(mount)))];
  for (const backgroundDir of backgroundDirs) {
    if (!fs.existsSync(backgroundDir)) {
      continue;
    }

    for (const entry of fs.readdirSync(backgroundDir)) {
      const candidate = path.join(backgroundDir, entry);
      if (desiredBackgroundMounts.some((mount) => samePath(mount, candidate))) {
        continue;
      }

      if (!fs.lstatSync(candidate).isSymbolicLink()) {
        throw new Error(`Refusing to remove stale non-symlink background mount: ${candidate}`);
      }
      fs.unlinkSync(candidate);
    }
  }
}

function refreshSymlink(target, mount) {
  fs.mkdirSync(path.dirname(mount), { recursive: true });

  try {
    const current = fs.lstatSync(mount);
    if (!current.isSymbolicLink()) {
      throw new Error(`Refusing to replace non-symlink path: ${mount}`);
    }
    fs.unlinkSync(mount);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  fs.symlinkSync(target, mount, process.platform === 'win32' ? 'junction' : 'dir');
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function containsPath(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}
