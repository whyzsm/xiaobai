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
import { resolveProjectRoute } from '../../project-registry/src/projectRegistry';

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

  if (loop.handoff.targetResolution?.required !== true) {
    errors.push(`Loop ${loop.metadata.id} must require explicit target resolution`);
  }

  let resolvedProject: Awaited<ReturnType<typeof resolveProjectRoute>> | undefined;
  try {
    resolvedProject = await resolveProjectRoute(workspaceRoot, loop, {
      targetProject: loop.handoff.project
    });
    if (resolvedProject.project.id !== loop.handoff.project) {
      errors.push(
        `Loop project id must match project.yaml id: loop=${loop.handoff.project}, project.yaml=${resolvedProject.project.id}`
      );
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const projectRoot = resolvedProject?.projectRoot ?? path.join(workspaceRoot, 'projects', loop.handoff.project);
  const projectSkill = path.join(projectRoot, resolvedProject?.project.skill ?? 'SKILL.md');
  const mappedDiscoverySkill = resolvedProject?.project.discoverySkills?.[loop.discovery.skill];
  if (!mappedDiscoverySkill) {
    errors.push(`Missing discovery skill mapping: ${loop.discovery.skill} for project ${loop.handoff.project}`);
  }
  const discoverySkill = path.resolve(
    projectRoot,
    mappedDiscoverySkill ?? path.join('.loop', 'skills', `${loop.discovery.skill}.SKILL.md`)
  );
  const discoverySkillRelative = path.relative(projectRoot, discoverySkill);
  if (
    discoverySkillRelative === '..' ||
    discoverySkillRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(discoverySkillRelative)
  ) {
    errors.push(`Discovery skill mapping escapes project root: ${discoverySkill}`);
  }
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
    if (generator.role !== 'maker') {
      errors.push(`Generator agent must use role: maker (${generatorPath})`);
    }
  }

  if (await pathExists(evaluatorPath)) {
    const evaluator = await readYamlFile<AgentSpec>(evaluatorPath);
    errors.push(...(await validateObject(ajv, 'agent', path.relative(workspaceRoot, evaluatorPath), evaluator)));
    if (evaluator.role !== 'checker') {
      errors.push(`Evaluator agent must use role: checker (${evaluatorPath})`);
    }
  }

  if (path.resolve(generatorPath) === path.resolve(evaluatorPath) || loop.verification.allowSelfReview) {
    errors.push('Generator and evaluator must remain independent and allowSelfReview must be false');
  }

  if (await pathExists(harnessPath)) {
    const harness = await readYamlFile<HarnessSpec>(harnessPath);
    errors.push(...(await validateObject(ajv, 'harness', path.relative(workspaceRoot, harnessPath), harness)));
  }

  if (await pathExists(budgetPath)) {
    const budget = await readYamlFile<BudgetSpec>(budgetPath);
    errors.push(...(await validateObject(ajv, 'budget', path.relative(workspaceRoot, budgetPath), budget)));
  }

  const gateDefinitions = loop.humanGate.gates ?? [];
  const gateIds = new Set<string>();
  const gateActions = new Set<string>();
  const gateReviewers = new Set<string>();
  for (const gate of gateDefinitions) {
    if (gateIds.has(gate.id)) {
      errors.push(`Duplicate human gate id: ${gate.id}`);
    }
    gateIds.add(gate.id);
    gateActions.add(gate.requiredBefore);
    for (const reviewer of gate.reviewers) gateReviewers.add(reviewer);
  }

  for (const action of loop.humanGate.requiredBefore) {
    if (!gateActions.has(action)) {
      errors.push(`Human gate protected action is not defined by a gate: ${action}`);
    }
  }
  for (const action of gateActions) {
    if (!loop.humanGate.requiredBefore.includes(action)) {
      errors.push(`Human gate definition action is not declared in requiredBefore: ${action}`);
    }
  }
  for (const reviewer of loop.humanGate.reviewers) {
    if (!gateReviewers.has(reviewer)) {
      errors.push(`Human gate reviewer is not used by any gate definition: ${reviewer}`);
    }
  }
  for (const reviewer of gateReviewers) {
    if (!loop.humanGate.reviewers.includes(reviewer)) {
      errors.push(`Human gate definition reviewer is not declared in reviewers: ${reviewer}`);
    }
  }

  const workflowStageIds = new Set<string>();
  const assignedChecks = new Set<string>();
  for (const stage of loop.workflow?.stages ?? []) {
    if (workflowStageIds.has(stage.id)) {
      errors.push(`Duplicate workflow stage id: ${stage.id}`);
    }

    for (const dependency of stage.dependsOn ?? []) {
      if (!workflowStageIds.has(dependency)) {
        errors.push(`Workflow stage ${stage.id} depends on an unknown or non-prior stage: ${dependency}`);
      }
    }
    workflowStageIds.add(stage.id);

    for (const requiredCheck of stage.requiredChecks ?? []) {
      assignedChecks.add(requiredCheck);
      if (!loop.verification.requiredChecks.includes(requiredCheck)) {
        errors.push(`Workflow stage ${stage.id} uses undeclared verification check: ${requiredCheck}`);
      }
    }
    for (const requiredGate of stage.requiredGates ?? []) {
      if (!gateIds.has(requiredGate)) {
        errors.push(`Workflow stage ${stage.id} requires an undefined human gate: ${requiredGate}`);
      }
    }

    const ownerCount = Number(Boolean(stage.agent)) + Number(Boolean(stage.evaluator));
    if (stage.gate === 'manual') {
      if (stage.kind !== 'human-gate' || ownerCount !== 0) {
        errors.push(`Manual workflow stage must be an ownerless human-gate: ${stage.id}`);
      }
      const gate = gateDefinitions.find((item) => item.id === stage.id);
      if (!gate) {
        errors.push(`Manual workflow stage has no matching human gate definition: ${stage.id}`);
      } else if (!(stage.requiredBefore ?? []).includes(gate.requiredBefore)) {
        errors.push(
          `Manual workflow stage ${stage.id} does not declare its protected action: ${gate.requiredBefore}`
        );
      }
    } else if (ownerCount !== 1) {
      errors.push(`Automatic workflow stage must declare exactly one agent or evaluator: ${stage.id}`);
    }

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

  if (loop.workflow) {
    for (const requiredCheck of loop.verification.requiredChecks) {
      if (!assignedChecks.has(requiredCheck)) {
        errors.push(`Verification check is not assigned to any workflow stage: ${requiredCheck}`);
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
