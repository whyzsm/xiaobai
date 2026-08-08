import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const WORKSPACE_ROOT = path.join(PROJECT_ROOT, 'workspace');
const DEFAULT_OUTPUT = path.join(WORKSPACE_ROOT, '.local/monitoring/monitor-data.json');

function relativeToProject(filePath) {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/');
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function readYaml(filePath) {
  return parseYaml(readText(filePath));
}

function listFiles(directory, predicate = () => true) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function parseAheadBehind() {
  const raw = runGit(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  if (!raw) return { ahead: null, behind: null, tracking: false };
  const [ahead, behind] = raw.split(/\s+/).map(Number);
  return {
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
    tracking: true,
  };
}

function collectGit() {
  const status = runGit(['status', '--short', '-uall']) || '';
  const aheadBehind = parseAheadBehind();
  return {
    branch: runGit(['branch', '--show-current']) || 'detached',
    head: runGit(['rev-parse', 'HEAD']) || null,
    shortHead: runGit(['rev-parse', '--short', 'HEAD']) || null,
    dirty: status.length > 0,
    changedFiles: status ? status.split('\n').filter(Boolean).length : 0,
    ...aheadBehind,
  };
}

function loadStructuredFiles(files, warnings) {
  return files.flatMap((filePath) => {
    try {
      return [{ filePath, value: readYaml(filePath) }];
    } catch {
      warnings.push({
        code: 'structured_file_unreadable',
        source: relativeToProject(filePath),
        message: 'The structured source could not be parsed.',
      });
      return [];
    }
  });
}

function collectAgents(warnings) {
  const agentDirectory = path.join(WORKSPACE_ROOT, 'agents');
  const files = listFiles(agentDirectory, (name) => name.endsWith('.yaml'));
  const entries = loadStructuredFiles(files, warnings);
  const agents = [];
  const harnesses = [];

  for (const { filePath, value } of entries) {
    const tools = value?.tools || {};
    const item = {
      id: value?.id || value?.metadata?.id || path.basename(filePath, '.yaml'),
      kind: value?.kind || 'Unknown',
      role: value?.role || null,
      stance: value?.stance || null,
      file: relativeToProject(filePath),
      allowedTools: Array.isArray(tools.allow) ? tools.allow.length : 0,
      deniedTools: Array.isArray(tools.deny) ? tools.deny.length : 0,
    };
    if (value?.kind === 'Harness') harnesses.push(item);
    else agents.push(item);
  }

  return { agents, harnesses };
}

function normalizeStage(stage, loopFile) {
  return {
    id: stage?.id || 'unnamed-stage',
    kind: stage?.kind || 'unspecified',
    gate: stage?.gate || 'unspecified',
    owner: stage?.agent || stage?.evaluator || (stage?.gate === 'manual' ? 'human' : 'unassigned'),
    agent: stage?.agent || null,
    evaluator: stage?.evaluator || null,
    harness: stage?.harness || null,
    requiredChecks: Array.isArray(stage?.requiredChecks) ? stage.requiredChecks : [],
    requiredBefore: Array.isArray(stage?.requiredBefore) ? stage.requiredBefore : [],
    outputs: Array.isArray(stage?.outputs) ? stage.outputs : [],
    evidence: `${loopFile}#${stage?.id || 'unnamed-stage'}`,
  };
}

function collectLoops(warnings) {
  const loopDirectory = path.join(WORKSPACE_ROOT, 'loops');
  const files = listFiles(loopDirectory, (name) => name.endsWith('.yaml'));
  return loadStructuredFiles(files, warnings).map(({ filePath, value }) => {
    const file = relativeToProject(filePath);
    const stages = Array.isArray(value?.workflow?.stages)
      ? value.workflow.stages.map((stage) => normalizeStage(stage, file))
      : [];
    return {
      id: value?.metadata?.id || path.basename(filePath, '.loop.yaml'),
      name: value?.metadata?.name || value?.metadata?.id || path.basename(filePath),
      owner: value?.metadata?.owner || 'unassigned',
      file,
      schedule: {
        type: value?.schedule?.type || 'manual',
        expression: value?.schedule?.expression || 'on-demand',
        timezone: value?.schedule?.timezone || null,
      },
      project: value?.handoff?.project || null,
      orchestrator: value?.orchestrator?.agent || null,
      generator: value?.generator?.agent || null,
      harness: value?.generator?.harness || null,
      evaluator: value?.verification?.evaluator || null,
      allowSelfReview: value?.verification?.allowSelfReview === true,
      requiredChecks: Array.isArray(value?.verification?.requiredChecks)
        ? value.verification.requiredChecks
        : [],
      humanGates: Array.isArray(value?.humanGate?.requiredBefore)
        ? value.humanGate.requiredBefore
        : [],
      budget: {
        maxTokensPerRun: value?.budget?.maxTokensPerRun ?? null,
        maxRunsPerDay: value?.budget?.maxRunsPerDay ?? null,
        maxRetriesPerTask: value?.budget?.maxRetriesPerTask ?? null,
        maxParallelTasks: value?.budget?.maxParallelTasks ?? null,
      },
      stages,
    };
  });
}

function resolveMount(projectDirectory, configuredPath) {
  if (typeof configuredPath !== 'string' || configuredPath.length === 0) return false;
  return fs.existsSync(path.resolve(projectDirectory, configuredPath));
}

function collectProjects(warnings) {
  const projectsDirectory = path.join(WORKSPACE_ROOT, 'projects');
  if (!fs.existsSync(projectsDirectory)) return [];
  const projectFiles = fs.readdirSync(projectsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(projectsDirectory, entry.name, '.loop/project.yaml'))
    .filter((filePath) => fs.existsSync(filePath))
    .sort((left, right) => left.localeCompare(right));

  return loadStructuredFiles(projectFiles, warnings).map(({ filePath, value }) => {
    const projectDirectory = path.dirname(path.dirname(filePath));
    const repositories = Array.isArray(value?.repositories) ? value.repositories : [];
    const repositoryStates = repositories.map((repository) => ({
      id: repository?.id || repository?.name || 'unnamed-repository',
      name: repository?.name || repository?.id || 'Unnamed repository',
      mounted: resolveMount(projectDirectory, repository?.mount),
    }));
    const backgroundConfigured = Boolean(value?.background);
    const backgroundMounted = backgroundConfigured
      ? resolveMount(projectDirectory, value.background?.mount)
      : false;
    return {
      id: value?.id || path.basename(projectDirectory),
      name: value?.name || value?.id || path.basename(projectDirectory),
      kind: value?.kind || 'Project',
      file: relativeToProject(filePath),
      defaultBranch: value?.defaultBranch || null,
      background: {
        configured: backgroundConfigured,
        mounted: backgroundMounted,
        name: value?.background?.name || null,
      },
      repositories: repositoryStates,
      repositoryCount: repositoryStates.length,
      mountedRepositoryCount: repositoryStates.filter((repository) => repository.mounted).length,
    };
  });
}

function countJsonl(filePath) {
  if (!fs.existsSync(filePath)) return { count: 0, last: null };
  const lines = readText(filePath).split(/\r?\n/).filter((line) => line.trim().length > 0);
  let last = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      last = JSON.parse(lines[index]);
      break;
    } catch {
      continue;
    }
  }
  return { count: lines.length, last };
}

