import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import {
  createAcpServerState,
  handleAcpMessage,
  handleAcpWireMessage
} from '../packages/acp-server/src/acpStdioServer';
import {
  callXiaobaiMcpTool,
  listXiaobaiMcpTools
} from '../packages/mcp-server/src/xiaobaiMcpServer';
import { ProviderRuntime } from '../packages/provider-runtime/src/providerRuntime';
import { TaskRuntime } from '../packages/task-runtime/src/taskRuntime';
import { LoopSpec, RuntimePlan, TaskEnvelope } from '../packages/shared/src/types';

async function createRuntime(taskClock = '2026-08-15T00:00:00.000Z') {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'mcp-acp-'));
  const runtime = new TaskRuntime({
    workspaceRoot: tempRoot,
    memoryRoot: path.join(tempRoot, 'memory'),
    loop: loopFixture(),
    plan: planFixture(),
    now: () => new Date(taskClock)
  });
  return {
    taskRuntime: runtime,
    providerRuntime: new ProviderRuntime(),
    defaultProjectId: 't-max',
    defaultRepositoryId: 'operateBusiness'
  };
}

test('MCP task create has the same task semantics as direct runtime create', async () => {
  const direct = await createRuntime();
  const viaMcp = await createRuntime();

  const directTask = await direct.taskRuntime.create({
    taskId: 'task-1',
    request: {
      entryPoint: 'cli',
      projectId: 't-max',
      repositoryId: 'operateBusiness',
      subject: { title: 'same task' },
      requestedActions: ['read']
    }
  });
  const mcpTask = await callXiaobaiMcpTool(viaMcp, 'xiaobai_task_create', {
    taskId: 'task-1',
    projectId: 't-max',
    repositoryId: 'operateBusiness',
    subject: { title: 'same task' },
    requestedActions: ['read']
  }) as TaskEnvelope;

  assert.equal(mcpTask.taskId, directTask.taskId);
  assert.equal(mcpTask.state, directTask.state);
  assert.deepEqual(mcpTask.subject, directTask.subject);
  assert.deepEqual(mcpTask.requestedActions, directTask.requestedActions);
  assert.equal(mcpTask.projectRoute?.projectId, directTask.projectRoute?.projectId);
});

test('ACP handler maps JSON messages to task runtime operations', async () => {
  const runtime = await createRuntime();
  const tools = await handleAcpMessage(runtime, { id: 1, method: 'xiaobai/tools.list' });
  assert.equal(tools.id, 1);
  assert(Array.isArray(tools.result?.tools));
  assert(listXiaobaiMcpTools().some((tool) => tool.name === 'xiaobai_task_create'));

  const created = await handleAcpMessage(runtime, {
    id: 2,
    method: 'xiaobai/task.create',
    params: {
      taskId: 'task-1',
      projectId: 't-max',
      repositoryId: 'operateBusiness',
      subject: { title: 'ACP task' },
      requestedActions: ['read']
    }
  });
  assert.equal(created.id, 2);
  assert.equal(((created.result?.output as TaskEnvelope).state), 'prepared');
  const progress = created.result?.progress as Array<{ type: string }> | undefined;
  assert.equal(progress?.[0].type, 'completed');

  const status = await handleAcpMessage(runtime, {
    id: 3,
    method: 'xiaobai/task.status',
    params: { taskId: 'task-1' }
  });
  assert.equal(((status.result?.output as TaskEnvelope).taskId), 'task-1');
});

test('ACP handler fails closed on unsupported methods', async () => {
  const runtime = await createRuntime();
  const response = await handleAcpMessage(runtime, {
    id: 'bad',
    method: 'xiaobai/unknown'
  });

  assert.equal(response.id, 'bad');
  assert.equal(response.error?.code, 'unsupported_method');
});

