#!/usr/bin/env node
const fs = require('fs');

const [graphPath, layersPath, tourPath, outputPath] = process.argv.slice(2);
const fragment = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const layers = JSON.parse(fs.readFileSync(layersPath, 'utf8'));
const tour = JSON.parse(fs.readFileSync(tourPath, 'utf8'));
const output = {
  version: '1.0.0',
  project: {
    name: 'xiaobaicode-loop-engineering',
    languages: ['TypeScript', 'Markdown', 'YAML', 'JSON', 'JSONL', 'JavaScript'],
    frameworks: [],
    description: 'Loop Engineering 工程骨架，将 Agent 工作流的发现、交付、验证、持久化与调度拆分为可维护、可审计、可验证的引擎层和运行空间。',
    analyzedAt: new Date().toISOString(),
    gitCommitHash: '0e8a1369f05ff1ffac2c01aa12f1376708545272'
  },
  nodes: fragment.nodes,
  edges: fragment.edges,
  layers,
  tour
};
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
