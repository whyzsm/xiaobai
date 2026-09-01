import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { buildMonitorProjection } from '../../../loop-engineering/packages/xiaobai-dsh-plugin/lib/projection.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const WORKSPACE_ROOT = path.join(PROJECT_ROOT, 'workspace');
const DEFAULT_OUTPUT = path.join(WORKSPACE_ROOT, '.local/monitoring/monitor-data.json');
const require = createRequire(import.meta.url);
let timingProjector;
let timingAnalyzer;

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

function normalizeStage(stage, loopFile, loopOwner) {
  const owner = stage?.agent || stage?.evaluator || loopOwner || 'unassigned';
  return {
    id: stage?.id || 'unnamed-stage',
    kind: stage?.kind || 'unspecified',
    gate: stage?.gate || 'unspecified',
    owner: owner.replace(/\.agent\.yaml$/, ''),
    agent: stage?.agent || null,
    evaluator: stage?.evaluator || null,
    harness: stage?.harness || null,
    dependsOn: Array.isArray(stage?.dependsOn) ? stage.dependsOn : [],
    requiredChecks: Array.isArray(stage?.requiredChecks) ? stage.requiredChecks : [],
    requiredGates: Array.isArray(stage?.requiredGates) ? stage.requiredGates : [],
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
      ? value.workflow.stages.map((stage) => normalizeStage(stage, file, value?.metadata?.owner))
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
      gateDefinitions: Array.isArray(value?.humanGate?.gates) ? value.humanGate.gates : [],
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
  if (!fs.existsSync(projectsDirectory)) return { projects: [], projectGroups: [] };
  const projects = [];
  const projectGroups = [];
  const projectFiles = fs.readdirSync(projectsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(projectsDirectory, entry.name, '.loop/project.yaml'))
    .filter((filePath) => fs.existsSync(filePath))
    .sort((left, right) => left.localeCompare(right));

  const sources = loadStructuredFiles(projectFiles, warnings);
  const standaloneIds = new Set(sources
    .filter(({ value }) => value?.kind === 'Project' && value?.role === 'standalone')
    .map(({ value }) => value.id));
  const catalogs = new Map(sources
    .filter(({ value }) => value?.role === 'catalog')
    .map((source) => [source.value.id, source]));

  for (const { filePath, value } of sources) {
    const projectDirectory = path.dirname(path.dirname(filePath));
    if (value?.kind === 'Project' && value?.role === 'standalone') {
      const catalog = catalogs.get(value.catalogId || value.parentGroup);
      if (!catalog) {
        warnings.push({
          code: 'standalone_catalog_missing',
          source: relativeToProject(filePath),
          message: 'The standalone Project references a missing catalog.',
        });
        continue;
      }
      const effective = materializeMonitorProject(value, catalog.value, catalog.filePath, filePath);
      projects.push(projectSummary(filePath, effective, {
        parentGroupId: effective.parentGroup || catalog.value.id,
        sharedContextId: effective.sharedContext || catalog.value.sharedContext,
      }));
      continue;
    }
    if (value?.kind === 'ProjectGroup' && value.children?.directory) {
      const group = groupSummary(filePath, value, projectDirectory, warnings);
      const childRoot = path.resolve(projectDirectory, value.children.directory);
      const childFiles = fs.existsSync(childRoot)
        ? fs.readdirSync(childRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(childRoot, entry.name, '.loop/project.yaml'))
          .filter((childPath) => fs.existsSync(childPath))
          .sort((left, right) => left.localeCompare(right))
        : [];
      const children = loadStructuredFiles(childFiles, warnings);
      const referencedStandaloneIds = sources
        .filter(({ value: candidate }) => candidate?.kind === 'Project' && candidate?.role === 'standalone'
          && (candidate.catalogId || candidate.parentGroup) === group.groupId)
        .map(({ value: candidate }) => candidate.id);
      group.childProjectIds = [...new Set([
        ...referencedStandaloneIds,
        ...children
          .map(({ value: child }) => child?.kind === 'Project' && !standaloneIds.has(child.id) ? child.id : null)
          .filter(Boolean),
      ])]
        .filter(Boolean);
      group.standaloneProjectIds = [...referencedStandaloneIds].sort();
      group.childCount = group.childProjectIds.length;
      projectGroups.push(group);
      for (const { filePath: childPath, value: child } of children) {
        if (child?.kind !== 'Project') {
          warnings.push({
            code: 'project_child_invalid',
            source: relativeToProject(childPath),
            message: 'The declared ProjectGroup child is not a Project configuration.',
          });
          continue;
        }
        if (standaloneIds.has(child.id)) continue;
        projects.push(projectSummary(childPath, child, {
          parentGroupId: group.groupId,
          sharedContextId: group.sharedContextId,
          backgroundSourceRoot: projectDirectory,
          background: value.background,
        }));
      }
      continue;
    }
    projects.push(projectSummary(filePath, value));
  }
  return { projects, projectGroups };
}

function groupSummary(filePath, value, projectDirectory, warnings) {
  const background = value?.background;
  const mounted = Boolean(background?.mount) && resolveMount(projectDirectory, background.mount);
  if (background?.mount && !mounted) {
    warnings.push({
      code: 'shared_background_unavailable',
      source: relativeToProject(filePath),
      message: 'The shared ProjectGroup background mount is unavailable.',
    });
  }
  const groupId = value?.id || path.basename(projectDirectory);
  return {
    groupId,
    name: value?.name || groupId,
    kind: 'ProjectGroup',
    role: value?.role || 'group',
    catalogId: value?.catalogId || null,
    file: relativeToProject(filePath),
    source: relativeToProject(filePath),
    childrenDirectory: value?.children?.directory || null,
    sharedContextId: typeof value?.sharedContext === 'string' ? value.sharedContext : value?.sharedContext?.id || value?.children?.sharedContext || null,
    sharedBackgroundStatus: background?.mount ? (mounted ? 'locked' : 'unavailable') : 'missing',
    sharedBackground: {
      configured: Boolean(background),
      mounted,
      name: background?.name || null,
    },
    childProjectIds: [],
    standaloneProjectIds: [],
    childCount: 0,
  };
}

function materializeMonitorProject(project, catalog, catalogFilePath, projectFilePath) {
  const catalogDirectory = path.dirname(path.dirname(catalogFilePath));
  const projectDirectory = path.dirname(path.dirname(projectFilePath));
  const background = catalog?.background
    ? { ...catalog.background, mount: path.relative(projectDirectory, path.resolve(catalogDirectory, catalog.background.mount)).split(path.sep).join('/') }
    : undefined;
  const discoverySkills = catalog?.discoverySkills
    ? Object.fromEntries(Object.entries(catalog.discoverySkills).map(([id, value]) => [id, path.relative(projectDirectory, path.resolve(catalogDirectory, value)).split(path.sep).join('/')]))
    : undefined;
  const skill = catalog?.skill ? path.relative(projectDirectory, path.resolve(catalogDirectory, catalog.skill)).split(path.sep).join('/') : undefined;
  return {
    ...catalog,
    ...project,
    role: 'standalone',
    catalogId: project.catalogId || catalog?.id,
    parentGroup: project.parentGroup || catalog?.id,
    ...(project.background ? {} : background ? { background } : {}),
    ...(project.discoverySkills ? {} : discoverySkills ? { discoverySkills } : {}),
    ...(project.skill ? {} : skill ? { skill } : {}),
    ...(project.sharedContext ? {} : catalog?.sharedContext ? { sharedContext: catalog.sharedContext } : {}),
  };
}

function projectSummary(filePath, value, metadata = {}) {
  const projectDirectory = path.dirname(path.dirname(filePath));
    const repositories = Array.isArray(value?.repositories) ? value.repositories : [];
    const repositoryStates = repositories.map((repository) => ({
      id: repository?.id || repository?.name || 'unnamed-repository',
      name: repository?.name || repository?.id || 'Unnamed repository',
      mounted: resolveMount(projectDirectory, repository?.mount),
    }));
    const background = value?.background || metadata.background;
    const backgroundConfigured = Boolean(background);
    const backgroundMounted = backgroundConfigured
      ? resolveMount(metadata.backgroundSourceRoot || projectDirectory, background?.mount)
      : false;
    return {
      id: value?.id || path.basename(projectDirectory),
      name: value?.name || value?.id || path.basename(projectDirectory),
      kind: value?.kind || 'Project',
      role: value?.role || null,
      catalogId: metadata.catalogId || value?.catalogId || null,
      file: relativeToProject(filePath),
      defaultBranch: value?.defaultBranch || null,
      background: {
        configured: backgroundConfigured,
        mounted: backgroundMounted,
        name: background?.name || null,
      },
      repositories: repositoryStates,
      repositoryCount: repositoryStates.length,
      mountedRepositoryCount: repositoryStates.filter((repository) => repository.mounted).length,
      parentGroupId: metadata.parentGroupId || null,
      sharedContextId: metadata.sharedContextId || null,
      repositoryBindingStatus: repositoryStates.length === 1
        ? repositoryStates[0].mounted ? 'locked' : 'unavailable'
        : repositoryStates.length === 0 ? 'missing' : 'invalid',
      sharedBackgroundStatus: backgroundConfigured ? (backgroundMounted ? 'locked' : 'unavailable') : 'missing',
    };
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

function resolveMonitorMemoryRoot(warnings, override) {
  const localConfigPath = path.join(WORKSPACE_ROOT, 'workspace.local.yaml');
  let memoryRoot = path.join(WORKSPACE_ROOT, 'memory');
  let source = 'workspace-default';

  if (override) {
    memoryRoot = path.resolve(override);
    source = 'command-override';
  } else if (fs.existsSync(localConfigPath)) {
    try {
      const localConfig = readYaml(localConfigPath);
      if (typeof localConfig?.memoryRoot === 'string' && localConfig.memoryRoot.length > 0) {
        memoryRoot = path.resolve(WORKSPACE_ROOT, localConfig.memoryRoot);
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

  return { memoryRoot, source };
}

function collectMemory(loopIds, memoryLocation) {
  const { memoryRoot, source } = memoryLocation;

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

function loadTimingProjector() {
  if (timingProjector !== undefined) return timingProjector;
  const modulePath = path.join(
    PROJECT_ROOT,
    'dist/loop-engineering/packages/execution-runtime/src/stageEvents.js',
  );
  if (!fs.existsSync(modulePath)) {
    timingProjector = null;
    return timingProjector;
  }
  const module = require(modulePath);
  timingProjector = typeof module.projectStageTiming === 'function' ? module.projectStageTiming : null;
  return timingProjector;
}

function loadTimingAnalyzer() {
  if (timingAnalyzer !== undefined) return timingAnalyzer;
  const modulePath = path.join(
    PROJECT_ROOT,
    'dist/loop-engineering/packages/execution-runtime/src/timingMetrics.js',
  );
  if (!fs.existsSync(modulePath)) {
    timingAnalyzer = null;
    return timingAnalyzer;
  }
  const module = require(modulePath);
  timingAnalyzer = typeof module.aggregateRequestTimings === 'function' ? module : null;
  return timingAnalyzer;
}

function readStageEventSource(loopId, memoryRoot) {
  const evidence = `memory/loops/${loopId}/stage-events.jsonl`;
  const filePath = path.join(memoryRoot, 'loops', loopId, 'stage-events.jsonl');
  if (!fs.existsSync(filePath)) {
    return { loopId, evidence, available: false, eventCount: 0, events: [], errors: [] };
  }

  const lines = readText(filePath).split(/\r?\n/).filter((line) => line.trim().length > 0);
  const events = [];
  const errors = [];
  lines.forEach((line, index) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      errors.push(`Line ${index + 1}: invalid JSON`);
      return;
    }
    if (!isScopedStageEvent(event, loopId)) {
      errors.push(`Line ${index + 1}: event identity cannot be scoped to this loop`);
      return;
    }
    events.push(event);
  });
  return { loopId, evidence, available: true, eventCount: lines.length, events, errors };
}

function readTaskEventSource(loopId, memoryRoot) {
  const evidence = `memory/tasks/${loopId}/task-events.jsonl`;
  const filePath = path.join(memoryRoot, 'tasks', encodeURIComponent(loopId), 'task-events.jsonl');
  if (!fs.existsSync(filePath)) {
    return { loopId, evidence, available: false, eventCount: 0, events: [], errors: [] };
  }

  const lines = readText(filePath).split(/\r?\n/).filter((line) => line.trim().length > 0);
  const events = [];
  const errors = [];
  lines.forEach((line, index) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      errors.push(`Line ${index + 1}: invalid JSON`);
      return;
    }
    if (!event || typeof event !== 'object' || typeof event.taskId !== 'string' || typeof event.eventType !== 'string') {
      errors.push(`Line ${index + 1}: task event identity or type is invalid`);
      return;
    }
    events.push(event);
  });
  return { loopId, evidence, available: true, eventCount: lines.length, events, errors };
}

function readExecutionEventSource(loopId, memoryRoot) {
  const evidence = `memory/loops/${loopId}/runs/*/execution-events.jsonl`;
  const runsDirectory = path.join(memoryRoot, 'loops', encodeURIComponent(loopId), 'runs');
  if (!fs.existsSync(runsDirectory)) {
    return { loopId, evidence, available: false, eventCount: 0, events: [], errors: [] };
  }

  const events = [];
  const errors = [];
  const runDirectories = fs.readdirSync(runsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsDirectory, entry.name))
    .sort();
  for (const runDirectory of runDirectories) {
    const filePath = path.join(runDirectory, 'execution-events.jsonl');
    if (!fs.existsSync(filePath)) continue;
    const lines = readText(filePath).split(/\r?\n/).filter((line) => line.trim().length > 0);
    lines.forEach((line, index) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        errors.push(`${relativeToProject(filePath)}:${index + 1}: invalid JSON`);
        return;
      }
      if (!event || typeof event !== 'object' || event.loopId !== loopId || typeof event.runId !== 'string') {
        errors.push(`${relativeToProject(filePath)}:${index + 1}: execution event identity is invalid`);
        return;
      }
      events.push(event);
    });
  }
  return { loopId, evidence, available: true, eventCount: events.length, events, errors };
}

