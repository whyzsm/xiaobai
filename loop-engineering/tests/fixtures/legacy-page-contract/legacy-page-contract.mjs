// 快照适配器 / Snapshot adapter.
//
// 镜像小能仓 harness/runtime/page-contract-validator.mjs（digest 见 snapshot.json，mode: adapted）。
// 当前源文件的两个外部依赖改为本目录 vendored 文件；额外保留 value 入口供 parity fixture 调用。
// 裁决语义必须与小能源文件一致；改动前先跑 tests/validator-runtime.test.ts 的 parity 用例。
//
// Mirrors xiaoneng harness/runtime/page-contract-validator.mjs (see snapshot.json, mode: adapted).
// External imports resolve to vendored files, and validatePageContractValue is retained as a
// fixture-only value adapter. Decision semantics must stay identical to the xiaoneng source;
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

export function validatePageContractFile(filePath) {
  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { ok: false, errors: [`contract read failed: ${error.message}`] };
  }
  return validatePageContractValue(contract);
}

export function validatePageContractValue(contract) {
  const semantic = validatePageContract(contract);
  const schemaErrors = validateSchema(contract, contractSchema).map(
    (error) => `${error.path} ${error.message}`
  );
  const errors = [...semantic.errors, ...schemaErrors];
  return {
    ok: errors.length === 0,
    errors,
    contractDigest: contract.contractDigest,
    schema: contractSchema.$id,
  };
}
