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
    gates: HumanGateDefinition[];
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
  dependsOn?: string[];
  requiredChecks?: string[];
  requiredGates?: string[];
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
  runtime?: ProjectBackgroundRuntime;
}

export interface ProjectBackgroundRuntime {
  type: 'manifest-source' | 'context-only';
}

export type ProjectExecutor = 'xiaobai' | 'xiaoneng';

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

export interface XiaonengSourceFileEvidence {
  path: string;
  hash: string;
  purpose: string;
}

export interface XiaonengSkillContext {
  contractVersion: string;
  skillId: string;
  skillCommit: string;
  entryPath: string;
  entryHash: string;
  manifestPath: string;
  manifestDigest: string;
  executionMode: string;
  ownerAgent: string;
  ownerSkills: string[];
  selectedReferences: Array<{ id: string; path: string; digest: string }>;
  contextDigest: string;
}

export interface XiaonengSourceConsumptionEvidence {
  sourceRoot: string;
  manifestPath: string;
  entryPath: string;
  files: XiaonengSourceFileEvidence[];
  consumedBy: string;
  consumedAt: string;
}

export interface TaskContextLock {
  taskId: string;
  projectId: string;
  projectKind: ProjectSpec['kind'];
  projectScopeRepositories: string[];
  targetRepository: string;
  targetMount: string;
  backgroundMount: string;
  authorizedActions: string[];
  branch: string;
  head: string;
  worktreeStatus: string[];
  lockedAt: string;
}

export interface XiaonengRuntimePlan {
  skillContext: XiaonengSkillContext;
  sourceConsumption: XiaonengSourceConsumptionEvidence;
  taskContextLock: TaskContextLock;
}

export interface XiaonengHandoffPlan {
  executor: 'xiaoneng';
  agentId: string;
  source: 'mounted-background';
  sourceRoot: string;
  entryPath: string;
  manifestPath: string;
  executionMode: string;
  ownerAgent: string;
  ownerSkills: string[];
  targetRepository: string;
}

export interface RuntimeExecutionPlan {
  executor: ProjectExecutor;
  source: 'workspace-agent' | 'mounted-background';
  agentId: string;
  handoff?: XiaonengHandoffPlan;
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

export type HarnessEvidenceType =
  | 'command'
  | 'file'
  | 'diff'
  | 'test'
  | 'browser'
  | 'review'
  | 'human-approval'
  | 'other';

export interface HarnessRunEvidence {
  checkId: string;
  type: HarnessEvidenceType;
  value: string;
}

export interface HarnessRunSubmission {
  runId: string;
  taskId: string;
  agentId: string;
  harnessId: string;
  startedAt: string;
  finishedAt: string;
  loadedContext: string[];
  contextCharactersUsed: number;
  toolsUsed: string[];
  completedConditions: string[];
  output: JsonRecord;
  evidence: HarnessRunEvidence[];
}

export interface HarnessRunResult {
  runId: string;
  taskId: string;
  agentId: string;
  harnessId: string;
  status: 'passed' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  checks: {
    identity: boolean;
    context: boolean;
    tools: boolean;
    completion: boolean;
    output: boolean;
    evidence: boolean;
  };
  violations: {
    submissionErrors: string[];
    identityErrors: string[];
    missingContextLoaders: string[];
    contextLimitExceeded: boolean;
    deniedTools: string[];
    unallowedTools: string[];
    missingConditions: string[];
    unknownConditions: string[];
    missingOutputs: string[];
    missingEvidence: string[];
  };
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
  gates: HumanGateDefinition[];
}

export interface HumanGateDefinition {
  id: string;
  requiredBefore: string;
  reviewers: string[];
  subjectFields: string[];
  requiredEvidenceTypes: HarnessEvidenceType[];
  maxAgeMinutes: number;
}

export interface GatePassEvidence {
  type: HarnessEvidenceType;
  value: string;
}

export interface GatePassEvent {
  kind: 'GatePass';
  version: 1;
  id: string;
  passId: string;
  loopId: string;
  runId: string;
  taskId: string;
  stageId?: string;
  gateId: string;
  action: string;
  status: 'granted' | 'revoked';
  issuer: string;
  subjectDigest: string;
  evidence: GatePassEvidence[];
  issuedAt: string;
  expiresAt?: string;
  reason?: string;
}

export interface GateGrantInput {
  runId: string;
  taskId: string;
  stageId?: string;
  gateId: string;
  issuer: string;
  subjectDigest: string;
  evidence: GatePassEvidence[];
  now?: Date;
}

export interface GateCheckInput {
  runId: string;
  taskId: string;
  stageId?: string;
  action?: string;
  subjectDigest: string;
  now?: Date;
}

export interface GateDecision {
  status: 'passed' | 'blocked';
  requiredGates: string[];
  satisfiedGates: string[];
  blockingReasons: string[];
  passes: GatePassEvent[];
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
    runtime?: ProjectBackgroundRuntime;
  };
  repositories: Array<{
    id: string;
    name: string;
    mount: string;
    remote?: string;
  }>;
  targetRepository?: {
    id: string;
    name: string;
    mount: string;
    remote?: string;
  };
}

export interface OrchestratorPlan {
  agentId: string;
  agentFile: string;
  role: string;
  stance?: string;
  effective: EffectiveOrchestrator;
  routesTo: {
    discoverySkill: string;
    project: ProjectRoutePlan;
    generatorAgent?: string;
    evaluatorAgent?: string;
    workflowStages: string[];
  };
}

export interface EffectiveOrchestrator {
  agentId: string;
  source: 'loop-config' | 'manifest-source';
  entryPath?: string;
  manifestPath?: string;
  executionMode?: string;
  ownerAgent?: string;
  ownerSkills?: string[];
}

export interface WorkflowStagePlan {
  id: string;
  kind: string;
  status: 'planned';
  gate: 'automatic' | 'manual';
  agent?: string;
  harness?: string;
  evaluator?: string;
  dependsOn: string[];
  requiredChecks: string[];
  requiredGates: string[];
  requiredBefore: string[];
  outputs: string[];
}

export interface WorkflowPlan {
  stages: WorkflowStagePlan[];
}

export interface RuntimePlan {
  loopId: string;
  loopWorkCount: number;
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
  execution: RuntimeExecutionPlan;
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
  xiaoneng?: XiaonengRuntimePlan;
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
  loopWorkCount: number;
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
