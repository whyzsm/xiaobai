// 快照适配器 / Snapshot adapter.
//
// 镜像小能仓 harness/runtime/page-contract-validator.mjs（digest 见 snapshot.json，mode: adapted），
// 仅改两处：validateSchema 改从本目录 vendored 的 schema-validation.mjs 导入；
// loadJson 内联（原从 ../scripts/validate-control-plane.mjs 导入）；schema 路径改为本目录。
// 裁决语义必须与小能源文件逐字一致；改动前先跑 tests/validator-runtime.test.ts 的 parity 用例。
//
// Mirrors xiaoneng harness/runtime/page-contract-validator.mjs (see snapshot.json, mode: adapted).
// Only two changes: validateSchema is imported from the vendored ./schema-validation.mjs;
// loadJson is inlined (originally imported from ../scripts/validate-control-plane.mjs); the schema
// path resolves locally. Decision semantics must stay verbatim-identical to the xiaoneng source;
// run the parity tests in tests/validator-runtime.test.ts before changing this file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSchema } from './schema-validation.mjs';
import { validatePageContract } from './page-contract-core.mjs';

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const contractSchema = JSON.parse(
  fs.readFileSync(path.join(runtimeDir, 'standard-page-contract.schema.json'), 'utf8')
);

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function validatePageContractFile(filePath) {
  try {
    return validatePageContractValue(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (error) {
    return { ok: false, errors: [`contract read failed: ${error.message}`] };
  }
}

export function validatePageContractValue(contract) {
  if (contract === null || typeof contract !== 'object' || Array.isArray(contract)) {
    return { ok: false, errors: ['contract must be an object'] };
  }
  const semantic = validatePageContract(contract);
  const schemaErrors = validateSchema(contract, contractSchema).map(
    (error) => `${error.path} ${error.message}`,
  );
  const errors = [...semantic.errors, ...schemaErrors];
  return {
    ok: errors.length === 0,
    errors,
    contractDigest: contract.contractDigest,
    schema: contractSchema.$id,
  };
}
