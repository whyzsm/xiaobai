import path from 'node:path';
import { AnySchema, ErrorObject } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import {
  AgentSpec,
  BudgetSpec,
  ConnectorSpec,
  HarnessSpec,
  LoopSpec,
  ValidationResult
} from './types';
import { pathExists, readYamlFile, resolveWorkspacePath } from './fs';
import { readFile } from 'node:fs/promises';
import { resolveMemoryPath, resolveMemoryRoot } from './memoryRoot';

type SchemaName = 'loop' | 'harness' | 'agent' | 'connector' | 'budget';

const schemaFiles: Record<SchemaName, string> = {
  loop: 'loop.schema.json',
  harness: 'harness.schema.json',
  agent: 'agent.schema.json',
  connector: 'connector.schema.json',
  budget: 'budget.schema.json'
};

function schemaRootFromWorkspace(workspaceRoot: string): string {
  return path.resolve(workspaceRoot, '..', 'loop-engineering', 'schemas');
}

async function buildAjv(workspaceRoot: string): Promise<Ajv2020> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schemaRoot = schemaRootFromWorkspace(workspaceRoot);

  for (const [name, file] of Object.entries(schemaFiles)) {
    const schema = JSON.parse(await readFile(path.join(schemaRoot, file), 'utf8')) as AnySchema;
    ajv.addSchema(schema, name);
  }

  return ajv;
}

function formatAjvErrors(name: string, errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const location = error.instancePath || '/';
    return `${name}${location}: ${error.message ?? 'invalid value'}`;
  });
}

async function validateObject(
  ajv: Ajv2020,
  schemaName: SchemaName,
  displayName: string,
  value: unknown
): Promise<string[]> {
  const validate = ajv.getSchema(schemaName);
  if (!validate) {
    return [`Missing schema: ${schemaName}`];
  }
  return validate(value) ? [] : formatAjvErrors(displayName, validate.errors);
}