function readTimingMetricSource(loopId, memoryRoot) {
  const evidence = `memory/loops/${loopId}/metrics.jsonl`;
  const filePath = path.join(memoryRoot, 'loops', loopId, 'metrics.jsonl');
  if (!fs.existsSync(filePath)) {
    return { loopId, evidence, available: false, eventCount: 0, metricCount: 0, legacyCount: 0, metrics: [], errors: [] };
  }

  const lines = readText(filePath).split(/\r?\n/).filter((line) => line.trim().length > 0);
  const metrics = [];
  const errors = [];
  let legacyCount = 0;
  lines.forEach((line, index) => {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      errors.push(`Line ${index + 1}: invalid JSON`);
      return;
    }
    if (value?.kind !== 'StageTimingMetric') {
      legacyCount += 1;
      return;
    }
    const analyzer = loadTimingAnalyzer();
    const validationErrors = analyzer?.validateStageTimingMetric
      ? analyzer.validateStageTimingMetric(value)
      : isMinimalTimingMetric(value) ? [] : ['StageTimingMetric fields are incomplete'];
    if (validationErrors.length > 0) {
      errors.push(`Line ${index + 1}: ${validationErrors.join('; ')}`);
      return;
    }
    metrics.push(value);
  });
  return {
    loopId,
    evidence,
    available: true,
    eventCount: lines.length,
    metricCount: metrics.length,
    legacyCount,
    metrics,
    errors,
  };
}

