import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const EVALUATOR_ID = 'agent_xiaobai_config_eval'

function read(root, file) {
  const path = join(root, file)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function evidence(root, files) {
  return files.map((file) => relative(root, join(root, file)).split('\\').join('/'))
}

function finding(root, id, condition, message, files) {
  return { id, status: condition ? 'passed' : 'failed', message, evidence: evidence(root, files) }
}

export function evaluateConfigConsole(root = process.cwd()) {
  const service = read(root, 'loop-engineering/packages/xiaobai-dsh-plugin/lib/config-console.js')
  const storage = read(root, 'loop-engineering/packages/xiaobai-dsh-plugin/lib/storage.js')
  const typed = read(root, 'loop-engineering/packages/xiaobai-dsh-plugin/lib/typed.js')
  const commands = read(root, 'loop-engineering/packages/xiaobai-dsh-plugin/lib/commands.js')
  const client = read(root, 'client/plugin-client.js')
  const manifest = read(root, 'loop-engineering/packages/xiaobai-dsh-plugin/dsh.plugin.json')
  const dashboard = read(root, 'workspace/monitoring/dashboard.html')
  const findings = [
    finding(root, 'AC-01', /class WorkspaceConfigService/.test(service) && /ProjectConfigDraft/.test(typed) && /ResponseEnvelope/.test(typed), 'Workspace configuration contracts and Host service are present.', ['loop-engineering/packages/xiaobai-dsh-plugin/lib/config-console.js', 'loop-engineering/packages/xiaobai-dsh-plugin/lib/typed.js']),
    finding(root, 'AC-02', /workspaceFor/.test(service) && /workspaceId/.test(service) && /projectId/.test(service), 'Workspace and Project identifiers are carried through the service boundary.', ['loop-engineering/packages/xiaobai-dsh-plugin/lib/config-console.js']),
    finding(root, 'AC-03', /config_drafts/.test(storage) && /config_revisions/.test(storage) && /config_audit/.test(storage), 'Draft, revision, approval, and audit storage tables are declared.', ['loop-engineering/packages/xiaobai-dsh-plugin/lib/storage.js']),
    finding(root, 'AC-04', /workspace-config-list/.test(commands) && /workspace-config-preview/.test(commands) && /workspace-config-rollback/.test(commands), 'CLI commands expose the configuration lifecycle.', ['loop-engineering/packages/xiaobai-dsh-plugin/lib/commands.js']),
    finding(root, 'AC-05', /atomicWriteSet/.test(service) && /approval\.request/.test(service) && /workspace\.config\.changed/.test(service), 'Apply is gated by Host approval, atomic file writes, and a change event.', ['loop-engineering/packages/xiaobai-dsh-plugin/lib/config-console.js']),
    finding(root, 'AC-06', /loading/.test(client) && /conflict/.test(client) && /rollback/.test(client) && /settings\.section/.test(client), 'Client state and recovery views are represented inside the Settings contribution.', ['client/plugin-client.js']),
    finding(root, 'AC-07', /realpath/.test(service) && /PATH_ESCAPE/.test(service) && /replaceAll/.test(service), 'Host path checks and redaction are present at the write boundary.', ['loop-engineering/packages/xiaobai-dsh-plugin/lib/config-console.js']),
    finding(root, 'AC-08', /settings\.section/.test(client) && !/sidebar\.footer\.action/.test(client) && !/shell\.overlay/.test(client) && !/slots\.register\(\{ name: "root"/.test(client) && !/slots\.register\(\{ name: "conversation"/.test(client), 'Client exposes Xiaobai only through the approved Settings contribution and leaves root/conversation untouched.', ['client/plugin-client.js']),
    finding(root, 'AC-09', /workspace-config-console/.test(manifest) && /ProjectConfigPreview/.test(manifest), 'Plugin manifest declares the configuration capability and public contracts.', ['loop-engineering/packages/xiaobai-dsh-plugin/dsh.plugin.json']),
    finding(root, 'AC-10', !/workspace-config-(?:apply|rollback)/.test(dashboard), 'Dashboard does not expose configuration write or rollback commands.', ['workspace/monitoring/dashboard.html']),
  ]
  return {
    evaluatorId: EVALUATOR_ID,
    status: findings.every((item) => item.status === 'passed') ? 'passed' : 'failed',
    contractVersion: 'xiaobai.config/v1',
    findings,
    evidence: evidence(root, ['loop-engineering/packages/xiaobai-dsh-plugin/lib/config-evaluator.js', 'loop-engineering/packages/xiaobai-dsh-plugin/test/config-console.test.mjs', 'loop-engineering/packages/xiaobai-dsh-plugin/test/client-contract.test.mjs']),
  }
}
