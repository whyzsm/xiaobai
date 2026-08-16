import { randomUUID } from 'node:crypto';
import readline from 'node:readline';
import { JsonRecord } from '../../shared/src/types';
import {
  callXiaobaiMcpTool,
  listXiaobaiMcpTools,
  XiaobaiMcpRuntime,
  XiaobaiMcpToolName
} from '../../mcp-server/src/xiaobaiMcpServer';

export interface AcpJsonMessage {
  id?: string | number;
  method: string;
  params?: JsonRecord;
}

export interface AcpJsonResponse {
  jsonrpc?: '2.0';
  id?: string | number;
  result?: JsonRecord;
  error?: {
    code: string | number;
    message: string;
    data?: JsonRecord;
  };
}

export interface AcpProtocolSession {
  sessionId: string;
  cwd: string;
  cancelled: boolean;
}

export interface AcpServerState {
  sessions: Map<string, AcpProtocolSession>;
}

const methodToTool: Record<string, XiaobaiMcpToolName> = {
  'xiaobai/task.create': 'xiaobai_task_create',
  'xiaobai/task.list': 'xiaobai_task_list',
  'xiaobai/task.status': 'xiaobai_task_status',
  'xiaobai/task.claim': 'xiaobai_task_claim',
  'xiaobai/task.run': 'xiaobai_task_run',
  'xiaobai/task.submit': 'xiaobai_task_submit',
  'xiaobai/provider.profiles': 'xiaobai_provider_profiles'
};

const agentClientProtocolMethods = new Set([
  'initialize',
  'session/new',
  'session/prompt',
  'session/cancel'
]);

export function createAcpServerState(): AcpServerState {
  return {
    sessions: new Map()
  };
}

export async function handleAcpWireMessage(
  runtime: XiaobaiMcpRuntime,
  state: AcpServerState,
  message: unknown,
  sendNotification: (message: JsonRecord) => Promise<void> = async () => undefined
): Promise<AcpJsonResponse | undefined> {
  if (isRecord(message) && typeof message.method === 'string' && agentClientProtocolMethods.has(message.method)) {
    return handleAgentClientProtocolMessage(runtime, state, message, sendNotification);
  }
  if (isJsonRpcMessage(message)) {
    const legacy = await handleAcpMessage(runtime, message);
    return {
      jsonrpc: '2.0',
      id: message.id,
      ...(legacy.error
        ? { error: { code: -32000, message: legacy.error.message, data: { code: legacy.error.code } } }
        : { result: legacy.result ?? {} })
    };
  }
  return handleAcpMessage(runtime, message);
}