function isMinimalTimingMetric(value) {
  return value !== null
    && typeof value === 'object'
    && value.kind === 'StageTimingMetric'
    && value.version === 1
    && typeof value.sourceKey === 'string'
    && typeof value.loopId === 'string'
    && typeof value.runId === 'string'
    && typeof value.taskId === 'string'
    && typeof value.stageId === 'string';
}

function isScopedStageEvent(event, loopId) {
  return event !== null
    && typeof event === 'object'
    && event.loopId === loopId
    && [event.runId, event.taskId, event.stageId].every((value) => typeof value === 'string' && value.length > 0)
    && Number.isInteger(event.attempt)
    && event.attempt > 0;
}

function selectLatestRun(events) {
  const runs = new Map();
  events.forEach((event, index) => {
    const timestamp = Date.parse(event.occurredAt);
    const candidate = { runId: event.runId, timestamp: Number.isFinite(timestamp) ? timestamp : -1, index };
    const current = runs.get(event.runId);
    if (!current || candidate.timestamp > current.timestamp || candidate.index > current.index) {
      runs.set(event.runId, candidate);
    }
  });
  return [...runs.values()]
    .sort((left, right) => right.timestamp - left.timestamp || right.index - left.index)[0]?.runId ?? null;
}

function unmeasuredStage(loop, stage, source, input = {}) {
  return {
    loopId: loop.id,
    runId: input.runId ?? null,
    taskId: input.taskId ?? null,
    stageId: stage.id,
    attempt: input.attempt ?? null,
    stageKind: stage.kind,
    owner: stage.owner,
    status: 'unmeasured',
    valid: false,
    enteredAt: null,
    firstActionAt: null,
    exitedAt: null,
    durationMs: null,
    activeMs: null,
    waitingMs: null,
    waitingReason: input.waitingReason ?? 'missing_instrumentation',
    evidence: source.evidence,
    errors: input.errors ?? ['No stage events were recorded'],
  };
}

