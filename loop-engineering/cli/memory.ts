import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createMemoryTemplates,
  MemoryCommandResult,
  resolveMemoryProtocolPaths,
  resolveSafeWritePath
} from '../packages/memory-protocol/src';
import { buildMemoryIndex, writeMemoryIndexAtomic } from '../packages/memory-indexer/src';
import { readMemoryIndex, searchMemory } from '../packages/memory-search/src';
import { loadMemoryContext } from '../packages/memory-context/src';
import { doctorMemory, validateMemory } from '../packages/memory-doctor/src';
import { planCaseWrite, writeCase, writePattern } from '../packages/memory-capture/src';
import { findLoopSpec, formatJson, pathExists, readText, readYamlFile } from '../packages/shared/src/fs';
import { resolveMemoryRootConfig } from '../packages/shared/src/memoryRoot';
import { LoopSpec } from '../packages/shared/src/types';

interface MemoryCliOptions {
  command: string;
  args: string[];
  workspaceRoot: string;
  repoRoot: string;
}

interface ParsedMemoryArgs {
  json: boolean;
  write: boolean;
  confirm: boolean;
  overwrite: boolean;
  vault?: string;
  project?: string;
  loop?: string;
  query?: string;
  title?: string;
  bodyFile?: string;
  casePath?: string;
  maxCharacters?: number;
  limit?: number;
  type?: string;
  tag?: string;
  confidence?: string;
  runId?: string;
}

type MemoryPaths = ReturnType<typeof resolveMemoryProtocolPaths>;

export async function runMemoryCommand(options: MemoryCliOptions): Promise<void> {
  const parsed = parseMemoryArgs(options.command, options.args);
  const result = await executeMemoryCommand({ ...options, parsed });
  if (parsed.json) {
    process.stdout.write(formatJson(result));
  } else {
    printHuman(result);
  }
  process.exitCode = result.ok ? 0 : 1;
}

async function executeMemoryCommand(input: MemoryCliOptions & { parsed: ParsedMemoryArgs }): Promise<MemoryCommandResult> {
  const paths = await resolveCliMemoryPaths(input.workspaceRoot, input.parsed);
  const command = `memory ${input.command}`;

  try {
    if (input.command === 'init') return handleInit(command, paths, input.parsed);
    if (input.command === 'index') return handleIndex(command, paths, input.parsed, input.workspaceRoot);
    if (input.command === 'search') return handleSearch(command, paths, input.parsed);
    if (input.command === 'context') return handleContext(command, paths, input.parsed, input.workspaceRoot);
    if (input.command === 'validate') return handleValidate(command, paths, input.repoRoot);
    if (input.command === 'doctor') return handleDoctor(command, paths);
    if (input.command === 'capture') return handleCapture(command, paths, input.parsed, input.workspaceRoot);
    if (input.command === 'checkpoint') return handleCheckpoint(command, paths, input.parsed, input.workspaceRoot);
    if (input.command === 'promote') return handlePromote(command, paths, input.parsed, input.workspaceRoot);
    if (input.command === 'report') return handleReport(command, paths, input.parsed);
    if (input.command === 'snapshot') return handleSnapshot(command, paths, input.parsed, input.workspaceRoot);

    return { ok: false, command, errors: [`Unknown memory command: ${input.command}`], warnings: [] };
  } catch (error) {
    return {
      ok: false,
      command,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: []
    };
  }
}