export async function validateWorkspace(
  workspaceRoot: string,
  loopPath: string
): Promise<ValidationResult> {
  const errors: string[] = [];
  const ajv = await buildAjv(workspaceRoot);
  const loop = await readYamlFile<LoopSpec>(loopPath);
  const memoryRoot = await resolveMemoryRoot(workspaceRoot);

  errors.push(...(await validateObject(ajv, 'loop', path.relative(workspaceRoot, loopPath), loop)));

  const projectRoot = path.join(workspaceRoot, 'projects', loop.handoff.project);
  const projectSkill = path.join(projectRoot, 'SKILL.md');
  const discoverySkill = path.join(projectRoot, '.loop', 'skills', `${loop.discovery.skill}.SKILL.md`);
  const orchestratorPath = loop.orchestrator?.agent ? path.join(workspaceRoot, 'agents', loop.orchestrator.agent) : undefined;
  const generatorPath = path.join(workspaceRoot, 'agents', loop.generator.agent);
  const evaluatorPath = path.join(workspaceRoot, 'agents', loop.verification.evaluator);
  const harnessPath = path.join(workspaceRoot, 'agents', loop.generator.harness);
  const budgetPath = path.join(workspaceRoot, 'budgets', 'default.budget.yaml');

  for (const requiredPath of [
    projectRoot,
    projectSkill,
    discoverySkill,
    orchestratorPath,
    generatorPath,
    evaluatorPath,
    harnessPath
  ].filter((requiredPath): requiredPath is string => Boolean(requiredPath))) {
    if (!(await pathExists(requiredPath))) {
      errors.push(`Missing required file: ${requiredPath}`);
    }
  }

  if (orchestratorPath && (await pathExists(orchestratorPath))) {
    const orchestrator = await readYamlFile<AgentSpec>(orchestratorPath);
    errors.push(...(await validateObject(ajv, 'agent', path.relative(workspaceRoot, orchestratorPath), orchestrator)));
    if (orchestrator.role !== 'orchestrator') {
      errors.push(`Orchestrator agent must use role: orchestrator (${orchestratorPath})`);
    }
  }

  if (await pathExists(generatorPath)) {
    const generator = await readYamlFile<AgentSpec>(generatorPath);
    errors.push(...(await validateObject(ajv, 'agent', path.relative(workspaceRoot, generatorPath), generator)));
  }

  if (await pathExists(evaluatorPath)) {
    const evaluator = await readYamlFile<AgentSpec>(evaluatorPath);
    errors.push(...(await validateObject(ajv, 'agent', path.relative(workspaceRoot, evaluatorPath), evaluator)));
  }

  if (await pathExists(harnessPath)) {
    const harness = await readYamlFile<HarnessSpec>(harnessPath);
    errors.push(...(await validateObject(ajv, 'harness', path.relative(workspaceRoot, harnessPath), harness)));
  }

  if (await pathExists(budgetPath)) {
    const budget = await readYamlFile<BudgetSpec>(budgetPath);
    errors.push(...(await validateObject(ajv, 'budget', path.relative(workspaceRoot, budgetPath), budget)));
  }

  const workflowStageIds = new Set<string>();
  for (const stage of loop.workflow?.stages ?? []) {
    if (workflowStageIds.has(stage.id)) {
      errors.push(`Duplicate workflow stage id: ${stage.id}`);
    }
    workflowStageIds.add(stage.id);

    if (stage.agent) {
      const stageAgentPath = path.join(workspaceRoot, 'agents', stage.agent);
      if (!(await pathExists(stageAgentPath))) {
        errors.push(`Missing workflow stage agent: ${stageAgentPath}`);
      } else {
        const stageAgent = await readYamlFile<AgentSpec>(stageAgentPath);
        errors.push(...(await validateObject(ajv, 'agent', path.relative(workspaceRoot, stageAgentPath), stageAgent)));
      }
    }

    if (stage.evaluator) {
      const stageEvaluatorPath = path.join(workspaceRoot, 'agents', stage.evaluator);
      if (!(await pathExists(stageEvaluatorPath))) {
        errors.push(`Missing workflow stage evaluator: ${stageEvaluatorPath}`);
      } else {
        const stageEvaluator = await readYamlFile<AgentSpec>(stageEvaluatorPath);
        errors.push(
          ...(await validateObject(ajv, 'agent', path.relative(workspaceRoot, stageEvaluatorPath), stageEvaluator))
        );
      }
    }

    if (stage.harness) {
      const stageHarnessPath = path.join(workspaceRoot, 'agents', stage.harness);
      if (!(await pathExists(stageHarnessPath))) {
        errors.push(`Missing workflow stage harness: ${stageHarnessPath}`);
      } else {
        const stageHarness = await readYamlFile<HarnessSpec>(stageHarnessPath);
        errors.push(...(await validateObject(ajv, 'harness', path.relative(workspaceRoot, stageHarnessPath), stageHarness)));
      }
    }
  }

  const connectorIds = new Set<string>();
  for (const source of loop.discovery.sources) {
    if (source.connector) {
      connectorIds.add(source.connector);
    }
    if (source.path) {
      const memoryPath =
        source.type === 'memory'
          ? resolveMemoryPath(memoryRoot, source.path)
          : resolveWorkspacePath(workspaceRoot, source.path);
      if (!(await pathExists(memoryPath))) {
        errors.push(`Missing discovery path: ${memoryPath}`);
      }
    }
  }
  for (const output of loop.persistence.outputs) {
    if (output.connector) {
      connectorIds.add(output.connector);
    }
  }

  for (const connectorId of connectorIds) {
    const connectorPath = path.join(workspaceRoot, 'connectors', `${connectorId}.yaml`);
    if (!(await pathExists(connectorPath))) {
      errors.push(`Missing connector: ${connectorPath}`);
      continue;
    }
    const connector = await readYamlFile<ConnectorSpec>(connectorPath);
    errors.push(...(await validateObject(ajv, 'connector', path.relative(workspaceRoot, connectorPath), connector)));
  }

  return {
    ok: errors.length === 0,
    errors
  };
}
