import { createHash } from 'node:crypto';
import { HumanGateDefinition, JsonRecord } from '../../shared/src/types';

export const gateCanonicalization = 'jcs-v1' as const;

export interface CanonicalGateSubject {
  canonicalization: typeof gateCanonicalization;
  canonicalJson: string;
  subjectDigest: string;
}

export function createGateSubject(gate: HumanGateDefinition, subject: JsonRecord): CanonicalGateSubject {
  const projected: JsonRecord = {};
  for (const field of gate.subjectFields) {
    if (!Object.prototype.hasOwnProperty.call(subject, field)) {
      throw new Error(`Gate ${gate.id} subject is missing field: ${field}`);
    }
    projected[field] = subject[field];
  }

  const canonicalJson = canonicalizeJson(projected);
  return {
    canonicalization: gateCanonicalization,
    canonicalJson,
    subjectDigest: digestCanonicalJson(canonicalJson)
  };
}

export function createGatePolicyDigest(gate: HumanGateDefinition, reviewers: string[]): string {
  return digestCanonicalJson(canonicalizeJson({
    canonicalization: gateCanonicalization,
    gateId: gate.id,
    requiredBefore: gate.requiredBefore,
    reviewers: [...reviewers].sort(),
    subjectFields: [...gate.subjectFields].sort(),
    requiredEvidenceTypes: [...gate.requiredEvidenceTypes].sort(),
    maxAgeMinutes: gate.maxAgeMinutes
  }));
}

export function canonicalizeJson(value: unknown): string {
  return serializeJson(value, new Set<object>(), '$');
}

function serializeJson(value: unknown, ancestors: Set<object>, path: string): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    assertValidUnicode(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Canonical JSON rejects non-finite number at ${path}`);
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new Error(`Canonical JSON rejects ${typeof value} at ${path}`);
  }
  if (ancestors.has(value)) throw new Error(`Canonical JSON rejects cyclic value at ${path}`);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item, index) => serializeJson(item, ancestors, `${path}[${index}]`)).join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Canonical JSON rejects non-plain object at ${path}`);
    }

    const record = value as JsonRecord;
    const entries = Object.keys(record).sort().map((key) => {
      assertValidUnicode(key, `${path} key`);
      return `${JSON.stringify(key)}:${serializeJson(record[key], ancestors, `${path}.${key}`)}`;
    });
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function digestCanonicalJson(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function assertValidUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`Canonical JSON rejects invalid Unicode at ${path}`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`Canonical JSON rejects invalid Unicode at ${path}`);
    }
  }
}
