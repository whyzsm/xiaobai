import { CONTRACT_VERSION, ERROR_CODES } from './constants.js'

export class XiaobaiError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined)
    this.name = 'XiaobaiError'
    this.code = code
    this.contractVersion = details.contractVersion ?? CONTRACT_VERSION
    this.resourceId = details.resourceId
    this.phase = details.phase
    this.expected = details.expected
    this.actual = details.actual
    this.remediation = details.remediation
    this.evidenceRef = details.evidenceRef
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      contractVersion: this.contractVersion,
      ...(this.resourceId ? { resourceId: this.resourceId } : {}),
      ...(this.phase ? { phase: this.phase } : {}),
      ...(this.expected !== undefined ? { expected: this.expected } : {}),
      ...(this.actual !== undefined ? { actual: this.actual } : {}),
      ...(this.remediation ? { remediation: this.remediation } : {}),
      ...(this.evidenceRef ? { evidenceRef: this.evidenceRef } : {}),
    }
  }
}

export function unsupportedHost(key, method, actual) {
  return new XiaobaiError(
    ERROR_CODES.HOST_UNSUPPORTED,
    `Required dsh capability '${key}.${method}' is unavailable`,
    {
      phase: 'host-capability-probe',
      expected: `${key}.${method}`,
      actual: actual ?? 'unavailable',
      remediation: 'Mount the supported dsh profile/bundle and rerun the capability probe.',
    },
  )
}

export function contractError(message, details = {}) {
  return new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, message, details)
}

export function scopeRequired(resourceId, phase = 'scope-resolution') {
  return new XiaobaiError(ERROR_CODES.SCOPE_REQUIRED, 'A project scope is required for this operation', {
    resourceId,
    phase,
    remediation: 'Resolve the Project through ProjectRegistry and pass its scoped context.',
  })
}

export function memoryConflict(resourceId, expected, actual) {
  return new XiaobaiError(ERROR_CODES.MEMORY_CONFLICT, 'A Memory record key already contains a different durable value', {
    resourceId,
    phase: 'memory-conflict',
    expected,
    actual,
    remediation: 'Use a new record id or resolve the recorded conflict before retrying.',
  })
}
