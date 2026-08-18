import { canonicalizeJson, sha256Hex } from '../../shared/src/canonicalDigest';
import {
  GatePassEvidence,
  HarnessSpec,
  JsonRecord,
  ResolvedBackgroundContext,
  TaskEnvelope,
  WorkflowStagePlan
} from '../../shared/src/types';

export interface ProviderPromptInput {
  task: TaskEnvelope;
  stage: WorkflowStagePlan;
  harness: HarnessSpec;
  gateEvidence?: GatePassEvidence[];
  backgroundContext?: ResolvedBackgroundContext;
  outputSchema: JsonRecord;
}

export interface ProviderPromptPayload {
  taskId: string;
  stageId: string;
  prompt: string;
  promptDigest: string;
  payload: JsonRecord;
}

export class PromptRuntime {
  assemble(input: ProviderPromptInput): ProviderPromptPayload {
    const payload = buildPayload(input);
    const canonical = canonicalizeJson(payload);
    const promptDigest = sha256Hex(canonical);
    return {
      taskId: input.task.taskId,
      stageId: input.stage.id,
      payload,
      promptDigest,
      prompt: `Execute Xiaobai task ${input.task.taskId} stage ${input.stage.id} with the provider-neutral JSON payload below.\n\n${canonical}`
    };
  }
}

function buildPayload(input: ProviderPromptInput): JsonRecord {
  return {
    contract: 'xiaobai-provider-prompt-v1',
    task: {
      taskId: input.task.taskId,
      state: input.task.state,
      entryPoint: input.task.entryPoint,
      projectId: input.task.projectId,
      repositoryId: input.task.repositoryId ?? null,
      requestedActions: input.task.requestedActions,
      providerMode: input.task.providerMode,
      workspaceLeaseId: input.task.workspaceLeaseId ?? null,
      gateRequirements: input.task.gateRequirements,
      subject: input.task.subject
    },
    stage: {
      id: input.stage.id,
      kind: input.stage.kind,
      gate: input.stage.gate,
      owner: input.stage.agent ?? input.stage.evaluator ?? null,
      requiredChecks: input.stage.requiredChecks,
      requiredGates: input.stage.requiredGates,
      requiredBefore: input.stage.requiredBefore,
      outputs: input.stage.outputs
    },
    harness: {
      id: input.harness.metadata.id,
      allowedTools: input.harness.tools.allow,
      deniedTools: input.harness.tools.deny,
      contextLoaders: input.harness.context.loaders,
      maxCharacters: input.harness.context.maxCharacters,
      completionConditions: input.harness.completion.conditions,
      requiredOutput: input.harness.output.required
    },
    gates: {
      evidence: input.gateEvidence ?? []
    },
    backgroundContext: input.backgroundContext
      ? {
          kind: input.backgroundContext.kind,
          projectId: input.backgroundContext.projectId,
          backgroundId: input.backgroundContext.backgroundId,
          contextDigest: input.backgroundContext.skillContext.contextDigest,
          characters: input.backgroundContext.characters,
          documents: input.backgroundContext.documents.map((document) => ({
            roles: document.roles,
            path: document.path,
            sourceDigest: document.sourceDigest,
            contentDigest: document.contentDigest,
            selection: document.selection
          }))
        }
      : null,
    outputSchema: input.outputSchema
  };
}
