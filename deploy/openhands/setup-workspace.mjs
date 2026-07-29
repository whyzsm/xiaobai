#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = path.resolve(requiredEnv('XIAOBAI_WORKSPACE_ROOT', '/projects/xiaobai'));
const xiaonengRoot = path.resolve(requiredEnv('XIAONENG_ROOT', '/opt/xiaoneng'));
const vaultRoot = path.resolve(requiredEnv('OBSIDIAN_VAULT_ROOT', '/memory/obsidian'));
const containerVaultRoot = requiredEnv('MEMORY_CONTAINER_VAULT_ROOT', '/memory/obsidian');
const learningRootName = safeRelativePath(requiredEnv('MEMORY_LEARNING_ROOT_NAME', '88-学习/xiaobai'));
const projectId = safeSegment(requiredEnv('MEMORY_PROJECT_ID', 'xbaiProjectCode'));

assertDirectory(workspaceRoot, 'Xiaobai workspace');
assertDirectory(xiaonengRoot, 'Xiaoneng background');
assertFile(path.join(workspaceRoot, 'AGENTS.md'), 'Xiaobai AGENTS.md');
assertFile(path.join(workspaceRoot, 'workspace', 'agents', 'xiaobai.orchestrator.agent.yaml'), 'Xiaobai orchestrator');
assertFile(path.join(xiaonengRoot, 'xiaoneng-agent', 'SKILL.md'), 'Xiaoneng entry skill');
assertFile(path.join(xiaonengRoot, 'harness', 'runtime', 'manifest.yaml'), 'Xiaoneng routing manifest');
assertBackgroundRoute(workspaceRoot);

const backgroundMount = path.join(
  workspaceRoot,
  'workspace',
  '.local',
  't-max',
  'mounts',
  'background',
  'xiaoneng'
);
refreshSymlink(xiaonengRoot, backgroundMount);

const learningRoot = path.join(vaultRoot, ...learningRootName.split('/'));
const indexRoot = path.join(learningRoot, '00-记忆索引');
const projectRoot = path.join(learningRoot, '10-项目记忆', projectId);
for (const directory of [vaultRoot, path.join(vaultRoot, '.obsidian'), indexRoot, projectRoot]) {
  fs.mkdirSync(directory, { recursive: true });
}

const seedRoot = path.join(workspaceRoot, 'deploy', 'openhands', 'memory-seed', 'project');
assertDirectory(seedRoot, 'OpenHands memory seed');
copyMissingTree(seedRoot, projectRoot);
initializeRuntimeLogs(projectRoot);

const containerProjectRoot = path.posix.join(
  containerVaultRoot.replace(/\\/g, '/'),
  learningRootName,
  '10-项目记忆',
  projectId
);
const localConfigPath = path.join(workspaceRoot, 'workspace', 'workspace.local.yaml');
writeManagedLocalConfig(localConfigPath, {
  memoryRoot: containerProjectRoot,
  memoryVaultRoot: containerVaultRoot,
  memoryLearningRootName: learningRootName
});

console.log(`workspace: ${workspaceRoot}`);
console.log(`background: ${backgroundMount} -> ${xiaonengRoot}`);
console.log(`memory: ${projectRoot}`);
console.log(`local-config: ${localConfigPath}`);

function requiredEnv(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function safeRelativePath(value) {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Invalid relative memory path: ${value}`);
  }
  return normalized;
}

function safeSegment(value) {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    throw new Error(`Invalid memory project id: ${value}`);
  }
  return value;
}

function assertDirectory(target, label) {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error(`${label} directory is missing: ${target}`);
  }
}

function assertFile(target, label) {
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`${label} file is missing: ${target}`);
  }
}

function assertBackgroundRoute(root) {
  const projectPath = path.join(root, 'workspace', 'projects', 't-max', '.loop', 'project.yaml');
  assertFile(projectPath, 'T-MAX project mapping');
  const source = fs.readFileSync(projectPath, 'utf8');
  const requiredLines = [
    /^background:\s*$/m,
    /^\s+id:\s*xiaoneng\s*$/m,
    /^\s+localPathKey:\s*xiaoneng\s*$/m,
    /^\s+mount:\s*\.\.\/\.\.\/\.local\/t-max\/mounts\/background\/xiaoneng\s*$/m
  ];
  if (requiredLines.some((pattern) => !pattern.test(source))) {
    throw new Error(`T-MAX project mapping does not resolve to Xiaoneng: ${projectPath}`);
  }
}

function refreshSymlink(target, mount) {
  fs.mkdirSync(path.dirname(mount), { recursive: true });
  try {
    const current = fs.lstatSync(mount);
    if (!current.isSymbolicLink()) {
      throw new Error(`Refusing to replace non-symlink background mount: ${mount}`);
    }
    if (fs.readlinkSync(mount) === target) {
      return;
    }
    fs.unlinkSync(mount);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  fs.symlinkSync(target, mount, process.platform === 'win32' ? 'junction' : 'dir');
}

function copyMissingTree(sourceRoot, targetRoot) {
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Memory seed must not contain symlinks: ${source}`);
    }
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyMissingTree(source, target);
      continue;
    }
    if (entry.isFile() && !fs.existsSync(target)) {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    }
  }
}

function initializeRuntimeLogs(root) {
  for (const loopId of ['morning-triage', 'frontend-delivery']) {
    const loopRoot = path.join(root, 'loops', loopId);
    fs.mkdirSync(loopRoot, { recursive: true });
    for (const filename of ['runs.jsonl', 'findings.jsonl', 'metrics.jsonl']) {
      const target = path.join(loopRoot, filename);
      if (!fs.existsSync(target)) {
        fs.writeFileSync(target, '', { encoding: 'utf8', flag: 'wx' });
      }
    }
  }
}

function writeManagedLocalConfig(target, config) {
  const marker = '# Managed by deploy/openhands/setup-workspace.mjs';
  const content = [
    marker,
    '# Container paths only. Do not replace these with the distributor machine paths.',
    `memoryRoot: ${config.memoryRoot}`,
    `memoryVaultRoot: ${config.memoryVaultRoot}`,
    `memoryLearningRootName: ${config.memoryLearningRootName}`,
    ''
  ].join('\n');

  if (fs.existsSync(target)) {
    const current = fs.readFileSync(target, 'utf8');
    if (current === content) {
      return;
    }
    if (!current.startsWith(marker)) {
      throw new Error(`Refusing to replace an unmanaged local memory config: ${target}`);
    }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}
