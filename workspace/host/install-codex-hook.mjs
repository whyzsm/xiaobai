#!/usr/bin/env node
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(process.env.XIAOBAI_PROJECT_ROOT || path.join(scriptDir, '../..'));
const hookScript = path.join(projectRoot, 'workspace/host/xiaoneng-codex-prompt-hook.mjs');
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
const hooksPath = path.join(codexHome, 'hooks.json');

await access(hookScript).catch(() => fail(`Xiaoneng hook is missing: ${hookScript}`));
const config = await readConfig(hooksPath);
const hooks = config.hooks && typeof config.hooks === 'object' && !Array.isArray(config.hooks)
  ? config.hooks
  : {};
const existing = Array.isArray(hooks.UserPromptSubmit) ? hooks.UserPromptSubmit : [];
const command = `XIAOBAI_PROJECT_ROOT=${shellQuote(projectRoot)} ${shellQuote(process.execPath)} ${shellQuote(hookScript)}`;

hooks.UserPromptSubmit = [
  ...existing.map(removeXiaobaiHooks).filter((group) => group.hooks.length > 0),
  {
    hooks: [
      {
        type: 'command',
        command,
        timeout: 15
      }
    ]
  }
];
config.hooks = hooks;

await mkdir(codexHome, { recursive: true });
const tempPath = path.join(codexHome, `.hooks.json.${process.pid}.tmp`);
await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
await rename(tempPath, hooksPath);

process.stdout.write([
  'Codex Xiaoneng hook installed.',
  `Config: ${hooksPath}`,
  `Project root: ${projectRoot}`,
  'Scope: user-level registration, active only when the conversation cwd is inside this Xiaobai project root.',
  'All conversations outside the Xiaobai project root are ignored by this hook.',
  'Next step: restart Codex Desktop before creating a new conversation.'
].join('\n') + '\n');

async function readConfig(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail(`Codex hook config must be a JSON object: ${filePath}`);
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    if (error instanceof SyntaxError) fail(`Codex hook config is invalid JSON; refusing to overwrite: ${filePath}`);
    throw error;
  }
}

function removeXiaobaiHooks(group) {
  if (!group || !Array.isArray(group.hooks)) return group;
  return {
    ...group,
    hooks: group.hooks.filter((hook) => !isXiaobaiHook(hook))
  };
}

function isXiaobaiHook(hook) {
  return Boolean(hook && typeof hook.command === 'string' && hook.command.includes('xiaoneng-codex-prompt-hook.mjs'));
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