async function handleCheckpoint(
  command: string,
  paths: MemoryPaths,
  args: ParsedMemoryArgs,
  workspaceRoot: string
): Promise<MemoryCommandResult> {
  if (!args.bodyFile) {
    return { ok: false, command, errors: ['Checkpoint requires --body <markdown-file>.'], warnings: [] };
  }

  const body = await readText(path.resolve(args.bodyFile));
  if (!body.trim()) {
    return { ok: false, command, errors: ['Checkpoint body must not be empty.'], warnings: [] };
  }

  const projectId = args.project ?? path.basename(paths.projectRoot);
  const loopId = args.loop ?? (await inferDefaultLoop(workspaceRoot));
  const casePlan = await planCaseWrite({
    casesRoot: paths.casesRoot,
    title: args.title ?? `${projectId} Work Checkpoint`,
    projectId,
    loopId,
    runId: args.runId,
    date: new Date().toISOString().slice(0, 10),
    body
  });
  if (!args.write) {
    return { ok: true, command, errors: [], warnings: [], preview: true, planned: casePlan };
  }

  const written = await writeCase(casePlan);
  const index = await buildMemoryIndex({
    workspaceRoot,
    vaultRoot: paths.vaultRoot,
    learningRootName: relativeLearningRoot(paths),
    projectId
  });
  await writeMemoryIndexAtomic(paths.indexPath, index);

  const bundle = await loadMemoryContext({
    index,
    projectId,
    loopId,
    query: args.query,
    maxCharacters: args.maxCharacters ?? 12000
  });
  const date = new Date().toISOString().slice(0, 10);
  const snapshotPath = path.join(paths.projectRoot, 'snapshots', `${date}-project-memory-snapshot.md`);
  const sourceItems = bundle.included.filter((item) => !isSeedMemoryContent(item.content) && !isSnapshotMemoryPath(item.path));
  await mkdir(path.dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, renderProjectMemorySnapshot({
    projectId,
    loopId,
    date,
    vaultRoot: paths.vaultRoot,
    indexPath: paths.indexPath,
    included: sourceItems,
    notes: index.notes.filter((note) => note.projectId === projectId)
  }), 'utf8');

  const refreshed = await buildMemoryIndex({
    workspaceRoot,
    vaultRoot: paths.vaultRoot,
    learningRootName: relativeLearningRoot(paths),
    projectId
  });
  await writeMemoryIndexAtomic(paths.indexPath, refreshed);
  return { ok: true, command, errors: [], warnings: bundle.warnings, preview: false, written, snapshotPath, indexPath: paths.indexPath };
}

async function resolveCliMemoryPaths(workspaceRoot: string, args: ParsedMemoryArgs): Promise<MemoryPaths> {
  const memoryConfig = await resolveMemoryRootConfig(workspaceRoot);
  const memoryRoot = memoryConfig.memoryRoot;
  const vaultRoot = args.vault ? path.resolve(args.vault) : memoryConfig.memoryVaultRoot ?? inferVaultRoot(memoryRoot);
  const project = args.project ?? inferProjectId(memoryRoot) ?? 'default-project';
  return resolveMemoryProtocolPaths({
    workspaceRoot,
    vaultRoot,
    learningRootName: memoryConfig.memoryLearningRootName,
    projectId: project,
    loopId: args.loop
  });
}

function inferVaultRoot(memoryRoot: string): string {
  const marker = `${path.sep}88-学习${path.sep}`;
  const index = memoryRoot.indexOf(marker);
  return index >= 0 ? memoryRoot.slice(0, index) : memoryRoot;
}

function inferProjectId(memoryRoot: string): string | undefined {
  const parts = memoryRoot.split(path.sep);
  const markerIndex = parts.lastIndexOf('10-项目记忆');
  return markerIndex >= 0 ? parts[markerIndex + 1] : undefined;
}

async function handleInit(command: string, paths: MemoryPaths, args: ParsedMemoryArgs): Promise<MemoryCommandResult> {
  let templates = createMemoryTemplates({
    projectId: path.basename(paths.projectRoot),
    loopId: args.loop,
    date: new Date().toISOString().slice(0, 10),
    learningRootName: relativeLearningRoot(paths)
  });
  if (await hasExistingSeedCase(paths.casesRoot)) {
    templates = templates.filter((template) => !isDatedSeedCaseTemplate(template.path));
  }
  const planned = [];
  for (const template of templates) {
    const target = resolveSafeWritePath(paths.learningRoot, path.join(paths.vaultRoot, template.path));
    planned.push({ path: target, exists: await pathExists(target) });
  }

  if (!args.write) return { ok: true, command, errors: [], warnings: [], preview: true, planned };

  for (const template of templates) {
    const target = resolveSafeWritePath(paths.learningRoot, path.join(paths.vaultRoot, template.path));
    if ((await pathExists(target)) && !args.overwrite) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, template.content, 'utf8');
  }
  return { ok: true, command, errors: [], warnings: [], preview: false, planned };
}