function collectMemory(loopIds, warnings) {
  const localConfigPath = path.join(WORKSPACE_ROOT, 'workspace.local.yaml');
  let memoryRoot = path.join(WORKSPACE_ROOT, 'memory');
  let source = 'workspace-default';

  if (fs.existsSync(localConfigPath)) {
    try {
      const localConfig = readYaml(localConfigPath);
      if (typeof localConfig?.memoryRoot === 'string' && localConfig.memoryRoot.length > 0) {
        memoryRoot = path.resolve(localConfig.memoryRoot);
        source = 'local-override';
      }
    } catch {
      warnings.push({
        code: 'memory_config_unreadable',
        source: 'workspace/workspace.local.yaml',
        message: 'The machine-local memory configuration could not be parsed.',
      });
    }
  }

  const rootAvailable = fs.existsSync(memoryRoot);
  const loopDirectory = path.join(memoryRoot, 'loops');
  const directoryLoopIds = fs.existsSync(loopDirectory)
    ? fs.readdirSync(loopDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    : [];
  const ids = [...new Set([...loopIds, ...directoryLoopIds])].sort();

  const loops = ids.map((loopId) => {
    const root = path.join(loopDirectory, loopId);
    const runs = countJsonl(path.join(root, 'runs.jsonl'));
    const findings = countJsonl(path.join(root, 'findings.jsonl'));
    const metrics = countJsonl(path.join(root, 'metrics.jsonl'));
    return {
      id: loopId,
      available: fs.existsSync(root),
      runs: runs.count,
      findings: findings.count,
      metrics: metrics.count,
      lastRunAt: runs.last?.createdAt || runs.last?.timestamp || null,
      lastRunStatus: runs.last?.status || null,
    };
  });

  return {
    source,
    rootAvailable,
    loops,
    totals: loops.reduce((totals, loop) => ({
      runs: totals.runs + loop.runs,
      findings: totals.findings + loop.findings,
      metrics: totals.metrics + loop.metrics,
    }), { runs: 0, findings: 0, metrics: 0 }),
  };
}

function summarizeTypes(items, key) {
  const counts = new Map();
  for (const item of items) {
    const type = item?.[key] || 'unknown';
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type));
}

