import { evaluateConfigConsole } from '../loop-engineering/packages/xiaobai-dsh-plugin/lib/config-evaluator.js'

const result = evaluateConfigConsole(new URL('..', import.meta.url).pathname.replace(/\/$/, ''))
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (result.status !== 'passed') process.exitCode = 1
