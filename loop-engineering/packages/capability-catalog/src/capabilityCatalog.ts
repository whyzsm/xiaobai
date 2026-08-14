import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { executionEventTypeCatalog } from '../../execution-runtime/src/executionEvents';
import { readYamlFile } from '../../shared/src/fs';
import { AgentSpec, HarnessSpec, LoopSpec, LoopWorkflowStage } from '../../shared/src/types';

export interface CapabilityCatalog {
  kind: 'CapabilityCatalog';
  version: 1;
  source: 'workspace-config';
  eventPlanes: Array<{
    id: 'workflow-control' | 'execution-facts' | 'authorization';
    store: string;
    eventTypes?: string[];
  }>;
  loops: LoopCapability[];
}

export interface LoopCapability {
  loopId: string;
  orchestrator: string | null;
  generator: string;
  evaluator: string;
  allowSelfReview: boolean;
  stages: StageCapability[];
  gates: Array<{
    id: string;
    action: string;
    evidenceTypes: string[];
    maxAgeMinutes: number;
  }>;
}

export interface StageCapability {
  stageId: string;
  kind: string;
  owner: string;
  ownerType: 'generator' | 'evaluator' | 'human';
  gate: 'automatic' | 'manual';
  harness: string | null;
  toolPolicy: {
    enforcement: 'none' | 'executor-reported-engine-validated';
    allow: string[];
    deny: string[];
  };
  contextLoaders: string[];
  requiredChecks: string[];
  requiredGates: string[];
  outputs: string[];
}

export async function generateCapabilityCatalog(workspaceRoot: string): Promise<CapabilityCatalog> {
  const loopDirectory = path.join(workspaceRoot, 'loops');
  const loopFiles = (await readdir(loopDirectory)).filter((file) => file.endsWith('.loop.yaml')).sort();
  const loops = await Promise.all(
    loopFiles.map((file) => readYamlFile<LoopSpec>(path.join(loopDirectory, file)))
  );
  return {
    kind: 'CapabilityCatalog',
    version: 1,
    source: 'workspace-config',
    eventPlanes: [
      { id: 'workflow-control', store: 'loops/<loopId>/stage-events.jsonl' },
      {
        id: 'execution-facts',
        store: 'loops/<loopId>/runs/<runId>/execution-events.jsonl',
        eventTypes: [...executionEventTypeCatalog]
      },
      { id: 'authorization', store: 'loops/<loopId>/passes.jsonl' }
    ],
    loops: await Promise.all(loops.map((loop) => catalogLoop(workspaceRoot, loop)))
  };
}

async function catalogLoop(workspaceRoot: string, loop: LoopSpec): Promise<LoopCapability> {
  const agentCache = new Map<string, Promise<AgentSpec>>();
  const harnessCache = new Map<string, Promise<HarnessSpec>>();
  const loadAgent = (file: string): Promise<AgentSpec> => {
    const existing = agentCache.get(file);
    if (existing) return existing;
    const pending = readYamlFile<AgentSpec>(path.join(workspaceRoot, 'agents', file));
    agentCache.set(file, pending);
    return pending;
  };
  const loadHarness = (file: string): Promise<HarnessSpec> => {
    const existing = harnessCache.get(file);
    if (existing) return existing;
    const pending = readYamlFile<HarnessSpec>(path.join(workspaceRoot, 'agents', file));
    harnessCache.set(file, pending);
    return pending;
  };

  const stages = await Promise.all(
    (loop.workflow?.stages ?? []).map((stage) => catalogStage(stage, loop, loadAgent, loadHarness))
  );
  return {
    loopId: loop.metadata.id,
    orchestrator: loop.orchestrator?.agent ?? null,
    generator: loop.generator.agent,
    evaluator: loop.verification.evaluator,
    allowSelfReview: loop.verification.allowSelfReview,
    stages,
    gates: loop.humanGate.gates.map((gate) => ({
      id: gate.id,
      action: gate.requiredBefore,
      evidenceTypes: [...gate.requiredEvidenceTypes],
      maxAgeMinutes: gate.maxAgeMinutes
    }))
  };
}

async function catalogStage(
  stage: LoopWorkflowStage,
  loop: LoopSpec,
  loadAgent: (file: string) => Promise<AgentSpec>,
  loadHarness: (file: string) => Promise<HarnessSpec>
): Promise<StageCapability> {
  const ownerFile = stage.agent ?? stage.evaluator;
  const ownerType = stage.agent ? 'generator' : stage.evaluator ? 'evaluator' : 'human';
  const owner = ownerFile
    ? (await loadAgent(ownerFile)).id
    : loop.metadata.owner;
  const harness = stage.harness ? await loadHarness(stage.harness) : null;
  return {
    stageId: stage.id,
    kind: stage.kind,
    owner,
    ownerType,
    gate: stage.gate ?? 'automatic',
    harness: stage.harness ?? null,
    toolPolicy: {
      enforcement: harness ? 'executor-reported-engine-validated' : 'none',
      allow: harness ? [...harness.tools.allow] : [],
      deny: harness ? [...harness.tools.deny] : []
    },
    contextLoaders: harness ? [...harness.context.loaders] : [],
    requiredChecks: [...(stage.requiredChecks ?? [])],
    requiredGates: [...(stage.requiredGates ?? [])],
    outputs: [...(stage.outputs ?? [])]
  };
}
