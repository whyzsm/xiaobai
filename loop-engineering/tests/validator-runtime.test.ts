import assert from 'node:assert/strict';
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

test('ValidatorRuntime parity fixture preserves the legacy page-contract decision', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'validator-parity-'));
  const legacyCorePath = path.resolve(
    'workspace/.local/t-max/mounts/background/xiaoneng/harness/runtime/page-contract-core.mjs'
  );
  const legacyValidatorPath = path.resolve(
    'workspace/.local/t-max/mounts/background/xiaoneng/harness/runtime/page-contract-validator.mjs'
  );
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<unknown>;
  const legacyCore = await dynamicImport(pathToFileURL(legacyCorePath).href) as {
    buildPageContract(input: Record<string, unknown>): Record<string, unknown>;
  };
  const legacyValidator = await dynamicImport(pathToFileURL(legacyValidatorPath).href) as {
    validatePageContractFile(filePath: string): { ok: boolean; errors: string[] };
  };
  const contract = legacyCore.buildPageContract({
    taskId: 'task-parity',
    projectId: 't-max',
    repositoryId: 'operateBusiness',
    contextDigest: 'c'.repeat(64)
  });
  const contractPath = path.join(projectRoot, 'page-contract.json');
  await writeFile(contractPath, `${JSON.stringify(contract)}\n`, 'utf8');

  const legacy = legacyValidator.validatePageContractFile(contractPath);
  const modern = await new ValidatorRuntime({
    executors: {
      'page-contract': async ({ contract: loadedContract }) => ({
        status: legacy.ok ? 'passed' : 'failed',
        reasons: [...legacy.errors],
        evidence: [{ type: 'other', value: `legacy-page-contract:${Object.keys(loadedContract).length}` }]
      })
    }
  }).run({
    projectRoot,
    taskId: 'task-parity',
    phase: 'page-contract-preflight',
    contractPath: 'page-contract.json',
    contextDigest: 'c'.repeat(64),
    validatorId: 'page-contract'
  });

  assert.equal(legacy.ok, true);
  assert.equal(modern.status, legacy.ok ? 'passed' : 'failed');
  assert.deepEqual(modern.reasons, legacy.errors);
  assert.equal(modern.evidence.some((item) => item.value.startsWith('legacy-page-contract:')), true);
});
