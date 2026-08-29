import crypto from 'node:crypto';

export const FORBIDDEN_PAGE_SOURCES = [
  'mock/User/auth.json',
  'local mock data',
  'hardcoded upload result',
];

export function buildPageContract(input) {
  const contract = {
    contractVersion: '2.0.0',
    taskId: input.taskId,
    projectId: input.projectId,
    repositoryId: input.repositoryId,
    pageType: 'StandardPage',
    standardPageProfile: input.standardPageProfile || 'standard-list',
    routes: input.routes || [],
    menus: input.menus || [],
    fields: input.fields || [],
    apis: input.apis || [],
    import: input.import || {
      enabled: false,
      ruleRef: 'none',
      templateRef: 'none',
      adapterRef: 'none',
    },
    references: input.references || [],
    rules: input.rules || [],
    sourceEvidence: input.sourceEvidence || [],
    contextDigest: input.contextDigest,
  };
  return {
    ...contract,
    contractDigest: digest(contract),
  };
}

export function validatePageContract(contract) {
  const errors = [];
  if (!isRecord(contract)) return { ok: false, errors: ['contract must be an object'] };
  for (const field of [
    'contractVersion',
    'taskId',
    'projectId',
    'repositoryId',
    'standardPageProfile',
    'contextDigest',
    'contractDigest',
  ]) {
    if (!nonEmpty(contract[field])) errors.push(`missing ${field}`);
  }
  if (contract.contractVersion !== '2.0.0') errors.push('contractVersion must be 2.0.0');
  if (contract.pageType !== 'StandardPage') errors.push('pageType must be StandardPage');
  for (const field of ['routes', 'menus', 'fields', 'apis', 'references', 'rules', 'sourceEvidence']) {
    if (!Array.isArray(contract[field])) errors.push(`${field} must be an array`);
  }
  if (!isSha256(contract.contextDigest)) errors.push('contextDigest must be a sha256 digest');
  if (!isSha256(contract.contractDigest)) errors.push('contractDigest must be a sha256 digest');
  if (isRecord(contract.import)) {
    for (const field of ['enabled', 'ruleRef', 'templateRef', 'adapterRef']) {
      if (contract.import[field] === undefined) errors.push(`import.${field} is required`);
    }
    if (contract.import.enabled && contract.import.ruleRef !== 'tmax-standard-import') {
      errors.push('enabled import must use tmax-standard-import');
    }
    if (contract.import.enabled) {
      for (const field of ['ruleVersion', 'ruleSource', 'ruleDigest', 'sourceCommit', 'sourceDigest', 'sourcePath']) {
        if (!nonEmpty(contract.import[field])) errors.push(`import.${field} is required`);
      }
      if (contract.import.ruleDigest && !isSha256(contract.import.ruleDigest)) {
        errors.push('import.ruleDigest must be a sha256 digest');
      }
      if (contract.import.sourceDigest && !isSha256(contract.import.sourceDigest)) {
        errors.push('import.sourceDigest must be a sha256 digest');
      }
    }
  } else {
    errors.push('import must be an object');
  }
  // The contract records forbidden sources as policy. Only inspect implementation-facing evidence.
  const forbiddenText = JSON.stringify({
    routes: contract.routes,
    menus: contract.menus,
    fields: contract.fields,
    apis: contract.apis,
    references: contract.references,
    rules: contract.rules,
    sourceEvidence: contract.sourceEvidence,
  });
  for (const source of FORBIDDEN_PAGE_SOURCES) {
    if (forbiddenText.includes(source)) errors.push(`forbidden source: ${source}`);
  }
  if (errors.length === 0) {
    const { contractDigest, ...contractWithoutDigest } = contract;
    const expected = digest(contractWithoutDigest);
    if (expected !== contract.contractDigest) errors.push('contractDigest does not match contract content');
  }
  return { ok: errors.length === 0, errors, contractDigest: contract.contractDigest };
}

export function digest(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
