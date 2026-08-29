import { ERROR_CODES } from './constants.js'
import { sha256Digest } from './canonical.js'
import { validateContract } from './contracts.js'
import { XiaobaiError } from './errors.js'

export function evaluateStage({ evaluatorId, stageId, output, outputContract, evidence = [], independent = true }) {
  if (!independent) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, 'Evaluator must be independent from the generator', { resourceId: evaluatorId, phase: 'evaluation' })
  const findings = []
  if (!output || typeof output !== 'object') findings.push({ code: 'OUTPUT_NOT_OBJECT', message: 'Stage output must be an object' })
  if (typeof outputContract !== 'string' || outputContract.length === 0) findings.push({ code: 'OUTPUT_CONTRACT_MISSING', message: 'Stage output contract is missing' })
  if (!Array.isArray(evidence) || evidence.length === 0) findings.push({ code: 'EVIDENCE_MISSING', message: 'Stage output has no evidence' })
  const result = { evaluatorId, status: findings.length === 0 ? 'passed' : 'failed', contractVersion: outputContract ?? 'unknown', findings, evidence: [...evidence, `output:${sha256Digest(output)}`] }
  return { ...result, valid: findings.length === 0, stageId }
}

export function requireEvaluationPass(result) {
  if (!result?.valid || result.status !== 'passed') throw new XiaobaiError(ERROR_CODES.GATE_EVIDENCE_MISSING, 'Stage cannot proceed without an independent evaluator pass', { resourceId: result?.stageId, phase: 'evaluation-gate', expected: 'passed', actual: result?.status, evidenceRef: result?.evidence?.[0], remediation: 'Fix evaluator findings and rerun the stage.' })
  const { valid: _valid, stageId: _stageId, ...contract } = result
  return validateContract('evaluatorResult', contract)
}
