import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ValidatorRuntime } from '../packages/validator-runtime/src/validatorRuntime';

async function fixture() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'validator-runtime-'));
  await writeFile(
    path.join(projectRoot, 'page-contract.json'),
    JSON.stringify({
      taskId: 'task-001',
      contextDigest: 'a'.repeat(64)
    }),
    'utf8'
  );
  return projectRoot;
}

test('ValidatorRuntime passes a contract with matching task and context', async () => {
  const projectRoot = await fixture();
  const result = await new ValidatorRuntime().run({
    projectRoot,
    taskId: 'task-001',
    phase: 'page-contract-preflight',
    contractPath: 'page-contract.json',
    contextDigest: 'a'.repeat(64)
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.kind, 'ValidatorRuntimeResult');
  assert.equal(result.evidence.some((item) => item.value.startsWith('contract-read:')), true);
});

test('ValidatorRuntime fails a contract with mismatched context', async () => {
  const projectRoot = await fixture();
  const result = await new ValidatorRuntime().run({
    projectRoot,
    taskId: 'task-001',
    phase: 'page-contract-preflight',
    contractPath: 'page-contract.json',
    contextDigest: 'b'.repeat(64)
  });

  assert.equal(result.status, 'failed');
  assert.match(result.reasons.join('\n'), /contextDigest mismatch/);
});

test('ValidatorRuntime fails with explicit evidence when the contract is missing', async () => {
  const projectRoot = await fixture();
  const result = await new ValidatorRuntime().run({
    projectRoot,
    taskId: 'task-001',
    phase: 'page-contract-preflight',
    contractPath: 'missing.json',
    contextDigest: 'a'.repeat(64)
  });

  assert.equal(result.status, 'failed');
  assert.match(result.reasons.join('\n'), /Contract unavailable/);
  assert.equal(result.evidence.some((item) => item.value === 'contract-missing:missing.json'), true);
});

test('ValidatorRuntime records a skipped decision when its feature flag is disabled', async () => {
  const projectRoot = await fixture();
  const result = await new ValidatorRuntime({
    featureFlags: { 'validator:page-contract': false }
  }).run({
    projectRoot,
    taskId: 'task-001',
    phase: 'page-contract-preflight',
    contractPath: 'page-contract.json',
    contextDigest: 'a'.repeat(64),
    validatorId: 'page-contract'
  });

  assert.equal(result.status, 'skipped');
  assert.match(result.reasons.join('\n'), /feature flag/);
  assert.equal(result.evidence.some((item) => item.value === 'validator-skipped:validator:page-contract'), true);
});

const LEGACY_SNAPSHOT_DIR = path.resolve('loop-engineering/tests/fixtures/legacy-page-contract');
const XIAONENG_MOUNT_DIR = path.resolve('workspace/.local/t-max/mounts/background/xiaoneng');

interface LegacySnapshotEntry {
  source: string;
  mode: 'verbatim' | 'adapted';
  sha256?: string;
  sourceSha256?: string;
  vendoredSha256?: string;
}

interface LegacySnapshot {
  source: { commit: string };
  files: Record<string, LegacySnapshotEntry>;
}

interface LegacyCore {
  buildPageContract(input: Record<string, unknown>): Record<string, unknown>;
}

interface LegacyValidator {
  validatePageContractFile(filePath: string): { ok: boolean; errors: string[] };
  validatePageContractValue(contract: unknown): { ok: boolean; errors: string[] };
}

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<unknown>;

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

async function loadLegacySnapshot(): Promise<{
  snapshot: LegacySnapshot;
  core: LegacyCore;
  legacy: LegacyValidator;
}> {
  const snapshot = JSON.parse(
    readFileSync(path.join(LEGACY_SNAPSHOT_DIR, 'snapshot.json'), 'utf8')
  ) as LegacySnapshot;
  const core = (await dynamicImport(
    pathToFileURL(path.join(LEGACY_SNAPSHOT_DIR, 'page-contract-core.mjs')).href
  )) as LegacyCore;
  const legacy = (await dynamicImport(
    pathToFileURL(path.join(LEGACY_SNAPSHOT_DIR, 'legacy-page-contract.mjs')).href
  )) as LegacyValidator;
  return { snapshot, core, legacy };
}

function legacyExecutor(legacy: LegacyValidator) {
  return async ({ contract }: { contract: Record<string, unknown> }) => {
    const verdict = legacy.validatePageContractValue(contract);
    return { status: verdict.ok ? ('passed' as const) : ('failed' as const), reasons: [...verdict.errors] };
  };
}

function parityRuntimeInput(projectRoot: string) {
  return {
    projectRoot,
    taskId: 'task-parity',
    phase: 'page-contract-preflight',
    contractPath: 'page-contract.json',
    contextDigest: 'c'.repeat(64),
    validatorId: 'page-contract'
  };
}

test('ValidatorRuntime parity fixture preserves the legacy page-contract decision (CI-safe snapshot)', async () => {
  const { core, legacy } = await loadLegacySnapshot();
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'validator-parity-'));
  const contractPath = path.join(projectRoot, 'page-contract.json');
  await writeFile(
    contractPath,
    `${JSON.stringify(
      core.buildPageContract({
        taskId: 'task-parity',
        projectId: 't-max',
        repositoryId: 'operateBusiness',
        contextDigest: 'c'.repeat(64)
      })
    )}\n`,
    'utf8'
  );

  const legacyVerdict = legacy.validatePageContractFile(contractPath);
  const modern = await new ValidatorRuntime({
    executors: { 'page-contract': legacyExecutor(legacy) }
  }).run(parityRuntimeInput(projectRoot));

  assert.equal(legacyVerdict.ok, true);
  assert.equal(modern.status, 'passed');
  assert.deepEqual(modern.reasons, legacyVerdict.errors);
});

