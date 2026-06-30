export type JsonRecord = Record<string, unknown>;

export interface LoopSpec {
  kind: 'Loop';
  version: number;
  metadata: {
    id: string;
    name: string;
    owner: string;
  };
  schedule: {
    type: string;
    expression: string;
    timezone: string;
  };
  discovery: {
    skill: string;
    sources: DiscoverySource[];
  };
  orchestrator?: {
    agent: string;
  };
  handoff: {
    strategy: string;
    project: string;
    targetResolution?: {
      required?: boolean;
    };
    worktreeRoot: string;
    branchTemplate: string;
  };
  generator: {
    agent: string;
    harness: string;
  };
  verification: {
    evaluator: string;
    requiredChecks: string[];
    allowSelfReview: boolean;
  };
  persistence: {
    memory: {
      stateFile: string;
      inboxFile: string;
      runLog: string;
    };
    outputs: OutputTarget[];
  };
  budget: BudgetLimits;
  humanGate: {
    requiredBefore: string[];
    reviewers: string[];
  };
  workflow?: {
    stages: LoopWorkflowStage[];
  };
}

export interface LoopWorkflowStage {
  id: string;
  kind: string;
  gate?: 'automatic' | 'manual';
  agent?: string;
  harness?: string;
  evaluator?: string;
  requiredChecks?: string[];
  requiredBefore?: string[];
  outputs?: string[];
}

export interface DiscoverySource {
  type: string;
  connector?: string;
  path?: string;
}

export interface OutputTarget {
  type: string;
  connector?: string;
  path?: string;
}

export interface HarnessSpec {
  kind: 'Harness';
  version: number;
  metadata: {
    id: string;
  };
  tools: {
    allow: string[];
    deny: string[];
  };
  context: {
    loaders: string[];
    maxCharacters: number;
  };
  completion: {
    type: string;
    conditions: string[];
  };
  failure: Record<string, string>;
  output: {
    required: string[];
  };
}

export interface AgentSpec {
  kind: 'Agent';
  id: string;
  role: string;
  stance?: string;
  instructions: string[];
  model: {
    preference: string;
  };
  tools?: {
    allow: string[];
  };
}

export interface ProjectSpec {
  kind: 'Project' | 'ProjectGroup';
  id: string;
  name: string;
  root: string;
  defaultBranch: string;
  skill: string;
  localPaths?: string;
  background?: ProjectBackground;
  repositories?: ProjectRepository[];
}

export interface ProjectBackground {
  id: string;
  name: string;
  localPathKey: string;
  mount: string;
}

export interface ProjectRepository {
  id: string;
  name: string;
  localPathKey?: string;
  mount: string;
  remote?: string;
}

export type ProjectRouteSource =
  | 'explicit-project'
  | 'explicit-repository'
  | 'cwd'
  | 'remote'
  | 'loop-default';

export interface ProjectRouteResolution {
  source: ProjectRouteSource;
  target?: string;
  matchedRepositoryId?: string;
  matchedRemote?: string;
  matchedPath?: string;
}

export interface ConnectorSpec {
  kind: 'Connector';
  id: string;
  capabilities: string[];
  permissions: {
    write: {
      allow: string[];
      deny: string[];
    };
  };
  rateLimit: {
    maxCallsPerRun: number;
  };
  config?: {
    baseUrl?: string;
    [key: string]: unknown;
  };
  auth?: {
    type: string;
    tokenEnv?: string;
  };
  mock?: JsonRecord;
}

export interface BudgetSpec {
  kind: 'Budget';
  id: string;
  limits: BudgetLimits;
  onExceeded: {
    action: string;
    persistToInbox: boolean;
    notify?: {
      connector: string;
      channel: string;
    };
  };
}

export interface BudgetLimits {
  maxTokensPerRun: number;
  maxTokensPerDay?: number;
  maxCostPerDayUsd?: number;
  maxRetriesPerTask: number;
  maxParallelTasks: number;
  maxRunsPerDay?: number;
  maxWallClockMinutesPerRun?: number;
}

