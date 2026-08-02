#!/usr/bin/env node
const fs = require('fs');

const [graphPath, outputPath, metricsPath] = process.argv.slice(2);
const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const fileTypes = new Set([
  'file',
  'config',
  'document',
  'service',
  'pipeline',
  'table',
  'schema',
  'resource',
  'endpoint'
]);
const fileNodes = graph.nodes.filter((node) => fileTypes.has(node.type));

const definitions = [
  {
    id: 'layer:engine-runtime',
    name: '引擎运行时',
    description: 'Loop CLI 与调度、路由、Agent、Harness、Evaluator、Connector、预算和模拟等可执行引擎能力。',
    match: (path) => path.startsWith('loop-engineering/cli/') ||
      (path.startsWith('loop-engineering/packages/') && !path.includes('/memory-'))
  },
  {
    id: 'layer:memory-system',
    name: 'Memory 子系统',
    description: 'Obsidian 兼容的记忆协议、索引、搜索、诊断、捕获、上下文装载，以及 Workspace 运行记忆。',
    match: (path) => path.includes('loop-engineering/packages/memory-') || path.startsWith('workspace/memory/')
  },
  {
    id: 'layer:contracts-templates',
    name: '契约与模板',
    description: 'Loop Engineering 的 JSON Schema、Agent/Loop 模板与结构化契约基线。',
    match: (path) => path.startsWith('loop-engineering/schemas/') || path.startsWith('loop-engineering/templates/')
  },
  {
    id: 'layer:workspace-control-plane',
    name: 'Workspace 控制面',
    description: '具体 Loop、Agent、Harness、Connector 与预算配置，负责把引擎能力编排为可运行工作流。',
    match: (path) => /^workspace\/(agents|budgets|connectors|loops)\//.test(path)
  },
  {
    id: 'layer:project-integrations',
    name: '项目适配层',
    description: 'T-MAX、Harmony Wardrobe 与示例项目的路由、Skill、背景资料和本机挂载适配。',
    match: (path) => path.startsWith('workspace/projects/')
  },
  {
    id: 'layer:tests-quality',
    name: '测试与质量',
    description: '覆盖 runtime、Memory、Schema 与 CLI 行为的自动化测试和交付质量证据。',
    match: (path) => path.startsWith('loop-engineering/tests/')
  },
  {
    id: 'layer:documentation-knowledge',
    name: '文档与知识资产',
    description: '架构标准、产品规范、实施计划、案例索引、评审报告和项目使用说明。',
    match: (path, node) => node.type === 'document' || path.startsWith('data/') || path.startsWith('docs/') || path.startsWith('loop-engineering/docs/')
  },
  {
    id: 'layer:project-configuration',
    name: '工程配置',
    description: '仓库根级构建、TypeScript、包管理与本机配置示例，支撑整个工程骨架。',
    match: () => true
  }
];

const layers = definitions.map(({ match, ...layer }) => ({ ...layer, nodeIds: [] }));
const assignment = new Map();

for (const node of fileNodes) {
  const filePath = node.filePath || '';
  const index = definitions.findIndex((layer) => layer.match(filePath, node));
  if (index < 0) throw new Error(`No layer for ${node.id}`);
  layers[index].nodeIds.push(node.id);
  assignment.set(node.id, layers[index].id);
}

for (const layer of layers) layer.nodeIds.sort();
const nonEmptyLayers = layers.filter((layer) => layer.nodeIds.length > 0);
const assignedIds = nonEmptyLayers.flatMap((layer) => layer.nodeIds);
if (assignedIds.length !== fileNodes.length || new Set(assignedIds).size !== fileNodes.length) {
  throw new Error(`Layer coverage mismatch: ${assignedIds.length}/${fileNodes.length}`);
}

const imports = graph.edges.filter((edge) => edge.type === 'imports');
const allFileIds = new Set(fileNodes.map((node) => node.id));
const fileEdges = graph.edges.filter((edge) => allFileIds.has(edge.source) && allFileIds.has(edge.target));
const metrics = {
  scriptCompleted: true,
  totalFileNodes: fileNodes.length,
  totalFileEdges: fileEdges.length,
  importEdges: imports.length,
  directoryGroups: fileNodes.reduce((groups, node) => {
    const group = (node.filePath || '').split('/')[0] || 'root';
    groups[group] = (groups[group] || 0) + 1;
    return groups;
  }, {}),
  layerCounts: Object.fromEntries(nonEmptyLayers.map((layer) => [layer.id, layer.nodeIds.length])),
  warnings: imports.length === 0
    ? ['importMap 提取不可用，分层以目录、节点类型和显式语义关系为主。']
    : []
};

fs.writeFileSync(outputPath, `${JSON.stringify(nonEmptyLayers, null, 2)}\n`);
fs.writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