function projectLoopTiming(loop, memoryRoot) {
  const source = readStageEventSource(loop.id, memoryRoot);
  const projector = loadTimingProjector();
  if (source.eventCount > 0 && !projector) {
    source.errors.push('Engine timing projector is unavailable; run the TypeScript build before monitoring');
  }

  const selectedRunId = selectLatestRun(source.events);
  if (!selectedRunId) {
    const stages = loop.stages.map((stage) => unmeasuredStage(loop, stage, source, {
      errors: source.errors.length ? source.errors : undefined,
    }));
    return {
      source: {
        ...source,
        events: undefined,
        selectedRunId: null,
        taskIds: [],
        status: source.errors.length > 0 ? 'invalid' : 'unmeasured',
      },
      stages,
    };
  }

  const selectedEvents = source.events.filter((event) => event.runId === selectedRunId);
  const taskIds = [...new Set(selectedEvents.map((event) => event.taskId))].sort();
  const sourceErrors = source.errors;
  const stages = taskIds.flatMap((taskId) => loop.stages.map((stage) => {
    const stageEvents = selectedEvents.filter((event) => event.taskId === taskId && event.stageId === stage.id);
    const attempt = stageEvents.reduce((maximum, event) => Math.max(maximum, event.attempt), 0) || 1;
    if (sourceErrors.length > 0 || stageEvents.length === 0 || !projector) {
      return unmeasuredStage(loop, stage, source, {
        runId: selectedRunId,
        taskId,
        attempt,
        errors: sourceErrors.length > 0 ? sourceErrors : undefined,
      });
    }

    const projection = projector(stageEvents, {
      loopId: loop.id,
      runId: selectedRunId,
      taskId,
      stageId: stage.id,
      attempt,
      stageKind: stage.kind,
      owner: stage.owner,
    });
    return { ...projection, evidence: source.evidence };
  }));

  const validStages = stages.filter((stage) => stage.valid).length;
  const status = validStages === stages.length && stages.length > 0
    ? 'measured'
    : validStages > 0
      ? 'partial'
      : source.errors.length > 0
        ? 'invalid'
        : 'unmeasured';
  return {
    source: {
      loopId: source.loopId,
      evidence: source.evidence,
      available: source.available,
      eventCount: source.eventCount,
      errors: source.errors,
      selectedRunId,
      taskIds,
      status,
    },
    stages,
  };
}