async function hasExistingSeedCase(casesRoot: string): Promise<boolean> {
  try {
    const entries = await readdir(casesRoot, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}-seed-case\.md$/.test(entry.name));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function isDatedSeedCaseTemplate(templatePath: string): boolean {
  return /\/cases\/\d{4}-\d{2}-\d{2}-seed-case\.md$/.test(templatePath);
}

async function handleIndex(command: string, paths: MemoryPaths, args: ParsedMemoryArgs, workspaceRoot: string): Promise<MemoryCommandResult> {
  const index = await buildMemoryIndex({
    workspaceRoot,
    vaultRoot: paths.vaultRoot,
    learningRootName: relativeLearningRoot(paths),
    projectId: args.project
  });
  const summary = {
    indexPath: paths.indexPath,
    projects: index.projects.length,
    notes: index.notes.length,
    cases: index.cases.length,
    patterns: index.patterns.length
  };
  if (!args.write) {
    return { ok: true, command, errors: [], warnings: index.warnings.map((warning) => warning.message), preview: true, summary };
  }
  await writeMemoryIndexAtomic(paths.indexPath, index);
  return { ok: true, command, errors: [], warnings: index.warnings.map((warning) => warning.message), preview: false, summary };
}

async function handleSearch(command: string, paths: MemoryPaths, args: ParsedMemoryArgs): Promise<MemoryCommandResult> {
  const index = await readMemoryIndex(paths.indexPath, paths.vaultRoot);
  const matches = searchMemory(index, {
    query: args.query ?? '',
    project: args.project,
    type: args.type,
    tag: args.tag,
    confidence: args.confidence,
    limit: args.limit ?? 10
  }).map((match) => ({
    score: match.score,
    matchedFields: match.matchedFields,
    title: match.note.title,
    projectId: match.note.projectId,
    kind: match.note.kind,
    path: match.note.path,
    vaultRelativePath: match.note.vaultRelativePath,
    summary: match.note.summary
  }));
  return { ok: true, command, errors: [], warnings: [], matches };
}

async function handleContext(command: string, paths: MemoryPaths, args: ParsedMemoryArgs, workspaceRoot: string): Promise<MemoryCommandResult> {
  const index = await ensureIndex(paths, workspaceRoot, args);
  const projectId = args.project ?? path.basename(paths.projectRoot);
  const loopId = args.loop ?? (await inferDefaultLoop(workspaceRoot));
  const bundle = await loadMemoryContext({
    index,
    projectId,
    loopId,
    query: args.query,
    maxCharacters: args.maxCharacters ?? 12000
  });
  return { ok: true, command, errors: [], warnings: bundle.warnings, bundle };
}

async function handleValidate(command: string, paths: MemoryPaths, repoRoot: string): Promise<MemoryCommandResult> {
  const index = (await pathExists(paths.indexPath)) ? await readMemoryIndex(paths.indexPath, paths.vaultRoot) : undefined;
  const validation = await validateMemory({
    repoRoot,
    vaultRoot: paths.vaultRoot,
    learningRoot: paths.learningRoot,
    globalIndexRoot: paths.globalIndexRoot,
    projectRoot: paths.allProjectsRoot,
    index
  });
  return { ok: validation.ok, command, errors: validation.errors, warnings: validation.warnings };
}

async function handleDoctor(command: string, paths: MemoryPaths): Promise<MemoryCommandResult> {
  const index = await readMemoryIndex(paths.indexPath, paths.vaultRoot);
  const report = doctorMemory(index);
  return { ok: true, command, errors: [], warnings: report.warnings, report };
}

async function handleCapture(command: string, paths: MemoryPaths, args: ParsedMemoryArgs, workspaceRoot: string): Promise<MemoryCommandResult> {
  if (args.query !== 'case') {
    return { ok: false, command, errors: ['Only capture case is supported.'], warnings: [] };
  }
  const title = args.title ?? 'Untitled Memory Case';
  const body = args.bodyFile ? await readText(path.resolve(args.bodyFile)) : undefined;
  const plan = await planCaseWrite({
    casesRoot: paths.casesRoot,
    title,
    projectId: path.basename(paths.projectRoot),
    loopId: args.loop,
    runId: args.runId,
    date: new Date().toISOString().slice(0, 10),
    body
  });
  if (!args.write) return { ok: true, command, errors: [], warnings: [], preview: true, planned: plan };

  const written = await writeCase(plan);
  const index = await buildMemoryIndex({
    workspaceRoot,
    vaultRoot: paths.vaultRoot,
    learningRootName: relativeLearningRoot(paths)
  });
  await writeMemoryIndexAtomic(paths.indexPath, index);
  return { ok: true, command, errors: [], warnings: [], preview: false, written };
}

async function handlePromote(command: string, paths: MemoryPaths, args: ParsedMemoryArgs, workspaceRoot: string): Promise<MemoryCommandResult> {
  const index = await ensureIndex(paths, workspaceRoot, args);
  const targetCase = args.casePath
    ? index.cases.find((item) => item.path === path.resolve(args.casePath ?? '') || item.vaultRelativePath === args.casePath)
    : index.cases[0];
  if (!targetCase) return { ok: false, command, errors: ['No case found to promote.'], warnings: [] };

  const title = args.title ?? `${targetCase.title} Pattern`;
  if (!args.confirm) {
    return { ok: true, command, errors: [], warnings: [], preview: true, planned: { title, sourceCase: targetCase.vaultRelativePath } };
  }
  const patternPath = await writePattern({
    patternsRoot: paths.patternsRoot,
    globalPatternsPath: path.join(paths.globalIndexRoot, 'patterns.md'),
    title,
    projectId: path.basename(paths.projectRoot),
    date: new Date().toISOString().slice(0, 10),
    sourceCases: [targetCase]
  });
  const refreshed = await buildMemoryIndex({
    workspaceRoot,
    vaultRoot: paths.vaultRoot,
    learningRootName: relativeLearningRoot(paths)
  });
  await writeMemoryIndexAtomic(paths.indexPath, refreshed);
  return { ok: true, command, errors: [], warnings: [], preview: false, patternPath };
}

async function handleReport(command: string, paths: MemoryPaths, args: ParsedMemoryArgs): Promise<MemoryCommandResult> {
  const index = await readMemoryIndex(paths.indexPath, paths.vaultRoot);
  const report = doctorMemory(index);
  const content = `# Memory Report\n\n- Projects: ${report.stats.projects}\n- Notes: ${report.stats.notes}\n- Cases: ${report.stats.cases}\n- Patterns: ${report.stats.patterns}\n- Score: ${report.score}\n\n## Warnings\n\n${report.warnings.map((warning) => `- ${warning}`).join('\n')}\n`;
  const reportPath = path.join(paths.reportsRoot, `${new Date().toISOString().slice(0, 10)}-memory-report.md`);
  if (!args.write) return { ok: true, command, errors: [], warnings: report.warnings, preview: true, reportPath, content };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, content, 'utf8');
  return { ok: true, command, errors: [], warnings: report.warnings, preview: false, reportPath };
}

