import { HumanGateDefinition, JsonRecord } from '../../shared/src/types';
import {
  canonicalizationVersion,
  canonicalizeJson,
  digestCanonicalJson
} from '../../shared/src/canonicalDigest';

export { canonicalizeJson, digestCanonicalJson } from '../../shared/src/canonicalDigest';

export const gateCanonicalization = canonicalizationVersion;

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