export async function handleAcpMessage(runtime: XiaobaiMcpRuntime, message: unknown): Promise<AcpJsonResponse> {
  if (!isAcpMessage(message)) {
    return {
      error: {
        code: 'invalid_message',
        message: 'ACP message must include method and optional params object'
      }
    };
  }
  if (message.method === 'xiaobai/tools.list') {
    return {
      id: message.id,
      result: {
        progress: [{ type: 'tool_listed', message: 'Xiaobai tools listed' }],
        tools: listXiaobaiMcpTools()
      }
    };
  }
  const toolName = methodToTool[message.method];
  if (!toolName) {
    return {
      id: message.id,
      error: {
        code: 'unsupported_method',
        message: `Unsupported ACP method: ${message.method}`
      }
    };
  }
  try {
    const result = await callXiaobaiMcpTool(runtime, toolName, message.params ?? {});
    return {
      id: message.id,
      result: {
        progress: [{ type: 'completed', method: message.method }],
        output: result
      }
    };
  } catch (error) {
    return {
      id: message.id,
      error: {
        code: 'tool_failed',
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export function startAcpJsonlServer(runtime: XiaobaiMcpRuntime): void {
  const state = createAcpServerState();
  const reader = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });
  reader.on('line', (line) => {
    void handleLine(runtime, state, line);
  });
}

async function handleLine(runtime: XiaobaiMcpRuntime, state: AcpServerState, line: string): Promise<void> {
  if (!line.trim()) return;
  let message: unknown;
  try {
    message = JSON.parse(line) as unknown;
  } catch {
    process.stdout.write(`${JSON.stringify({
      error: {
        code: 'invalid_json',
        message: 'Input line must be JSON'
      }
    })}\n`);
    return;
  }
  const response = await handleAcpWireMessage(
    runtime,
    state,
    message,
    async (notification) => {
      process.stdout.write(`${JSON.stringify(notification)}\n`);
    }
  );
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function handleAgentClientProtocolMessage(
  runtime: XiaobaiMcpRuntime,
  state: AcpServerState,
  message: JsonRecord,
  sendNotification: (message: JsonRecord) => Promise<void>
): Promise<AcpJsonResponse | undefined> {
  const id = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : undefined;
  const params = isRecord(message.params) ? message.params : {};

  try {
    if (message.method === 'initialize') {
      return jsonRpcResult(id, {
        protocolVersion: 1,
        agentInfo: {
          name: 'xiaobai-acp',
          version: '0.1.0'
        },
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: {},
          sessionCapabilities: {}
        },
        authMethods: []
      });
    }

    if (message.method === 'session/new') {
      const cwd = requiredString(params, 'cwd');
      const sessionId = randomUUID();
      state.sessions.set(sessionId, {
        sessionId,
        cwd,
        cancelled: false
      });
      return jsonRpcResult(id, { sessionId });
    }

    if (message.method === 'session/cancel') {
      const sessionId = requiredString(params, 'sessionId');
      const session = state.sessions.get(sessionId);
      if (session) session.cancelled = true;
      return id === undefined ? undefined : jsonRpcResult(id, {});
    }

    if (message.method === 'session/prompt') {
      const sessionId = requiredString(params, 'sessionId');
      const session = state.sessions.get(sessionId);
      if (!session) throw new Error(`Unknown ACP session: ${sessionId}`);
      if (session.cancelled) return jsonRpcResult(id, { stopReason: 'cancelled' });

      const promptText = promptTextFromParams(params);
      const task = await runtime.taskRuntime.create({
        request: {
          entryPoint: 'acp',
          projectId: runtime.defaultProjectId ?? 'acp',
          repositoryId: runtime.defaultRepositoryId,
          subject: {
            acpSessionId: sessionId,
            cwd: session.cwd,
            prompt: promptText
          },
          requestedActions: ['read'],
          provider: {
            mode: 'client',
            profileId: 'client-submission'
          },
          createdBy: 'acp-client'
        }
      });
      await sendNotification({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: summarizeAcpTaskOutput(task)
            }
          }
        }
      });
      return jsonRpcResult(id, { stopReason: 'end_turn' });
    }

    return jsonRpcError(id, -32601, `Method not found: ${String(message.method)}`);
  } catch (error) {
    return jsonRpcError(id, -32000, error instanceof Error ? error.message : String(error));
  }
}

function jsonRpcResult(id: string | number | undefined, result: JsonRecord): AcpJsonResponse {
  return id === undefined
    ? { jsonrpc: '2.0', result }
    : { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: string | number | undefined, code: number, message: string): AcpJsonResponse {
  return id === undefined
    ? { jsonrpc: '2.0', error: { code, message } }
    : { jsonrpc: '2.0', id, error: { code, message } };
}

function promptTextFromParams(params: JsonRecord): string {
  const prompt = params.prompt;
  if (!Array.isArray(prompt)) throw new Error('session/prompt requires prompt array');
  const text = prompt.flatMap((block) => {
    if (!isRecord(block)) return [];
    if (block.type === 'text' && typeof block.text === 'string') return [block.text];
    if (block.type === 'resource_link' && typeof block.uri === 'string') return [`[resource_link] ${block.uri}`];
    return [];
  }).join('\n').trim();
  return text || '<empty prompt>';
}

function summarizeAcpTaskOutput(value: unknown): string {
  const task = value as { taskId?: string; state?: string; projectId?: string; repositoryId?: string };
  return JSON.stringify({
    type: 'xiaobai_acp_task_created',
    taskId: task.taskId,
    state: task.state,
    projectId: task.projectId,
    repositoryId: task.repositoryId,
    next: 'Use Xiaobai task status and submit flows for write results; external client output remains untrusted until Harness/evaluator/diff/policy checks pass.'
  });
}

function requiredString(input: JsonRecord, field: string): string {
  const value = input[field];
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} is required`);
  return value;
}

function isAcpMessage(value: unknown): value is AcpJsonMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.method !== 'string' || record.method.length === 0) return false;
  return record.params === undefined || (
    typeof record.params === 'object' &&
    record.params !== null &&
    !Array.isArray(record.params)
  );
}

function isJsonRpcMessage(value: unknown): value is JsonRecord & { id?: string | number; method: string } {
  return isRecord(value) && value.jsonrpc === '2.0' && typeof value.method === 'string';
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