async function handleSnapshot(
  command: string,
  paths: MemoryPaths,
  args: ParsedMemoryArgs,
  workspaceRoot: string
): Promise<MemoryCommandResult> {
  const projectId = args.project ?? path.basename(paths.projectRoot);
  const loopId = args.loop ?? (await inferDefaultLoop(workspaceRoot));
  const index = await ensureIndex(paths, workspaceRoot, args);
  const bundle = await loadMemoryContext({
    index,
    projectId,
    loopId,
    query: args.query,
    maxCharacters: args.maxCharacters ?? 12000
  });
  const date = new Date().toISOString().slice(0, 10);
  const snapshotPath = path.join(paths.projectRoot, 'snapshots', `${date}-project-memory-snapshot.md`);
  const sourceItems = bundle.included.filter((item) => !isSeedMemoryContent(item.content) && !isSnapshotMemoryPath(item.path));
  const content = renderProjectMemorySnapshot({
    projectId,
    loopId,
    date,
    vaultRoot: paths.vaultRoot,
    indexPath: paths.indexPath,
    included: sourceItems,
    notes: index.notes.filter((note) => note.projectId === projectId)
  });
  const included = sourceItems.map((item) => ({
    title: item.title,
    kind: item.kind,
    path: item.path
  }));

  if (!args.write) {
    return { ok: true, command, errors: [], warnings: bundle.warnings, preview: true, snapshotPath, content, included };
  }

  await mkdir(path.dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, content, 'utf8');
  const refreshed = await buildMemoryIndex({
    workspaceRoot,
    vaultRoot: paths.vaultRoot,
    learningRootName: relativeLearningRoot(paths),
    projectId
  });
  await writeMemoryIndexAtomic(paths.indexPath, refreshed);
  return { ok: true, command, errors: [], warnings: bundle.warnings, preview: false, snapshotPath, indexPath: paths.indexPath, included };
}