export function buildTiming(loops, memoryRoot) {
  const analyzer = loadTimingAnalyzer();
  const analyses = loops.map((loop) => {
    const stageSource = readStageEventSource(loop.id, memoryRoot);
    const projection = projectLoopTiming(loop, memoryRoot);
    const taskSource = readTaskEventSource(loop.id, memoryRoot);
    const executionSource = readExecutionEventSource(loop.id, memoryRoot);
    const metricSource = readTimingMetricSource(loop.id, memoryRoot);
    const sourceErrors = [
      ...projection.source.errors,
      ...taskSource.errors,
      ...executionSource.errors,
      ...metricSource.errors,
    ];
    const requestEvidence = [
      taskSource.evidence,
      stageSource.evidence,
      executionSource.evidence,
      metricSource.evidence,
    ];
    const requests = analyzer
      ? analyzer.aggregateRequestTimings({
        loopId: loop.id,
        taskEvents: taskSource.events,
        stageEvents: stageSource.events,
        executionEvents: executionSource.events,
        metrics: metricSource.metrics,
        stages: loop.stages.map((stage) => ({ id: stage.id, kind: stage.kind, owner: stage.owner })),
        sourceErrors,
      }).map((request) => ({ ...request, evidence: requestEvidence }))
      : [];
    const source = {
      ...projection.source,
      errors: sourceErrors,
      status: sourceErrors.length > 0
        ? 'invalid'
        : projection.source.status,
      metricCount: metricSource.metricCount,
      legacyMetricCount: metricSource.legacyCount,
      metricEvidence: metricSource.evidence,
      taskEventCount: taskSource.eventCount,
      executionEventCount: executionSource.eventCount,
    };
    return {
      projection: { ...projection, source },
      requests,
      metricSource,
    };
  });
  const projections = analyses.map((analysis) => analysis.projection);
  const sources = projections.map((projection) => projection.source);
  const stages = projections.flatMap((projection) => projection.stages);
  const requests = analyses.flatMap((analysis) => analysis.requests);
  const measured = stages.filter((stage) => stage.valid);
  const status = measured.length === stages.length && stages.length > 0
    ? 'measured'
    : measured.length > 0
      ? 'partial'
      : sources.some((source) => source.errors.length > 0)
        ? 'invalid'
        : 'unmeasured';
  const realMetricCount = analyses.reduce((total, analysis) => total + analysis.metricSource.metricCount, 0);
  const legacyMetricCount = analyses.reduce((total, analysis) => total + analysis.metricSource.legacyCount, 0);
  const measuredRequests = requests.filter((request) => request.status === 'measured');
  const requestDurations = requests.map((request) => request.durationMs).filter((value) => typeof value === 'number');
  const requestDistribution = analyzer?.percentile
    ? {
      sampleCount: requestDurations.length,
      averageMs: requestDurations.length > 0
        ? requestDurations.reduce((total, value) => total + value, 0) / requestDurations.length
        : null,
      p50Ms: analyzer.percentile(requestDurations, 0.5),
      p95Ms: analyzer.percentile(requestDurations, 0.95),
    }
    : { sampleCount: 0, averageMs: null, p50Ms: null, p95Ms: null };
  const aggregate = {
    requestCount: requests.length,
    measuredRequestCount: measuredRequests.length,
    partialRequestCount: requests.filter((request) => request.status === 'partial').length,
    unmeasuredRequestCount: requests.filter((request) => request.status === 'unmeasured').length,
    invalidRequestCount: requests.filter((request) => request.status === 'invalid').length,
    measurementRate: requests.length === 0 ? 0 : measuredRequests.length / requests.length,
    durationMs: requests.reduce((total, request) => total + (request.durationMs ?? 0), 0),
    activeMs: requests.reduce((total, request) => total + (request.activeMs ?? 0), 0),
    waitingMs: requests.reduce((total, request) => total + (request.waitingMs ?? 0), 0),
    retryCount: requests.reduce((total, request) => total + request.retryCount, 0),
    waitingByReason: requests.reduce((totals, request) => {
      for (const [reason, duration] of Object.entries(request.waitingByReason)) {
        totals[reason] = (totals[reason] || 0) + duration;
      }
      return totals;
    }, {}),
    distribution: requestDistribution,
    waitingRatio: totalRatio(
      requests.reduce((total, request) => total + (request.durationMs ?? 0), 0),
      requests.reduce((total, request) => total + (request.waitingMs ?? 0), 0),
    ),
    retryDistribution: countValues(requests.map((request) => request.retryCount)),
    bottleneckStages: countValues(requests.map((request) => request.bottleneckStageId).filter(Boolean)),
    failureReasons: countStrings(requests.flatMap((request) => request.failureReasons)),
    stageAggregates: buildStageAggregates(analyses, requests, analyzer),
  };
  return {
    instrumented: sources.some((source) => source.eventCount > 0),
    status,
    waitingReason: stages.some((stage) => stage.waitingReason === 'missing_instrumentation')
      ? 'missing_instrumentation'
      : null,
    sources,
    stages,
    requests,
    aggregate,
    metrics: {
      realTimingCount: realMetricCount,
      legacySimulationCount: legacyMetricCount,
      sourceCount: analyses.length,
      evidence: analyses.map((analysis) => ({
        loopId: analysis.metricSource.loopId,
        source: analysis.metricSource.evidence,
        errors: analysis.metricSource.errors,
      })),
    },
  };
}

