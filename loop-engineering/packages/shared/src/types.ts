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
  discoverySkills?: Record<string, string>;
  localPaths?: string;
  background?: ProjectBackground;
  repositories?: ProjectRepository[];
}

export interface ProjectBackground {
  id: string;
  name: string;
  localPathKey: string;
  mount: string;
  integration?: SkillContextIntegration;
}

export interface SkillContextIntegration {
  kind: 'skill-context';
  version: '1.0.0' | '2.0.0';
  contractVersion?: '1.0.0' | '2.0.0';
  manifest: string;
  contract: string;
  executionModes?: Record<string, string>;
  evidenceBundles?: string[];
  validators?: string[];
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
  | 'remote';

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

export interface EvaluationVerdict {
  loopId: string;
  runId: string;
  taskId: string;
  stageId: string;
  evaluatorId: string;
  independent: boolean;
  decision: 'approved' | 'rejected';
  requiredChecks: string[];
  reasons: string[];
  evidence: GatePassEvidence[];
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

export interface LegacyGatePassEvent {
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

export interface GatePassEvent extends Omit<LegacyGatePassEvent, 'version'> {
  version: 2;
  canonicalization: 'jcs-v1';
  policyDigest: string;
}

export type StoredGatePassEvent = LegacyGatePassEvent | GatePassEvent;

export interface GateGrantInput {
  runId: string;
  taskId: string;
  stageId?: string;
  gateId: string;
  issuer: string;
  subject: JsonRecord;
  evidence: GatePassEvidence[];
  now?: Date;
}

export interface GateCheckInput {
  runId: string;
  taskId: string;
  stageId?: string;
  actions?: string[];
  subject: JsonRecord;
  now?: Date;
}

export interface GateDecision {
  status: 'passed' | 'blocked';
  requiredGates: string[];
  satisfiedGates: string[];
  blockingReasons: string[];
  passes: GatePassEvent[];
}

export type StageEventType =
  | 'entered'
  | 'first_action'
  | 'waiting_started'
  | 'waiting_ended'
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'skipped';

export type StageWaitingReason =
  | 'human_input'
  | 'tool_running'
  | 'external_api'
  | 'missing_context'
  | 'approval_required'
  | 'error_blocker';

export interface StageEventKey {
  loopId: string;
  runId: string;
  taskId: string;
  stageId: string;
  attempt: number;
}

export interface StageEvent extends StageEventKey {
  kind: 'StageEvent';
  version: 1;
  id: string;
  stageKind: string;
  owner: string;
  eventType: StageEventType;
  occurredAt: string;
  waitingReason?: StageWaitingReason;
  evidence: GatePassEvidence[];
}

export interface StageEventInput extends StageEventKey {
  stageKind: string;
  owner: string;
  eventType: StageEventType;
  occurredAt?: string;
  waitingReason?: StageWaitingReason;
  evidence?: GatePassEvidence[];
}

export interface StageTimingProjection extends StageEventKey {
  stageKind: string;
  owner: string;
  status: 'running' | 'waiting' | 'passed' | 'failed' | 'blocked' | 'skipped' | 'unmeasured';
  valid: boolean;
  enteredAt: string | null;
  firstActionAt: string | null;
  exitedAt: string | null;
  durationMs: number | null;
  activeMs: number | null;
  waitingMs: number | null;
  waitingReason: StageWaitingReason | 'missing_instrumentation' | null;
  waitingByReason: Partial<Record<StageWaitingReason, number>>;
  evidence: GatePassEvidence[];
  errors: string[];
}

export type TimingMeasurementStatus = 'measured' | 'partial' | 'unmeasured' | 'invalid';

export interface TimingDistribution {
  sampleCount: number;
  averageMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface StageTimingMetric extends Omit<StageTimingProjection, 'valid'> {
  kind: 'StageTimingMetric';
  version: 1;
  sourceKey: string;
  measurementStatus: 'measured';
  valid: true;
}

export type TimingMetricWriteStatus = 'written' | 'duplicate' | 'skipped' | 'failed';

export interface TimingMetricWriteResult {
  status: TimingMetricWriteStatus;
  sourceKey?: string;
  reason?: string;
}

export interface TimingStageDefinition {
  id: string;
  kind: string;
  owner: string;
}

export interface RequestTimingStageSummary {
  stageId: string;
  stageKind: string;
  owner: string;
  status: TimingMeasurementStatus;
  attempts: number;
  measuredAttempts: number;
  retryCount: number;
  durationMs: number | null;
  activeMs: number | null;
  waitingMs: number | null;
  waitingByReason: Partial<Record<StageWaitingReason, number>>;
  distribution: TimingDistribution;
  failureReasons: string[];
  errors: string[];
}

export interface RequestTimingSummary {
  kind: 'RequestTimingSummary';
  version: 1;
  loopId: string;
  runId: string | null;
  taskId: string;
  taskState: TaskState | null;
  status: TimingMeasurementStatus;
  enteredAt: string | null;
  firstActionAt: string | null;
  exitedAt: string | null;
  stageCount: number;
  measuredStageCount: number;
  measurementRate: number;
  durationMs: number | null;
  activeMs: number | null;
  waitingMs: number | null;
  waitingByReason: Partial<Record<StageWaitingReason, number>>;
  distribution: TimingDistribution;
  retryCount: number;
  bottleneckStageId: string | null;
  failureReasons: string[];
  errors: string[];
  evidence: string[];
  stages: RequestTimingStageSummary[];
}

export interface TimingAggregationInput {
  loopId: string;
  taskEvents?: TaskEvent[];
  stageEvents: StageEvent[];
  executionEvents?: ExecutionEvent[];
  metrics?: StageTimingMetric[];
  stages?: TimingStageDefinition[];
  sourceErrors?: string[];
}

export type ExecutionEventType =
  | 'gate/decision'
  | 'context/resolved'
  | 'prompt/assembled'
  | 'model/requested'
  | 'model/completed'
  | 'tool/call'
  | 'tool/result'
  | 'executor/completed'
  | 'harness/verdict'
  | 'evaluation/verdict';

export type ExecutionEventActor = 'runtime' | 'executor' | 'harness' | 'evaluator';

export interface ExecutionEventKey {
  projectId: string;
  loopId: string;
  runId: string;
  taskId: string;
  stageId: string;
  attempt: number;
}

export interface ExecutionEvent extends ExecutionEventKey {
  kind: 'ExecutionEvent';
  version: 1;
  id: string;
  seq: number;
  actor: ExecutionEventActor;
  eventType: ExecutionEventType;
  occurredAt: string;
  data: JsonRecord;
  evidence: GatePassEvidence[];
}

export interface ExecutionEventInput extends ExecutionEventKey {
  actor: ExecutionEventActor;
  eventType: ExecutionEventType;
  occurredAt?: string;
  data?: JsonRecord;
  evidence?: GatePassEvidence[];
}

export interface ExecutorReportedEvent {
  eventType:
    | 'prompt/assembled'
    | 'model/requested'
    | 'model/completed'
    | 'tool/call'
    | 'tool/result';
  data: JsonRecord;
  evidence?: GatePassEvidence[];
}

export interface ExecutorEventReporter {
  record(event: ExecutorReportedEvent): Promise<void>;
}

export interface ExecutionTraceProjection {
  loopId: string;
  runId: string;
  valid: boolean;
  reconstructable: boolean;
  modelRequests: number;
  modelCompletions: number;
  toolCalls: number;
  toolResults: number;
  harnessVerdicts: number;
  evaluationVerdicts: number;
  errors: string[];
}

export interface ExecutorAdapterInput {
  loopId: string;
  runId: string;
  taskId: string;
  stage: WorkflowStagePlan;
  attempt: number;
  actions: string[];
  subject: JsonRecord;
  workspaceRoot: string;
  worktreePath?: string;
  backgroundContext?: ResolvedBackgroundContext;
  eventReporter?: ExecutorEventReporter;
}

export interface ExecutorAdapterResult {
  status: 'completed' | 'failed' | 'blocked';
  submission?: unknown;
  evidence: GatePassEvidence[];
  reason?: string;
}

export interface ExecutorAdapter {
  id: string;
  execute(input: ExecutorAdapterInput): Promise<ExecutorAdapterResult>;
}

export interface ExecutionStageInput {
  runId: string;
  taskId: string;
  stageId: string;
  attempt?: number;
  actions?: string[];
  subject: JsonRecord;
  worktreePath?: string;
}

export interface ExecutionAuthority {
  scope: 'local_single_executor';
  executorInstance: string;
}

export interface ExecutionStageResult {
  status: 'passed' | 'failed' | 'blocked';
  adapterId: string;
  authority: ExecutionAuthority;
  reasons: string[];
  gateDecision: GateDecision | null;
  harnessResult: HarnessRunResult | null;
  evaluationVerdict: EvaluationVerdict | null;
  stageEvents: StageEvent[];
  stageTiming: StageTimingProjection | null;
  timingMetric?: TimingMetricWriteResult;
  executionEvents: ExecutionEvent[];
}

export interface ProjectRoutePlan {
  projectContext: ProjectContext;
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

export interface ProjectContext {
  readonly projectId: string;
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly skillPackage: string;
  readonly memoryNamespace: string;
  readonly artifactRoot: string;
  readonly policyDigest: string;
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
  projectContext: ProjectContext;
  projectRoute: ProjectRoutePlan;
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
  backgroundContext?: BackgroundContextPlan;
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

export interface BackgroundContextPlan {
  status: 'planned';
  kind: 'skill-context';
  contractVersion: '1.0.0' | '2.0.0';
  projectId: string;
  backgroundId: string;
  sourceMount: string;
  manifestPath: string;
  contractPath: string;
  executionMode?: string;
  evidenceBundles?: string[];
  validators?: string[];
  maxCharacters: number;
}

export interface SkillContextReference {
  id: string;
  path: string;
  digest: string;
}

export interface SkillContextContract {
  contractVersion: '1.0.0' | '2.0.0';
  skillId: string;
  skillCommit: string;
  entryPath: string;
  entryHash: string;
  manifestPath: string;
  manifestDigest: string;
  executionMode: string;
  ownerAgent: string;
  ownerSkills: string[];
  selectedReferences: SkillContextReference[];
  contextDigest: string;
  contractDigest?: string;
  evidenceBundles?: string[];
  sourceFiles?: SkillContextReference[];
}

export interface BackgroundContextDocument {
  roles: Array<'entry' | 'manifest' | 'owner-agent' | 'owner-skill' | 'reference' | 'evidence'>;
  path: string;
  sourceDigest: string;
  contentDigest: string;
  selection: 'full' | 'relevant-sections' | 'selected-manifest' | 'evidence-bundle';
  content: string;
}

export interface ResolvedBackgroundContext {
  kind: 'skill-context';
  projectId: string;
  backgroundId: string;
  skillContext: SkillContextContract;
  documents: BackgroundContextDocument[];
  characters: number;
}

export interface BackgroundContextLock {
  kind: 'BackgroundContextLock';
  version: 1;
  taskId: string;
  projectId: string;
  backgroundId: string;
  skillCommit: string;
  contextDigest: string;
  selectedEvidenceBundles: string[];
  lockedAt: string;
}

export interface SimulationStage {
  id: string;
  title: string;
  status: 'completed' | 'skipped';
  detail: string;
  outputs: string[];
}

export interface SimulationExecutionStage {
  id: string;
  kind: string;
  owner: string;
  gate: 'automatic' | 'manual';
  harness?: string;
  dependsOn: string[];
  requiredGates: string[];
  actions: string[];
  status: 'not_executed';
  timing: {
    source: 'simulation_only';
    status: 'unmeasured';
    enteredAt: null;
    firstActionAt: null;
    exitedAt: null;
    durationMs: null;
    activeMs: null;
    waitingMs: null;
    waitingReason: 'missing_instrumentation';
  };
}

export interface SimulationExecutionContract {
  authority: 'simulation_only';
  adapterInvoked: false;
  gateChecks: 'not_executed';
  harnessChecks: 'not_executed';
  stageEventsWritten: false;
  workflowStages: SimulationExecutionStage[];
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
  executionContract: SimulationExecutionContract;
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

export type TaskEntryPoint = 'cli' | 'mcp' | 'acp' | 'http';

export type TaskState =
  | 'created'
  | 'prepared'
  | 'leased'
  | 'running'
  | 'submitted'
  | 'verifying'
  | 'ready_to_merge'
  | 'merged'
  | 'blocked'
  | 'failed';

export type ProviderMode = 'managed' | 'client';

export type RepositoryAction =
  | 'read'
  | 'write'
  | 'push'
  | 'pull_request'
  | 'merge'
  | 'protected_branch_update'
  | 'delete_branch'
  | 'delete_worktree'
  | 'destructive_cleanup';

export type TaskEventType =
  | 'task/created'
  | 'task/prepared'
  | 'task/leased'
  | 'task/running'
  | 'task/submitted'
  | 'task/verifying'
  | 'task/ready_to_merge'
  | 'task/merged'
  | 'task/blocked'
  | 'task/failed'
  | 'task/cancelled';

export interface TaskProviderPreference {
  profileId?: string;
  mode?: ProviderMode;
}

export interface TaskRequest {
  entryPoint: TaskEntryPoint;
  projectId: string;
  repositoryId?: string;
  loopId?: string;
  runId?: string;
  title?: string;
  subject: JsonRecord;
  requestedActions: RepositoryAction[];
  provider?: TaskProviderPreference;
  createdBy?: string;
  metadata?: JsonRecord;
}

export interface TaskEvent {
  kind: 'TaskEvent';
  version: 1;
  id: string;
  seq: number;
  taskId: string;
  eventType: TaskEventType;
  occurredAt: string;
  actor: 'runtime' | 'entrypoint' | 'provider' | 'broker' | 'evaluator' | 'human';
  state?: TaskState;
  data: JsonRecord;
  evidence: GatePassEvidence[];
}

export interface TaskEnvelope {
  kind: 'TaskEnvelope';
  version: 1;
  taskId: string;
  state: TaskState;
  entryPoint: TaskEntryPoint;
  projectId: string;
  repositoryId?: string;
  loopId?: string;
  runId?: string;
  projectContext?: ProjectContext;
  projectRoute?: ProjectRoutePlan;
  subject: JsonRecord;
  requestedActions: RepositoryAction[];
  providerMode: ProviderMode;
  providerProfileId?: string;
  workspaceLeaseId?: string;
  gateRequirements: string[];
  promptDigest?: string;
  events: TaskEvent[];
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceLeaseState =
  | 'prepared'
  | 'claimed'
  | 'active'
  | 'stale'
  | 'released'
  | 'failed'
  | 'dirty_retained';

export type WorkspaceLeaseOwnerRole = 'writer' | 'reader';

export interface WorkspaceLeaseOwner {
  id: string;
  role: WorkspaceLeaseOwnerRole;
  providerProfileId?: string;
  claimedAt: string;
}

export interface WorkspaceLeaseHeartbeat {
  intervalMs: number;
  lastSeenAt: string;
  expiresAt: string;
}

export type WorkspaceLeaseDirtyPolicy = 'retain_dirty' | 'delete_when_clean';

export interface WorkspaceLease {
  kind: 'WorkspaceLease';
  version: 1;
  leaseId: string;
  taskId: string;
  projectId: string;
  repositoryId: string;
  repositoryPath: string;
  baseRef: string;
  branch: string;
  path: string;
  state: WorkspaceLeaseState;
  owner?: WorkspaceLeaseOwner;
  heartbeat?: WorkspaceLeaseHeartbeat;
  dirtyPolicy: WorkspaceLeaseDirtyPolicy;
  evidence: GatePassEvidence[];
  createdAt: string;
  updatedAt: string;
}

export type ProviderTransport = 'cli' | 'stdio' | 'mcp' | 'http' | 'client';

export type ProviderSupportLevel = 'supported' | 'experimental' | 'client_only';

export type ProviderSandboxProfile = 'read-only' | 'workspace-write' | 'external' | 'none';

export interface ProviderSandboxSpec {
  profile: ProviderSandboxProfile;
  assumptions: string[];
}

export interface ProviderProfile {
  kind: 'ProviderProfile';
  version: 1;
  id: string;
  displayName: string;
  mode: ProviderMode;
  transport: ProviderTransport;
  supportLevel: ProviderSupportLevel;
  executable?: string;
  args?: string[];
  supportedActions: RepositoryAction[];
  writable: boolean;
  sandbox: ProviderSandboxSpec;
  outputSchema?: JsonRecord;
  timeoutMs: number;
  requiredVerification: string[];
}

export interface ProviderRunRequest {
  taskId: string;
  providerProfileId: string;
  mode: ProviderMode;
  prompt: string;
  promptDigest: string;
  requestedActions: RepositoryAction[];
  cwd?: string;
  workspaceLeaseId?: string;
  metadata?: JsonRecord;
}

export interface ProviderRunResult {
  taskId: string;
  providerProfileId: string;
  status: 'completed' | 'failed' | 'blocked';
  startedAt: string;
  finishedAt: string;
  changedFiles: string[];
  diffSummary?: string;
  verificationCommands: string[];
  output: JsonRecord;
  evidence: GatePassEvidence[];
  reason?: string;
}

export type BrokerDecisionStatus = 'authorized' | 'blocked' | 'completed' | 'failed';

export interface BrokerDecision {
  action: RepositoryAction;
  status: BrokerDecisionStatus;
  reasons: string[];
  evidence: GatePassEvidence[];
  decidedAt: string;
}

export type MergeQueueState = 'queued' | 'checking' | 'blocked' | 'ready' | 'merged' | 'failed';

export interface MergeConflictEvidence {
  file: string;
  reason: string;
  evidence: GatePassEvidence[];
}

export interface PromotionPlan {
  kind: 'PromotionPlan';
  version: 1;
  promotionId: string;
  taskId: string;
  sourceBranch: string;
  targetBranch: string;
  state: MergeQueueState;
  requiredGates: string[];
  brokerDecisions: BrokerDecision[];
  conflicts: MergeConflictEvidence[];
  evidence: GatePassEvidence[];
  createdAt: string;
  updatedAt: string;
}