function collectGraph(git, warnings) {
  const graphPath = path.join(PROJECT_ROOT, '.understand-anything/knowledge-graph.json');
  const metaPath = path.join(PROJECT_ROOT, '.understand-anything/meta.json');
  if (!fs.existsSync(graphPath)) {
    return {
      status: 'missing',
      file: '.understand-anything/knowledge-graph.json',
      nodes: 0,
      edges: 0,
      analyzedAt: null,
      analyzedCommit: null,
      stale: null,
      nodeTypes: [],
      edgeTypes: [],
    };
  }

  try {
    const graph = readJson(graphPath);
    const meta = fs.existsSync(metaPath) ? readJson(metaPath) : {};
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph?.edges) ? graph.edges : [];
    const analyzedCommit = graph?.project?.gitCommitHash || meta?.gitCommitHash || null;
    return {
      status: 'ok',
      file: relativeToProject(graphPath),
      nodes: nodes.length,
      edges: edges.length,
      analyzedAt: graph?.project?.analyzedAt || meta?.lastAnalyzedAt || null,
      analyzedCommit,
      stale: Boolean(analyzedCommit && git.head && analyzedCommit !== git.head),
      analyzedFiles: meta?.analyzedFiles ?? null,
      nodeTypes: summarizeTypes(nodes, 'type'),
      edgeTypes: summarizeTypes(edges, 'type'),
    };
  } catch {
    warnings.push({
      code: 'knowledge_graph_unreadable',
      source: relativeToProject(graphPath),
      message: 'The knowledge graph could not be parsed.',
    });
    return {
      status: 'invalid',
      file: relativeToProject(graphPath),
      nodes: 0,
      edges: 0,
      analyzedAt: null,
      analyzedCommit: null,
      stale: null,
      nodeTypes: [],
      edgeTypes: [],
    };
  }
}

function collectConnectors(warnings) {
  const connectorDirectory = path.join(WORKSPACE_ROOT, 'connectors');
  const files = listFiles(connectorDirectory, (name) => name.endsWith('.yaml'));
  return loadStructuredFiles(files, warnings).map(({ filePath, value }) => ({
    id: value?.id || value?.metadata?.id || path.basename(filePath, '.yaml'),
    kind: value?.kind || 'Connector',
    file: relativeToProject(filePath),
  }));
}

function buildTiming(loops) {
  return {
    instrumented: false,
    status: 'unmeasured',
    waitingReason: 'missing_instrumentation',
    stages: loops.flatMap((loop) => loop.stages.map((stage) => ({
      loopId: loop.id,
      stageId: stage.id,
      stageKind: stage.kind,
      owner: stage.owner,
      status: 'unmeasured',
      enteredAt: null,
      firstActionAt: null,
      exitedAt: null,
      durationMs: null,
      activeMs: null,
      waitingMs: null,
      waitingReason: 'missing_instrumentation',
      evidence: stage.evidence,
    }))),
  };
}

