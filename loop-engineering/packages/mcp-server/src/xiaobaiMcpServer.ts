import {
  JsonRecord,
  RepositoryAction,
  TaskEnvelope,
  TaskRequest
} from '../../shared/src/types';
import { ClientSubmissionRuntime } from '../../client-submission-runtime/src/clientSubmissionRuntime';
import { ProviderRuntime } from '../../provider-runtime/src/providerRuntime';
import { parseRepositoryAction, TaskRuntime } from '../../task-runtime/src/taskRuntime';

export type XiaobaiMcpToolName =
  | 'xiaobai_task_create'
  | 'xiaobai_task_list'
  | 'xiaobai_task_status'
  | 'xiaobai_task_claim'
  | 'xiaobai_task_run'
  | 'xiaobai_task_submit'
  | 'xiaobai_provider_profiles';

export interface XiaobaiMcpTool {
  name: XiaobaiMcpToolName;
  description: string;
  inputSchema: JsonRecord;
}

export interface XiaobaiMcpRuntime {
  taskRuntime: TaskRuntime;
  clientSubmissionRuntime?: ClientSubmissionRuntime;
  providerRuntime?: ProviderRuntime;
  defaultProjectId?: string;
  defaultRepositoryId?: string;
}

export function listXiaobaiMcpTools(): XiaobaiMcpTool[] {
  return [
    tool('xiaobai_task_create', 'Create a Xiaobai task envelope.'),
    tool('xiaobai_task_list', 'List Xiaobai task envelopes.'),
    tool('xiaobai_task_status', 'Read one Xiaobai task envelope.'),
    tool('xiaobai_task_claim', 'Attach a workspace lease id to a task.'),
    tool('xiaobai_task_run', 'Move a task to running.'),
    tool('xiaobai_task_submit', 'Submit external client-mode task output.'),
    tool('xiaobai_provider_profiles', 'List provider runtime profiles.')
  ];
}

export async function callXiaobaiMcpTool(
  runtime: XiaobaiMcpRuntime,
  name: XiaobaiMcpToolName,
  input: JsonRecord
): Promise<unknown> {
  switch (name) {
    case 'xiaobai_task_create':
      return runtime.taskRuntime.create({
        taskId: stringValue(input.taskId),
        request: taskRequestFromInput(input)
      });
    case 'xiaobai_task_list':
      return runtime.taskRuntime.list();
    case 'xiaobai_task_status':
      return runtime.taskRuntime.require(requiredString(input, 'taskId'));
    case 'xiaobai_task_claim':
      return runtime.taskRuntime.transition({
        taskId: requiredString(input, 'taskId'),
        eventType: 'task/leased',
        state: 'leased',
        data: {
          workspaceLeaseId: requiredString(input, 'workspaceLeaseId'),
          owner: stringValue(input.owner) ?? 'mcp'
        }
      });
    case 'xiaobai_task_run':
      return runtime.taskRuntime.transition({
        taskId: requiredString(input, 'taskId'),
        eventType: 'task/running',
        state: 'running'
      });
    case 'xiaobai_task_submit':
      if (!runtime.clientSubmissionRuntime) {
        throw new Error('client_submission_verifier_required');
      }
      return runtime.clientSubmissionRuntime.submit({
        taskRuntime: runtime.taskRuntime,
        taskId: requiredString(input, 'taskId'),
        submission: recordValue(input.submission, 'submission'),
        runId: stringValue(input.runId),
        stageId: stringValue(input.stageId),
        worktreePath: stringValue(input.worktreePath)
      });
    case 'xiaobai_provider_profiles':
      return (runtime.providerRuntime ?? new ProviderRuntime()).listProfiles();
  }
}

function taskRequestFromInput(input: JsonRecord): TaskRequest {
  return {
    entryPoint: 'mcp',
    projectId: requiredString(input, 'projectId'),
    repositoryId: stringValue(input.repositoryId),
    loopId: stringValue(input.loopId),
    runId: stringValue(input.runId),
    title: stringValue(input.title),
    subject: recordValue(input.subject, 'subject'),
    requestedActions: actionArray(input.requestedActions),
    provider: {
      profileId: stringValue(input.providerProfileId),
      mode: input.providerMode === 'managed' ? 'managed' : 'client'
    },
    createdBy: stringValue(input.createdBy),
    metadata: input.metadata === undefined ? undefined : recordValue(input.metadata, 'metadata')
  };
}

function actionArray(value: unknown): RepositoryAction[] {
  if (!Array.isArray(value) || value.length === 0) return ['read'];
  return value.map((item) => parseRepositoryAction(String(item)));
}

function tool(name: XiaobaiMcpToolName, description: string): XiaobaiMcpTool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      additionalProperties: true
    }
  };
}

function requiredString(input: JsonRecord, field: string): string {
  const value = stringValue(input[field]);
  if (!value) throw new Error(`${field} is required`);
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function recordValue(value: unknown, field: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a JSON object`);
  }
  return value as JsonRecord;
}

export function summarizeMcpTaskResult(value: unknown): JsonRecord {
  const task = value as Partial<TaskEnvelope>;
  return {
    taskId: task.taskId,
    state: task.state,
    projectId: task.projectId,
    repositoryId: task.repositoryId,
    events: task.events?.length
  };
}