function renderProjectMemorySnapshot(input: {
  projectId: string;
  loopId?: string;
  date: string;
  vaultRoot: string;
  indexPath: string;
  included: Array<{ title: string; kind: string; path: string; content: string }>;
  notes: Array<{ title: string; kind: string; path: string; summary: string; status?: string }>;
}): string {
  const summaries = input.notes.filter(
    (note) => note.status !== 'seed' && !isSnapshotMemoryPath(note.path) && note.summary.trim().length > 0
  );
  const sourceList = input.included.length
    ? input.included.map((item) => `- \`${relativeToVault(input.vaultRoot, item.path)}\` - ${item.title} (${item.kind})`).join('\n')
    : '- 暂无非 seed 来源文件。\n- No non-seed source files yet.';
  const summaryList = summaries.length
    ? summaries
        .map((note) => `- \`${relativeToVault(input.vaultRoot, note.path)}\` - ${note.summary.replace(/\n/g, ' ')}`)
        .join('\n')
    : '- 暂无可摘要的项目记忆。\n- No summarizable project memory yet.';
  const contextContent = input.included
    .map((item) => `### ${item.title}\n\n来源 / Source: \`${relativeToVault(input.vaultRoot, item.path)}\`\n\n${item.content.trim()}`)
    .join('\n\n---\n\n');

  return `---\ntitle: "${input.projectId} 项目记忆快照"\nstatus: active\ntype: report\ntags:\n  - status/active\n  - type/memory-snapshot\n  - project/${input.projectId}\ndomain:\n  - ai-engineering\nsource: local\naccess: private\nconfidence: medium\ncreated_at: ${input.date}\nupdated_at: ${input.date}\nproject: ${input.projectId}\n${input.loopId ? `loop: ${input.loopId}\n` : ''}---\n\n# ${input.projectId} 项目记忆快照 / ${input.projectId} Project Memory Snapshot\n\n## 中文\n\n这份快照由 \`memory snapshot\` 生成，用于把当前小白项目记忆明确落到 Obsidian 项目目录中。它汇总项目入口、项目画像、当前上下文、loop 状态和 inbox 等可读记忆来源。\n\n## English\n\nThis snapshot is generated by \`memory snapshot\` so the current Xiaobai project memory is explicitly persisted in the Obsidian project directory. It summarizes readable memory sources such as the project entry, profile, active context, loop state, and inbox files.\n\n## 元信息 / Metadata\n\n- 项目 / Project: \`${input.projectId}\`\n${input.loopId ? `- Loop: \`${input.loopId}\`\n` : ''}- 日期 / Date: \`${input.date}\`\n- 索引 / Index: \`${relativeToVault(input.vaultRoot, input.indexPath)}\`\n\n## 来源文件 / Source Files\n\n${sourceList}\n\n## 记忆摘要 / Memory Summaries\n\n${summaryList}\n\n## 上下文内容 / Context Content\n\n${contextContent || '暂无上下文内容。\n\nNo context content yet.'}\n`;
}