function buildStageAggregates(analyses, requests, analyzer) {
  const buckets = new Map();
  const persistedDurations = new Map();
  for (const analysis of analyses) {
    for (const metric of analysis.metricSource.metrics) {
      const key = `${metric.loopId}/${metric.stageId}/${metric.owner}`;
      const values = persistedDurations.get(key) || [];
      values.push(metric.durationMs);
      persistedDurations.set(key, values);
    }
  }

  for (const request of requests) {
    for (const stage of request.stages) {
      const key = `${request.loopId}/${stage.stageId}/${stage.owner}`;
      const bucket = buckets.get(key) || {
        loopId: request.loopId,
        stageId: stage.stageId,
        stageKind: stage.stageKind,
        owner: stage.owner,
        sampleCount: 0,
        measuredSampleCount: 0,
        durationMs: 0,
        activeMs: 0,
        waitingMs: 0,
        retryCount: 0,
        waitingByReason: {},
        failureReasons: [],
        errors: [],
        fallbackDurations: [],
        invalid: false,
      };
      bucket.sampleCount += stage.attempts;
      bucket.measuredSampleCount += stage.measuredAttempts;
      bucket.durationMs += stage.durationMs || 0;
      bucket.activeMs += stage.activeMs || 0;
      bucket.waitingMs += stage.waitingMs || 0;
      bucket.retryCount += stage.retryCount;
      bucket.invalid = bucket.invalid || stage.status === 'invalid';
      bucket.failureReasons.push(...stage.failureReasons);
      bucket.errors.push(...stage.errors);
      if (stage.durationMs !== null && stage.distribution.sampleCount === 1) {
        bucket.fallbackDurations.push(stage.durationMs);
      }
      for (const [reason, duration] of Object.entries(stage.waitingByReason)) {
        bucket.waitingByReason[reason] = (bucket.waitingByReason[reason] || 0) + duration;
      }
      buckets.set(key, bucket);
    }
  }

  return [...buckets.values()].sort((left, right) =>
    `${left.loopId}/${left.stageId}/${left.owner}`.localeCompare(`${right.loopId}/${right.stageId}/${right.owner}`)
  ).map((bucket) => {
    const values = persistedDurations.get(`${bucket.loopId}/${bucket.stageId}/${bucket.owner}`)
      || bucket.fallbackDurations;
    const sorted = values.filter((value) => typeof value === 'number').sort((left, right) => left - right);
    const measuredSampleCount = bucket.measuredSampleCount;
    const status = bucket.invalid
      ? 'invalid'
      : bucket.sampleCount === 0
        ? 'unmeasured'
        : measuredSampleCount === bucket.sampleCount
          ? 'measured'
          : measuredSampleCount > 0
            ? 'partial'
            : 'unmeasured';
    return {
      loopId: bucket.loopId,
      stageId: bucket.stageId,
      stageKind: bucket.stageKind,
      owner: bucket.owner,
      status,
      sampleCount: bucket.sampleCount,
      measuredSampleCount,
      measurementRate: bucket.sampleCount === 0 ? 0 : measuredSampleCount / bucket.sampleCount,
      durationMs: measuredSampleCount > 0 ? bucket.durationMs : null,
      activeMs: measuredSampleCount > 0 ? bucket.activeMs : null,
      waitingMs: measuredSampleCount > 0 ? bucket.waitingMs : null,
      waitingRatio: totalRatio(bucket.durationMs, bucket.waitingMs),
      waitingByReason: bucket.waitingByReason,
      retryCount: bucket.retryCount,
      distribution: {
        sampleCount: sorted.length,
        averageMs: sorted.length > 0 ? sorted.reduce((total, value) => total + value, 0) / sorted.length : null,
        p50Ms: analyzer?.percentile ? analyzer.percentile(sorted, 0.5) : null,
        p95Ms: analyzer?.percentile ? analyzer.percentile(sorted, 0.95) : null,
      },
      failureReasons: countStrings(bucket.failureReasons),
      errors: [...new Set(bucket.errors)],
    };
  });
}

