#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const root = process.cwd();
const outputRoot = path.join(root, '.understand-anything');
const graphPath = path.join(outputRoot, 'knowledge-graph.json');
const scanPath = path.join(outputRoot, 'intermediate', 'scan-result.json');

const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
const filePaths = scan.files.map((file) => file.path);
const fileSet = new Set(filePaths);
const fileNodeByPath = new Map(
  graph.nodes
    .filter((node) => node.filePath && !['function', 'class'].includes(node.type))
    .map((node) => [node.filePath, node.id]),
);

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function scriptKind(filePath) {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.ts')) return ts.ScriptKind.TS;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.json')) return ts.ScriptKind.JSON;
  return ts.ScriptKind.JS;
}

function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function lineRange(sourceFile, node) {
  return [
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    sourceFile.getLineAndCharacterOfPosition(node.end).line + 1,
  ];
}

function parameterName(parameter, sourceFile) {
  return parameter.name.getText(sourceFile);
}

function propertyName(node, sourceFile) {
  return node.name ? node.name.getText(sourceFile) : '<anonymous>';
}

function analyzeCode(filePath, content) {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(filePath),
  );
  const functions = [];
  const classes = [];
  const imports = [];
  const exports = new Set();
  const moduleRefs = [];

  function recordModuleRef(source, specifiers) {
    imports.push({ source, specifiers: [...new Set(specifiers)] });
    moduleRefs.push(source);
  }

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifiers = [];
      const clause = statement.importClause;
      if (clause?.name) specifiers.push(clause.name.text);
      if (clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          specifiers.push(clause.namedBindings.name.text);
        } else {
          specifiers.push(...clause.namedBindings.elements.map((item) => item.name.text));
        }
      }
      recordModuleRef(statement.moduleSpecifier.text, specifiers);
    }

    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const item of statement.exportClause.elements) exports.add(item.name.text);
      }
      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const specifiers = statement.exportClause && ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map((item) => item.name.text)
          : [];
        recordModuleRef(statement.moduleSpecifier.text, specifiers);
      }
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const range = lineRange(sourceFile, statement);
      const exported = hasExportModifier(statement);
      if (exported) exports.add(statement.name.text);
      functions.push({
        name: statement.name.text,
        params: statement.parameters.map((parameter) => parameterName(parameter, sourceFile)),
        returnType: statement.type?.getText(sourceFile),
        exported,
        lineCount: range[1] - range[0] + 1,
      });
    }

    if (ts.isVariableStatement(statement)) {
      const exported = hasExportModifier(statement);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        if (!ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer)) continue;
        const range = lineRange(sourceFile, declaration);
        if (exported) exports.add(declaration.name.text);
        functions.push({
          name: declaration.name.text,
          params: declaration.initializer.parameters.map((parameter) => parameterName(parameter, sourceFile)),
          returnType: declaration.initializer.type?.getText(sourceFile),
          exported,
          lineCount: range[1] - range[0] + 1,
        });
      }
    }

    if (ts.isClassDeclaration(statement) && statement.name) {
      const range = lineRange(sourceFile, statement);
      const exported = hasExportModifier(statement);
      if (exported) exports.add(statement.name.text);
      classes.push({
        name: statement.name.text,
        methods: statement.members
          .filter((member) => ts.isMethodDeclaration(member))
          .map((member) => propertyName(member, sourceFile)),
        properties: statement.members
          .filter((member) => ts.isPropertyDeclaration(member))
          .map((member) => propertyName(member, sourceFile)),
        exported,
        lineCount: range[1] - range[0] + 1,
      });
    }
  }

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'require'
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])
    ) {
      recordModuleRef(node.arguments[0].text, []);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  return {
    functions,
    classes,
    imports,
    exports: [...exports],
    moduleRefs,
  };
}

