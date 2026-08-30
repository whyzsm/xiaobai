import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { evaluateConfigConsole } from '../lib/config-evaluator.js'

test('independent configuration evaluator passes the implementation evidence checks', () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const result = evaluateConfigConsole(root)
  assert.equal(result.evaluatorId, 'agent_xiaobai_config_eval')
  assert.equal(result.status, 'passed', JSON.stringify(result.findings))
  assert.equal(result.findings.length, 10)
})