function totalRatio(total, part) {
  return total > 0 ? part / total : null;
}

function countValues(values) {
  const counts = {};
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const key = String(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function countStrings(values) {
  return countValues(values.filter((value) => typeof value === 'string' && value.length > 0));
}

function buildEvaluation(loops, agents, timing) {
  const evaluators = agents.filter((agent) => agent.role === 'checker');
  const selfReviewViolations = loops.filter((loop) => loop.allowSelfReview).map((loop) => loop.id);
  const missingStageContracts = loops.filter((loop) => loop.stages.length === 0).map((loop) => loop.id);
  const observabilityGaps = [];
  for (const source of timing.sources) {
    const incomplete = timing.stages.some((stage) => stage.loopId === source.loopId && !stage.valid);
    if (source.eventCount === 0 || source.errors.length > 0 || incomplete) {
      observabilityGaps.push({
        code: source.errors.length > 0 ? 'invalid_stage_timing_events' : 'missing_stage_timing_instrumentation',
        status: source.errors.length > 0 ? 'invalid' : 'unmeasured',
        loopId: source.loopId,
        nextAction: source.errors.length > 0
          ? 'Repair the append-only stage event stream before reporting dwell time.'
          : 'Execute the missing workflow stages through ExecutionRuntime before reporting efficiency.',
      });
    }
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

function projectionRuns(timing, loops) {
  const byRun = new Map();
  for (const stage of timing.stages || []) {
    if (!stage.runId) continue;
    const loop = loops.find((candidate) => candidate.id === stage.loopId);
    const run = byRun.get(stage.runId) || {
      runId: stage.runId,
      loopId: stage.loopId,
      projectId: loop?.project || null,
      status: 'completed',
      stages: [],
      evidence: [],
    };
    run.stages.push(stage);
    run.evidence.push(stage.evidence);
    if (stage.status === 'failed' || stage.valid === false && stage.status === 'invalid') run.status = 'failed';
    byRun.set(stage.runId, run);
  }
  return [...byRun.values()];
}

function collectInventory({ loops, agents, harnesses, connectors, projects, projectGroups, memory, graph }) {
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
    projectGroups: projectGroups.length,
    repositories,
    mountedRepositories,
    memoryRuns: memory.totals.runs,
    graphNodes: graph.nodes,
  };
}

export function buildSnapshot(options = {}) {
  const warnings = [];
  const git = collectGit();
  const { agents, harnesses } = collectAgents(warnings);
  const loops = collectLoops(warnings);
  const projectInventory = collectProjects(warnings);
  const projects = projectInventory.projects;
  const projectGroups = projectInventory.projectGroups;
  const connectors = collectConnectors(warnings);
  const memoryLocation = resolveMonitorMemoryRoot(warnings, options.memoryRoot);
  const memory = collectMemory(loops.map((loop) => loop.id), memoryLocation);
  const graph = collectGraph(git, warnings);
  const timing = buildTiming(loops, memoryLocation.memoryRoot);
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

  const monitorProjection = buildMonitorProjection({
    workspace: { id: 'ws_xiaobai_monitoring', title: 'Xiaobai Workspace', status: warnings.length > 0 ? 'attention' : 'loaded' },
    projects,
    projectGroups,
    loops,
    runs: projectionRuns(timing, loops),
    warnings,
  });

  const inventory = collectInventory({
    loops,
    agents,
    harnesses,
    connectors,
    projects,
    projectGroups,
    memory,
    graph,
  });

  return {
    schemaVersion: 2,
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
    projectGroups,
    memory,
    graph,
    timing,
    evaluation,
    monitorProjection,
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
  const args = { output: DEFAULT_OUTPUT, stdout: false, memoryRoot: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--stdout') args.stdout = true;
    if (argv[index] === '--output' && argv[index + 1]) {
      args.output = path.resolve(argv[index + 1]);
      index += 1;
    }
    if (argv[index] === '--memory-root' && argv[index + 1]) {
      args.memoryRoot = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = buildSnapshot({ memoryRoot: args.memoryRoot });
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
