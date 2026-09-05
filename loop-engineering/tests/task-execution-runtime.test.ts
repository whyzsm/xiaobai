import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import {
  RequirementIntakeInput,
  RuntimePlan,
  XiaonengRequirementPolicy
} from '../packages/shared/src/types';
import { buildRequirementArtifact } from '../packages/task-execution-runtime/src/taskExecutionRuntime';
import { TaskExecutionRuntime } from '../packages/task-execution-runtime/src/taskExecutionRuntime';

const policy: XiaonengRequirementPolicy = {
  kind: 'TmaxRequirementPolicy',
  version: '1.0.0',
  appliesTo: 't-max',
  sourceBinding: {
    requirePageRoute: true,
    requireSourceUri: true,
    requireRequestedVersion: true,
    requireExactSectionHeading: true,
    requireContentHash: true
  },
  backendContract: {
    frontendOnlyWithoutBackend: {
      allowNewRequest: false,
      allowResponseFieldGuessing: false
    }
  },
  precision: {
    requireSeparatedLayersWhenSpecified: true,
    requiredLayers: ['display', 'input', 'import']
  },
  referenceSelection: {
    canonicalTemplateSource: 'xiaoneng',
    targetProjectRole: 'project_facts_only'
  }
};

const plan = {
  xiaoneng: {
    skillContext: {
      contractVersion: '1.0.0',
      skillId: 'xiaoneng-agent',
      skillCommit: 'a'.repeat(40),
      entryPath: 'xiaoneng-agent/SKILL.md',
      entryHash: 'b'.repeat(64),
      manifestPath: 'harness/runtime/manifest.yaml',
      manifestDigest: 'c'.repeat(64),
      executionMode: 'PageImplementation',
      ownerAgent: 'watermelon-frontend-agent',
      ownerSkills: ['fe-page-workflow'],
      selectedReferences: [],
      contextDigest: 'd'.repeat(64)
    },
    sourceConsumption: {
      sourceRoot: '/xiaoneng',
      manifestPath: 'harness/runtime/manifest.yaml',
      entryPath: 'xiaoneng-agent/SKILL.md',
      files: [],
      consumedBy: 'xiaoneng-agent',
      consumedAt: '2026-09-05T00:00:00.000Z'
    },
    taskContextLock: {
      taskId: 'CPYYZ-7387',
      projectId: 't-max',
      projectKind: 'ProjectGroup',
      projectScopeRepositories: ['operateSupport'],
      targetRepository: 'operateSupport',
      targetMount: '/target/operateSupport',
      backgroundMount: '/xiaoneng',
      authorizedActions: ['implement'],
      branch: 'CPYYZ-7387',
      head: 'e'.repeat(40),
      gitAvailable: true,
      worktreeStatus: [],
      lockedAt: '2026-09-05T00:00:00.000Z'
    }
  }
} as unknown as RuntimePlan;

function intake(overrides: Partial<RequirementIntakeInput> = {}): RequirementIntakeInput {
  return {
    scope: 'frontend_only',
    backendContract: {
      status: 'not_provided',
      allowNewRequest: false,
      allowResponseFieldGuessing: false
    },
    targetPageRoutes: ['operatesupport/personnelProduction/staffEfficiencyParamConfig'],
    requirementSources: [
      {
        pageRoute: 'operatesupport/personnelProduction/staffEfficiencyParamConfig',
        sourceUri: 'https://example.yuque.com/doc',
        requestedVersion: 'V1.01',
        extractedSection: { heading: 'V1.01', content: 'Display values with one decimal place.' },
        visualEvidenceStatus: 'not_required'
      }
    ],
    requirements: [{ id: 'REQ-1', text: 'Display normalized personnel efficiency data.', acceptanceIds: ['ACC-1'] }],
    acceptanceCriteria: [{ id: 'ACC-1', text: 'The requested page displays the confirmed value.' }],
    openQuestions: [],
    precision: {
      display: 'fixed_1_decimal',
      input: 'max_2_decimals',
      import: 'max_2_decimals'
    },
    ...overrides
  };
}

function build(input: RequirementIntakeInput) {
  return buildRequirementArtifact({
    plan,
    taskId: 'CPYYZ-7387',
    input,
    policy,
    policyPath: 'harness/contracts/runtime/tmax-requirement-policy.json',
    policyDigest: 'f'.repeat(64)
  });
}