export interface SkillDocument {
  id: string;
  path: string;
  content: string;
  decisionRules: string[];
}

export interface ConnectorEvidence {
  sourceType: string;
  connectorId: string;
  items: JsonRecord[];
}

export interface DiscoveryContext {
  loopId: string;
  projectId: string;
  skill: SkillDocument;
  state: string;
  inbox: string;
  evidence: ConnectorEvidence[];
  maxCharacters: number;
}

export interface Finding {
  id: string;
  title: string;
  evidence: string[];
  suspectedArea: string;
  suggestedNextAction: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface WorktreePlan {
  taskId: string;
  loopId: string;
  project: string;
  branch: string;
  path: string;
  finding: Finding;
}

export interface AgentRunPlan {
  taskId: string;
  agentId: string;
  harnessId: string;
  worktreePath: string;
  expectedOutput: string[];
}

export interface EvaluationPlan {
  taskId: string;
  evaluatorId: string;
  requiredChecks: string[];
  decision: 'pending_independent_review';
  allowSelfReview: boolean;
}

export interface HumanGatePlan {
  protectedActions: string[];
  reviewers: string[];
}

export interface ProjectRoutePlan {
  projectId: string;
  projectKind: ProjectSpec['kind'];
  projectName: string;
  resolution: ProjectRouteResolution;
  projectSkillPath: string;
  root: string;
  defaultBranch: string;
  background?: {
    id: string;
    name: string;
    mount: string;
  };
  repositories: Array<{
    id: string;
    name: string;
    mount: string;
    remote?: string;
  }>;
}

export interface OrchestratorPlan {
  agentId: string;
  agentFile: string;
  role: string;
  stance?: string;
  routesTo: {
    discoverySkill: string;
    project: ProjectRoutePlan;
    generatorAgent: string;
    evaluatorAgent: string;
    workflowStages: string[];
  };
}

export interface WorkflowStagePlan {
  id: string;
  kind: string;
  status: 'planned';
  gate: 'automatic' | 'manual';
  agent?: string;
  harness?: string;
  evaluator?: string;
  requiredChecks: string[];
  requiredBefore: string[];
  outputs: string[];
}

export interface WorkflowPlan {
  stages: WorkflowStagePlan[];
}

export interface RuntimePlan {
  loopId: string;
  schedule: {
    type: string;
    expression: string;
    timezone: string;
    nextAction: string;
  };
  budget: {
    ok: boolean;
    reasons: string[];
  };
  orchestrator?: OrchestratorPlan;
  context: {
    skillPath: string;
    evidenceSources: number;
    stateFile: string;
    inboxFile: string;
    maxCharacters: number;
  };
  findings: Finding[];
  handoff: WorktreePlan[];
  generatorRuns: AgentRunPlan[];
  evaluations: EvaluationPlan[];
  persistence: {
    stateFile: string;
    inboxFile: string;
    runLog: string;
    plannedWrites: string[];
  };
  humanGate: HumanGatePlan;
  workflow?: WorkflowPlan;
  memoryContext?: {
    indexPath: string;
    included: Array<{
      path: string;
      title: string;
      kind: string;
      characters: number;
    }>;
    omitted: Array<{
      path: string;
      title: string;
      reason: string;
      characters: number;
    }>;
    warnings: string[];
  };
}

export interface SimulationStage {
  id: string;
  title: string;
  status: 'completed' | 'skipped';
  detail: string;
  outputs: string[];
}

export interface SimulationArtifact {
  reportPath: string;
  statePath: string;
  runLogPath: string;
  findingsPath: string;
  metricsPath: string;
  casePath: string;
  obsidianCasePath?: string;
  casesIndexPath: string;
  patternsIndexPath: string;
}

export interface SimulationResult {
  runId: string;
  loopId: string;
  mode: 'simulation';
  stages: SimulationStage[];
  artifacts: SimulationArtifact;
  summary: {
    findings: number;
    generatorRuns: number;
    evaluatorRuns: number;
    knowledgeCases: number;
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}