function buildEvaluation(loops, agents, timing) {
  const evaluators = agents.filter((agent) => agent.role === 'checker');
  const selfReviewViolations = loops.filter((loop) => loop.allowSelfReview).map((loop) => loop.id);
  const missingStageContracts = loops.filter((loop) => loop.stages.length === 0).map((loop) => loop.id);
  const observabilityGaps = [];
  if (!timing.instrumented) {
    observabilityGaps.push({
      code: 'missing_stage_timing_instrumentation',
      status: 'unmeasured',
      nextAction: 'Add runtime-local append-only stage timing events before reporting efficiency.',
    });
  }
  for (const loopId of missingStageContracts) {
    observabilityGaps.push({
      code: 'missing_workflow_stage_contract',
      status: 'unmeasured',
      loopId,
      nextAction: 'Declare workflow stages, owners, outputs, and checks in the loop spec.',
    });
  }
  return {
    policy: 'loop-engineering/docs/xiaobai-evaluation-engineering-system.md',
    evaluatorCount: evaluators.length,
    evaluatorIds: evaluators.map((agent) => agent.id),
    loopsWithHumanGate: loops.filter((loop) => loop.humanGates.length > 0).length,
    allowSelfReviewViolations: selfReviewViolations,
    observabilityGaps,
  };
}

function collectInventory({ loops, agents, harnesses, connectors, projects, memory, graph }) {
  const repositories = projects.reduce((total, project) => total + project.repositoryCount, 0);
  const mountedRepositories = projects.reduce(
    (total, project) => total + project.mountedRepositoryCount,
    0,
  );
  return {
    loops: loops.length,
    agents: agents.length,
    harnesses: harnesses.length,
    connectors: connectors.length,
    projects: projects.length,
    repositories,
    mountedRepositories,
    memoryRuns: memory.totals.runs,
    graphNodes: graph.nodes,
  };
}

export function buildSnapshot() {
  const warnings = [];
  const git = collectGit();
  const { agents, harnesses } = collectAgents(warnings);
  const loops = collectLoops(warnings);
  const projects = collectProjects(warnings);
  const connectors = collectConnectors(warnings);
  const memory = collectMemory(loops.map((loop) => loop.id), warnings);
  const graph = collectGraph(git, warnings);
  const timing = buildTiming(loops);
  const evaluation = buildEvaluation(loops, agents, timing);

  if (!memory.rootAvailable) {
    warnings.push({
      code: 'memory_root_unavailable',
      source: memory.source,
      message: 'The configured memory root is not available on this machine.',
    });
  }
  if (graph.stale) {
    warnings.push({
      code: 'knowledge_graph_stale',
      source: graph.file,
      message: 'The knowledge graph commit does not match the current Git HEAD.',
    });
  }
  for (const gap of evaluation.observabilityGaps) {
    warnings.push({
      code: gap.code,
      source: gap.loopId || evaluation.policy,
      message: gap.nextAction,
    });
  }

  const inventory = collectInventory({
    loops,
    agents,
    harnesses,
    connectors,
    projects,
    memory,
    graph,
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: 'workspace/monitoring/scripts/generate-monitor-data.mjs',
    system: {
      id: 'xiaobai',
      name: '小白 Agent Ops',
      scope: 'Loop Engineering operating space',
    },
    git,
    inventory,
    loops,
    agents,
    harnesses,
    connectors,
    projects,
    memory,
    graph,
    timing,
    evaluation,
    operations: [
      { id: 'dashboard', label: '启动仪表盘', command: 'npm run dashboard:xiaobai', approvalRequired: false },
      { id: 'dry-run', label: '执行 Dry Run', command: 'npm run dry-run', approvalRequired: false },
      { id: 'simulate', label: '执行模拟', command: 'npm run simulate', approvalRequired: false },
      { id: 'memory-audit', label: '审计今日记忆', command: 'npm run memory:audit-today -- --json', approvalRequired: false },
      { id: 'validate', label: '工程校验', command: 'npm run validate', approvalRequired: true },
      { id: 'test', label: '完整测试', command: 'npm test', approvalRequired: true },
    ],
    warnings,
    health: warnings.length > 0 ? 'attention' : 'ok',
  };
}

export function writeSnapshot(snapshot, outputPath = DEFAULT_OUTPUT) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return outputPath;
}

function parseArgs(argv) {
  const args = { output: DEFAULT_OUTPUT, stdout: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--stdout') args.stdout = true;
    if (argv[index] === '--output' && argv[index + 1]) {
      args.output = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = buildSnapshot();
  if (args.stdout) {
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    return;
  }
  const outputPath = writeSnapshot(snapshot, args.output);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    output: relativeToProject(outputPath),
    generatedAt: snapshot.generatedAt,
    health: snapshot.health,
    warnings: snapshot.warnings.length,
  })}\n`);
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) main();