test('requirement artifact binds the requested source version and preserves separate decimal layers', () => {
  const artifact = build(intake());

  assert.equal(artifact.status, 'go');
  assert.equal(artifact.requirementSources[0]?.requestedVersion, 'V1.01');
  assert.equal(artifact.requirementSources[0]?.sectionHeading, 'V1.01');
  assert.match(artifact.requirementSources[0]?.contentHash ?? '', /^[0-9a-f]{64}$/);
  assert.deepEqual(artifact.precision, {
    display: 'fixed_1_decimal',
    input: 'max_2_decimals',
    import: 'max_2_decimals'
  });
  assert.match(artifact.contentDigest, /^[0-9a-f]{64}$/);
});

test('requirement artifact fails closed for mismatched versions, missing acceptance links, and absent visual evidence', () => {
  const artifact = build(intake({
    requirementSources: [{
      ...intake().requirementSources[0]!,
      extractedSection: { heading: 'V1.1', content: 'Wrong version.' },
      visualEvidenceStatus: 'required_missing'
    }],
    requirements: [{ id: 'REQ-1', text: 'A requirement', acceptanceIds: ['ACC-404'] }]
  }));

  assert.equal(artifact.status, 'blocked');
  assert.deepEqual(artifact.blockingReasons, [
    'REQUIREMENT_ACCEPTANCE_LINK_MISSING:REQ-1',
    'REQUIREMENT_VERSION_HEADING_MISMATCH:operatesupport/personnelProduction/staffEfficiencyParamConfig',
    'REQUIREMENT_VISUAL_EVIDENCE_MISSING:operatesupport/personnelProduction/staffEfficiencyParamConfig'
  ]);
});

test('frontend-only work without a backend contract forbids new requests and response-field guessing', () => {
  const artifact = build(intake({
    backendContract: {
      status: 'not_provided',
      allowNewRequest: true,
      allowResponseFieldGuessing: true
    },
    precision: { display: 'fixed_1_decimal', input: 'max_2_decimals', import: '' }
  }));

  assert.equal(artifact.status, 'blocked');
  assert.deepEqual(artifact.blockingReasons, [
    'BACKEND_CONTRACT_NEW_REQUEST_FORBIDDEN',
    'BACKEND_CONTRACT_RESPONSE_FIELD_GUESSING_FORBIDDEN',
    'REQUIREMENT_PRECISION_LAYER_MISSING'
  ]);
});

test('requirement artifact blocks a target page without a versioned source binding', () => {
  const artifact = build(intake({
    targetPageRoutes: [
      'operatesupport/personnelProduction/staffEfficiencyParamConfig',
      'operatesupport/personnelProduction/personnelDemandAnalysis'
    ]
  }));

  assert.equal(artifact.status, 'blocked');
  assert.deepEqual(artifact.blockingReasons, [
    'REQUIREMENT_TARGET_PAGE_SOURCE_MISSING:operatesupport/personnelProduction/personnelDemandAnalysis'
  ]);
});

test('T-MAX intake loads the mounted Xiaoneng policy and waits for an external adapter before any write', async () => {
  const runtime = new TaskExecutionRuntime();
  const result = await runtime.execute({
    workspaceRoot: path.join(process.cwd(), 'workspace'),
    loopPath: path.join(process.cwd(), 'workspace', 'loops', 'frontend-delivery.loop.yaml'),
    targetRepository: 'operateSupport',
    taskId: 'task-intake-control-plane',
    requirement: intake(),
    now: new Date('2026-09-05T00:00:00.000Z')
  });

  assert.equal(result.status, 'ready_for_adapter');
  assert.equal(result.artifactDirectory, undefined);
  assert.equal(result.requirementArtifact.status, 'go');
  assert.equal(result.requirementArtifact.policy.path, 'harness/contracts/runtime/tmax-requirement-policy.json');
  assert.equal(result.stageEvents[2]?.stageId, 'external-dispatch');
  assert.equal(result.stageEvents[2]?.status, 'waiting');
  assert.equal(result.stageEvents[2]?.waitingReason, 'EXTERNAL_EXECUTION_ADAPTER_REQUIRED');
});