function resolveInternalImport(importer, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  const candidates = [base];
  const ext = path.posix.extname(base);
  if (ext) {
    const stem = base.slice(0, -ext.length);
    if (['.js', '.mjs', '.cjs'].includes(ext)) {
      candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.mjs`, `${stem}.cjs`);
    }
  } else {
    for (const suffix of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.yaml', '.yml']) {
      candidates.push(`${base}${suffix}`);
    }
    for (const suffix of ['index.ts', 'index.tsx', 'index.js', 'index.mjs', 'index.cjs']) {
      candidates.push(`${base}/${suffix}`);
    }
  }
  return candidates.find((candidate) => fileSet.has(candidate)) || null;
}

const structuralLanguages = new Set([
  'typescript',
  'javascript',
  'markdown',
  'json',
  'yaml',
  'shell',
]);
const fingerprints = {};
const importMap = {};

for (const file of scan.files) {
  const absolutePath = path.join(root, file.path);
  const content = fs.readFileSync(absolutePath, 'utf8');
  let analysis = { functions: [], classes: [], imports: [], exports: [], moduleRefs: [] };
  if (['typescript', 'javascript'].includes(file.language)) {
    analysis = analyzeCode(file.path, content);
  }
  importMap[file.path] = [...new Set(
    analysis.moduleRefs
      .map((specifier) => resolveInternalImport(file.path, specifier))
      .filter(Boolean),
  )].sort();
  fingerprints[file.path] = {
    filePath: file.path,
    contentHash: sha256(content),
    functions: analysis.functions,
    classes: analysis.classes,
    imports: analysis.imports,
    exports: analysis.exports,
    totalLines: content.split('\n').length,
    hasStructuralAnalysis: structuralLanguages.has(file.language),
  };
}

const allowedExistingEdgeTypes = new Set(['contains', 'exports']);
const normalizedEdges = graph.edges.filter((edge) => allowedExistingEdgeTypes.has(edge.type));
for (const [sourcePath, targets] of Object.entries(importMap)) {
  const source = fileNodeByPath.get(sourcePath);
  if (!source) continue;
  for (const targetPath of targets) {
    const target = fileNodeByPath.get(targetPath);
    if (!target) continue;
    normalizedEdges.push({
      source,
      target,
      type: 'imports',
      direction: 'forward',
      weight: 0.7,
    });
  }
}

const edgeKeys = new Set();
graph.edges = normalizedEdges.filter((edge) => {
  const key = `${edge.source}\u0000${edge.target}\u0000${edge.type}`;
  if (edgeKeys.has(key)) return false;
  edgeKeys.add(key);
  return true;
});

const analyzedAt = new Date().toISOString();
const gitCommitHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
graph.version = '1.0.0';
graph.project = {
  ...graph.project,
  name: scan.name,
  languages: [...scan.languages].sort(),
  frameworks: scan.frameworks || [],
  analyzedAt,
  gitCommitHash,
};
scan.importMap = importMap;

const nodeIds = new Set();
const issues = [];
for (const node of graph.nodes) {
  if (nodeIds.has(node.id)) issues.push(`Duplicate node ID: ${node.id}`);
  nodeIds.add(node.id);
  if (!node.summary) issues.push(`Node missing summary: ${node.id}`);
  if (!Array.isArray(node.tags) || node.tags.length === 0) issues.push(`Node missing tags: ${node.id}`);
}
for (const edge of graph.edges) {
  if (!nodeIds.has(edge.source)) issues.push(`Dangling edge source: ${edge.source}`);
  if (!nodeIds.has(edge.target)) issues.push(`Dangling edge target: ${edge.target}`);
}
for (const filePath of filePaths) {
  if (!fileNodeByPath.has(filePath)) issues.push(`Scan file missing graph node: ${filePath}`);
}
const layerAssignment = new Map();
for (const layer of graph.layers) {
  for (const nodeId of layer.nodeIds) {
    if (!nodeIds.has(nodeId)) issues.push(`Layer ${layer.id} references missing node: ${nodeId}`);
    if (layerAssignment.has(nodeId)) issues.push(`Node appears in multiple layers: ${nodeId}`);
    layerAssignment.set(nodeId, layer.id);
  }
}
for (const nodeId of fileNodeByPath.values()) {
  if (!layerAssignment.has(nodeId)) issues.push(`File node missing layer: ${nodeId}`);
}
for (const step of graph.tour) {
  for (const nodeId of step.nodeIds) {
    if (!nodeIds.has(nodeId)) issues.push(`Tour step ${step.order} references missing node: ${nodeId}`);
  }
}

if (issues.length > 0) {
  throw new Error(`Knowledge graph validation failed:\n${issues.join('\n')}`);
}

const countBy = (items, key) => items.reduce((counts, item) => {
  counts[item[key]] = (counts[item[key]] || 0) + 1;
  return counts;
}, {});
const fingerprintStore = {
  version: '1.0.0',
  gitCommitHash,
  generatedAt: analyzedAt,
  files: fingerprints,
};
const meta = {
  lastAnalyzedAt: analyzedAt,
  gitCommitHash,
  version: '1.0.0',
  analyzedFiles: filePaths.length,
};
const review = {
  issues: [],
  warnings: [],
  stats: {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    totalLayers: graph.layers.length,
    tourSteps: graph.tour.length,
    nodeTypes: countBy(graph.nodes, 'type'),
    edgeTypes: countBy(graph.edges, 'type'),
  },
};

fs.writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`);
fs.writeFileSync(scanPath, `${JSON.stringify(scan, null, 2)}\n`);
fs.writeFileSync(path.join(outputRoot, 'fingerprints.json'), `${JSON.stringify(fingerprintStore, null, 2)}\n`);
fs.writeFileSync(path.join(outputRoot, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
fs.writeFileSync(
  path.join(outputRoot, 'config.json'),
  `${JSON.stringify({ outputLanguage: 'zh', autoUpdate: false }, null, 2)}\n`,
);
fs.writeFileSync(path.join(outputRoot, 'intermediate', 'review.json'), `${JSON.stringify(review, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({
  analyzedFiles: filePaths.length,
  filesWithImports: Object.values(importMap).filter((targets) => targets.length > 0).length,
  importEdges: Object.values(importMap).reduce((sum, targets) => sum + targets.length, 0),
  ...review.stats,
}, null, 2)}\n`);
