import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..');
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

const errors = [];
for (const desired of desiredMounts) {
  if (!desired.target) {
    errors.push(`${desired.label} is missing from ${localPathsPath}`);
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

for (const desired of desiredMounts) {
  refreshSymlink(desired.target, desired.mount);
  console.log(`${path.relative(path.resolve(projectDir, '../..'), desired.mount)} -> ${desired.target}`);
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