function isSeedMemoryContent(content: string): boolean {
  return /(^|\n)status:\s*seed(\n|$)/.test(content) && /(^|\n)# Seed (Case|Pattern)(\n|$)/.test(content);
}

function isSnapshotMemoryPath(filePath: string): boolean {
  return filePath.split(path.sep).includes('snapshots') && /-project-memory-snapshot\.md$/.test(filePath);
}

function relativeToVault(vaultRoot: string, filePath: string): string {
  return path.relative(vaultRoot, filePath).replaceAll(path.sep, '/');
}

async function ensureIndex(paths: MemoryPaths, workspaceRoot: string, args: ParsedMemoryArgs) {
  if (await pathExists(paths.indexPath)) return readMemoryIndex(paths.indexPath, paths.vaultRoot);
  const index = await buildMemoryIndex({
    workspaceRoot,
    vaultRoot: paths.vaultRoot,
    learningRootName: relativeLearningRoot(paths),
    projectId: args.project
  });
  await writeMemoryIndexAtomic(paths.indexPath, index);
  return index;
}

function relativeLearningRoot(paths: MemoryPaths): string {
  return path.relative(paths.vaultRoot, paths.learningRoot).replaceAll(path.sep, '/');
}

async function inferDefaultLoop(workspaceRoot: string): Promise<string | undefined> {
  try {
    const loopPath = await findLoopSpec(workspaceRoot, undefined);
    const loop = await readYamlFile<LoopSpec>(loopPath);
    return loop.metadata.id;
  } catch {
    return undefined;
  }
}

function parseMemoryArgs(command: string, argv: string[]): ParsedMemoryArgs {
  const parsed: ParsedMemoryArgs = { json: false, write: false, confirm: false, overwrite: false };
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--write') parsed.write = true;
    else if (arg === '--confirm') parsed.confirm = true;
    else if (arg === '--overwrite') parsed.overwrite = true;
    else if (arg === '--vault') parsed.vault = requireValue(argv, ++index, arg);
    else if (arg === '--project') parsed.project = requireValue(argv, ++index, arg);
    else if (arg === '--loop') parsed.loop = requireValue(argv, ++index, arg);
    else if (arg === '--query') parsed.query = requireValue(argv, ++index, arg);
    else if (arg === '--title') parsed.title = requireValue(argv, ++index, arg);
    else if (arg === '--body') parsed.bodyFile = requireValue(argv, ++index, arg);
    else if (arg === '--case') parsed.casePath = requireValue(argv, ++index, arg);
    else if (arg === '--run-id') parsed.runId = requireValue(argv, ++index, arg);
    else if (arg === '--maxCharacters') parsed.maxCharacters = Number(requireValue(argv, ++index, arg));
    else if (arg === '--limit') parsed.limit = Number(requireValue(argv, ++index, arg));
    else if (arg === '--type') parsed.type = requireValue(argv, ++index, arg);
    else if (arg === '--tag') parsed.tag = requireValue(argv, ++index, arg);
    else if (arg === '--confidence') parsed.confidence = requireValue(argv, ++index, arg);
    else if (arg.startsWith('--')) throw new Error(`Unknown memory argument: ${arg}`);
    else positionals.push(arg);
  }
  if (command === 'search' && !parsed.query) parsed.query = positionals.join(' ');
  if (command === 'capture' && !parsed.query) parsed.query = positionals[0];
  return parsed;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function printHuman(result: MemoryCommandResult): void {
  if (!result.ok) {
    process.stderr.write(`${result.command} failed:\n${result.errors.map((error) => `- ${error}`).join('\n')}\n`);
    return;
  }
  process.stdout.write(`${result.command}: ok\n`);
  if (result.preview) process.stdout.write('Mode: preview\n');
  if (result.warnings.length) process.stdout.write(`Warnings:\n${result.warnings.map((warning) => `- ${warning}`).join('\n')}\n`);
  for (const [key, value] of Object.entries(result)) {
    if (['ok', 'command', 'errors', 'warnings', 'preview'].includes(key)) continue;
    process.stdout.write(`${key}: ${JSON.stringify(value, null, 2)}\n`);
  }
}
