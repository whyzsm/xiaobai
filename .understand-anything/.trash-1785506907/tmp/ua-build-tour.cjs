#!/usr/bin/env node
const fs = require('fs');

const [graphPath, layersPath, outputPath, metricsPath] = process.argv.slice(2);
const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const layers = JSON.parse(fs.readFileSync(layersPath, 'utf8'));
const nodeIds = new Set(graph.nodes.map((node) => node.id));

const tour = [
  {
    order: 1,
    title: '工程定位与边界',
    description: '先从根 README 理解 Loop Engineering 如何把 Agent 工作流拆成可维护、可审计、可验证的系统能力。架构文档进一步划分 engine 与 workspace 的职责，为后续阅读建立边界意识。',
    nodeIds: ['document:README.md', 'document:loop-engineering/docs/architecture.md']
  },
  {
    order: 2,
    title: 'CLI 与运行入口',
    description: 'CLI 负责解析 validate、dry-run、simulate 和 memory 命令，并把请求交给对应 runtime。LoopRuntime 当前主要组装计划而非执行真实 Agent，是判断现有能力边界的关键入口。',
    nodeIds: ['file:loop-engineering/cli/loop.ts', 'file:loop-engineering/packages/loop-runtime/src/loopRuntime.ts'],
    languageLesson: 'TypeScript 的类型化 options 与 RuntimePlan 让 CLI 输入和规划输出保持显式契约。'
  },
  {
    order: 3,
    title: '核心类型与校验',
    description: '共享类型定义 LoopSpec、ProjectSpec、RuntimePlan 等跨包契约。JSON Schema 与 AJV 校验把 YAML 配置约束落为机器门禁，并验证被引用的 Agent、Harness、Skill 和 Connector 文件是否存在。',
    nodeIds: [
      'file:loop-engineering/packages/shared/src/types.ts',
      'file:loop-engineering/packages/shared/src/validation.ts',
      'config:loop-engineering/schemas/loop.schema.json'
    ],
    languageLesson: 'TypeScript 接口负责编译期约束，JSON Schema 与 AJV 补足运行时配置校验。'
  },
  {
    order: 4,
    title: 'Workspace 控制面',
    description: 'Workspace 将通用引擎配置为具体的前端交付 Loop，并由小白 orchestrator 汇总发现、项目路由、生成与评审计划。这里可以直接看到当前九阶段交付流程和全局 human gate。',
    nodeIds: [
      'config:workspace/loops/frontend-delivery.loop.yaml',
      'config:workspace/agents/xiaobai.orchestrator.agent.yaml',
      'config:workspace/agents/frontend-delivery.harness.yaml'
    ]
  },
  {
    order: 5,
    title: 'T-MAX 项目路由',
    description: 'T-MAX ProjectGroup 把七个前端仓库和 xiaoneng 背景挂载到统一的本机路径结构。项目级 Skill 再叠加 T-MAX 的仓库选择、设计与交付约束，是平台控制面连接领域交付能力的位置。',
    nodeIds: [
      'config:workspace/projects/t-max/.loop/project.yaml',
      'document:workspace/projects/t-max/SKILL.md',
      'document:workspace/projects/t-max/README.md'
    ]
  },
  {
    order: 6,
    title: 'Memory 协议与索引',
    description: 'Memory 协议统一 Obsidian 路径、Frontmatter 与内容格式，Indexer 将人类维护笔记和机器日志转成可搜索索引。它们共同构成长周期、跨终端记忆的基础数据层。',
    nodeIds: [
      'file:loop-engineering/packages/memory-protocol/src/paths.ts',
      'file:loop-engineering/packages/memory-indexer/src/memoryIndexer.ts',
      'document:workspace/memory/README.md'
    ]
  },
  {
    order: 7,
    title: 'Memory 上下文与诊断',
    description: 'Context Loader 按预算选择与当前项目和 Loop 相关的记忆，Doctor 则检查目录、索引与日志健康度。两者把“长期存储”转化为运行时可消费、可诊断的上下文。',
    nodeIds: [
      'file:loop-engineering/packages/memory-context/src/memoryContextLoader.ts',
      'file:loop-engineering/packages/memory-doctor/src/doctorMemory.ts',
      'file:loop-engineering/packages/memory-search/src/memorySearch.ts'
    ]
  },
  {
    order: 8,
    title: '模拟与知识沉淀',
    description: 'SimulationRuntime 用可重复的模拟运行验证 Loop 生命周期，并生成报告、状态、指标和案例。案例文档展示这些产物如何进入知识索引，形成从执行证据到可复用经验的闭环。',
    nodeIds: [
      'file:loop-engineering/packages/simulation-runtime/src/simulationRuntime.ts',
      'document:data/cases/2026-06-28-loop-simulation-lifecycle.md',
      'file:loop-engineering/packages/memory-capture/src/caseWriter.ts'
    ]
  },
  {
    order: 9,
    title: '测试与验收边界',
    description: 'runtime 测试验证项目路由、工作流计划和 human gate，Memory 测试验证协议与持久化行为。阅读这些测试可以确认哪些行为已由自动化守护，以及真实 Agent 执行仍不在当前实现范围内。',
    nodeIds: [
      'file:loop-engineering/tests/runtime.test.ts',
      'file:loop-engineering/tests/memory-protocol.test.ts',
      'file:loop-engineering/tests/memory-schema.test.ts'
    ]
  }
];

for (const step of tour) {
  for (const id of step.nodeIds) {
    if (!nodeIds.has(id)) throw new Error(`Tour references missing node: ${id}`);
  }
}
if (tour.length < 5 || tour.length > 15) throw new Error(`Invalid tour length: ${tour.length}`);
if (tour.some((step, index) => step.order !== index + 1 || step.nodeIds.length === 0)) {
  throw new Error('Tour order or membership is invalid');
}

const fanIn = new Map();
const fanOut = new Map();
for (const edge of graph.edges) {
  fanIn.set(edge.target, (fanIn.get(edge.target) || 0) + 1);
  fanOut.set(edge.source, (fanOut.get(edge.source) || 0) + 1);
}
const rank = (map, field) => [...map.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .map(([id, value]) => ({ id, [field]: value }));
const metrics = {
  scriptCompleted: true,
  totalNodes: graph.nodes.length,
  totalEdges: graph.edges.length,
  layerCount: layers.length,
  tourSteps: tour.length,
  fanInRanking: rank(fanIn, 'fanIn'),
  fanOutRanking: rank(fanOut, 'fanOut'),
  warnings: graph.edges.some((edge) => edge.type === 'imports')
    ? []
    : ['依赖提取不可用，导览依据目录结构、节点摘要和显式语义关系组织。']
};

fs.writeFileSync(outputPath, `${JSON.stringify(tour, null, 2)}\n`);
fs.writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