test('ACP protocol handler supports initialize session and prompt over JSON-RPC', async () => {
  const runtime = await createRuntime();
  const state = createAcpServerState();
  const initialized = await handleAcpWireMessage(runtime, state, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: 1,
      clientCapabilities: {}
    }
  });
  assert.equal(initialized?.jsonrpc, '2.0');
  assert.equal(initialized?.result?.protocolVersion, 1);

  const session = await handleAcpWireMessage(runtime, state, {
    jsonrpc: '2.0',
    id: 2,
    method: 'session/new',
    params: {
      cwd: '/tmp',
      mcpServers: []
    }
  });
  const sessionId = (session?.result?.sessionId as string);
  assert.equal(typeof sessionId, 'string');
  assert.equal(state.sessions.has(sessionId), true);

  const notifications: unknown[] = [];
  const prompted = await handleAcpWireMessage(
    runtime,
    state,
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: {
        sessionId,
        prompt: [{ type: 'text', text: 'Create a Xiaobai fixture task.' }]
      }
    },
    async (message) => {
      notifications.push(message);
    }
  );

  assert.equal(prompted?.result?.stopReason, 'end_turn');
  assert.equal((notifications[0] as { method?: string }).method, 'session/update');
  const tasks = await runtime.taskRuntime.list();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].entryPoint, 'acp');
  assert.deepEqual(tasks[0].requestedActions, ['read']);
});

function loopFixture(): LoopSpec {
  return {
    kind: 'Loop',
    version: 1,
    metadata: {
      id: 'frontend-delivery',
      name: 'Frontend Delivery',
      owner: 'loop'
    },
    schedule: {
      type: 'manual',
      expression: 'manual',
      timezone: 'Asia/Shanghai'
    },
    discovery: {
      skill: 'frontend',
      sources: []
    },
    handoff: {
      strategy: 'worktree',
      project: 't-max',
      worktreeRoot: '.local/frontend-delivery/worktrees',
      branchTemplate: 'loop/frontend-delivery/{date}/{taskId}'
    },
    generator: {
      agent: 'generator.agent.yaml',
      harness: 'coding.harness.yaml'
    },
    verification: {
      evaluator: 'evaluator.agent.yaml',
      requiredChecks: [],
      allowSelfReview: false
    },
    persistence: {
      memory: {
        stateFile: 'state.md',
        inboxFile: 'inbox.md',
        runLog: 'runs.jsonl'
      },
      outputs: []
    },
    budget: {
      maxTokensPerRun: 1000,
      maxRetriesPerTask: 1,
      maxParallelTasks: 2
    },
    humanGate: {
      requiredBefore: [],
      reviewers: [],
      gates: []
    }
  };
}

function planFixture(): RuntimePlan {
  const projectContext = {
    projectId: 't-max',
    repositoryRoot: '/workspace/repos/operateBusiness',
    worktreeRoot: '/workspace/worktrees',
    skillPackage: '/workspace/projects/t-max/SKILL.md',
    memoryNamespace: 'project:t-max/loop:frontend-delivery',
    artifactRoot: '/workspace/.loop/artifacts/frontend-delivery/t-max/operateBusiness',
    policyDigest: 'a'.repeat(64)
  };
  const projectRoute = {
    projectContext,
    projectId: 't-max' as const,
    projectKind: 'ProjectGroup' as const,
    projectName: 'T-MAX',
    resolution: {
      source: 'explicit-repository' as const,
      target: 'operateBusiness',
      matchedRepositoryId: 'operateBusiness'
    },
    projectSkillPath: 'projects/t-max/SKILL.md',
    root: '.',
    defaultBranch: 'main',
    repositories: [
      {
        id: 'operateBusiness',
        name: 'operateBusiness',
        mount: 'mounts/operateBusiness'
      }
    ]
  };
  return {
    loopId: 'frontend-delivery',
    projectContext,
    projectRoute,
    loopWorkCount: 0,
    schedule: {
      type: 'manual',
      expression: 'manual',
      timezone: 'Asia/Shanghai',
      nextAction: 'manual'
    },
    budget: {
      ok: true,
      reasons: []
    },
    orchestrator: {
      agentId: 'orchestrator',
      agentFile: 'orchestrator.agent.yaml',
      role: 'orchestrator',
      routesTo: {
        discoverySkill: 'frontend',
        project: projectRoute,
        generatorAgent: 'generator.agent.yaml',
        evaluatorAgent: 'evaluator.agent.yaml',
        workflowStages: []
      }
    },
    context: {
      skillPath: 'projects/t-max/SKILL.md',
      evidenceSources: 0,
      stateFile: 'memory/state.md',
      inboxFile: 'memory/inbox.md',
      maxCharacters: 1000
    },
    findings: [],
    handoff: [],
    generatorRuns: [],
    evaluations: [],
    persistence: {
      stateFile: 'memory/state.md',
      inboxFile: 'memory/inbox.md',
      runLog: 'memory/runs.jsonl',
      plannedWrites: []
    },
    humanGate: {
      protectedActions: [],
      reviewers: [],
      gates: []
    }
  };
}