test('ValidatorRuntime parity fixture agrees with the legacy decision on a tampered contractDigest', async () => {
  const { core, legacy } = await loadLegacySnapshot();
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'validator-parity-'));
  const contractPath = path.join(projectRoot, 'page-contract.json');
  const contract = core.buildPageContract({
    taskId: 'task-parity',
    projectId: 't-max',
    repositoryId: 'operateBusiness',
    contextDigest: 'c'.repeat(64)
  });
  contract.taskId = 'task-tampered';
  await writeFile(contractPath, `${JSON.stringify(contract)}\n`, 'utf8');

  const legacyVerdict = legacy.validatePageContractFile(contractPath);
  const modern = await new ValidatorRuntime({
    executors: { 'page-contract': legacyExecutor(legacy) }
  }).run(parityRuntimeInput(projectRoot));

  assert.equal(legacyVerdict.ok, false);
  assert.equal(modern.status, 'failed');
  assert.deepEqual(modern.reasons, legacyVerdict.errors);
  assert.equal(legacyVerdict.errors.includes('contractDigest does not match contract content'), true);
});

test('ValidatorRuntime parity fixture agrees with the legacy decision on a forbidden page source', async () => {
  const { core, legacy } = await loadLegacySnapshot();
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'validator-parity-'));
  const contractPath = path.join(projectRoot, 'page-contract.json');
  await writeFile(
    contractPath,
    `${JSON.stringify(
      core.buildPageContract({
        taskId: 'task-parity',
        projectId: 't-max',
        repositoryId: 'operateBusiness',
        contextDigest: 'c'.repeat(64),
        sourceEvidence: [{ note: 'copied from mock/User/auth.json' }]
      })
    )}\n`,
    'utf8'
  );

  const legacyVerdict = legacy.validatePageContractFile(contractPath);
  const modern = await new ValidatorRuntime({
    executors: { 'page-contract': legacyExecutor(legacy) }
  }).run(parityRuntimeInput(projectRoot));

  assert.equal(legacyVerdict.ok, false);
  assert.equal(modern.status, 'failed');
  assert.deepEqual(modern.reasons, legacyVerdict.errors);
  assert.equal(
    legacyVerdict.errors.includes('forbidden source: mock/User/auth.json'),
    true
  );
});

test('legacy page-contract snapshot files stay pinned to the recorded digests', async () => {
  const { snapshot } = await loadLegacySnapshot();
  for (const [file, entry] of Object.entries(snapshot.files)) {
    const expected = entry.mode === 'verbatim' ? entry.sha256 : entry.vendoredSha256;
    assert.ok(expected, `snapshot.json must record a pinned digest for ${file}`);
    assert.equal(
      sha256File(path.join(LEGACY_SNAPSHOT_DIR, file)),
      expected,
      `vendored snapshot file ${file} drifted from its pinned digest; re-pin from the xiaoneng source`
    );
  }
});

test(
  'legacy page-contract snapshot stays in sync with the mounted xiaoneng source',
  { skip: !existsSync(XIAONENG_MOUNT_DIR) },
  async () => {
    const { snapshot } = await loadLegacySnapshot();
    for (const [file, entry] of Object.entries(snapshot.files)) {
      const expected = entry.mode === 'verbatim' ? entry.sha256 : entry.sourceSha256;
      assert.ok(expected, `snapshot.json must record a pinned digest for ${file}`);
      assert.equal(
        sha256File(path.join(XIAONENG_MOUNT_DIR, entry.source)),
        expected,
        `xiaoneng source ${entry.source} changed since the snapshot was pinned; re-pin snapshot.json and the vendored files`
      );
    }
  }
);
