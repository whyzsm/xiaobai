export const PACKAGE_NAME = '@xiaobai/dsh-plugin'
export const CONTRACT_VERSION = 'xiaobai.contracts/v1'
export const CONFIG_CONTRACT_VERSION = 'xiaobai.config/v1'
export const PLUGIN_VERSION = '0.1.0'

export const HOST_SUPPORT = Object.freeze({
  dsh: '0.1.0-rc.6',
  cordis: '4.0.1',
  seams: Object.freeze({
    scope: '0.1.0-rc.6',
    storageDomain: '0.1.0-rc.6',
    skill: '0.1.0-rc.6',
    workflow: '0.1.0-rc.6',
    approval: '0.1.0-rc.6',
    invariants: '0.1.0-rc.6',
    typert: '0.1.0-rc.6',
    workspace: '0.1.0-rc.6',
  }),
  runtimes: Object.freeze({
    agent: '0.1.0-rc.6',
    agentLoop: '0.1.0-rc.6',
    headless: '0.1.0-rc.6',
  }),
})

export const ERROR_CODES = Object.freeze({
  HOST_UNSUPPORTED: 'XIAOBAI_HOST_UNSUPPORTED',
  SCOPE_REQUIRED: 'XIAOBAI_SCOPE_REQUIRED',
  PROJECT_NOT_FOUND: 'XIAOBAI_PROJECT_NOT_FOUND',
  KNOWLEDGE_LOCK_REQUIRED: 'XIAOBAI_KNOWLEDGE_LOCK_REQUIRED',
  LOCK_DRIFT: 'XIAOBAI_LOCK_DRIFT',
  PATH_ESCAPE: 'XIAOBAI_PATH_ESCAPE',
  CAPABILITY_DENIED: 'XIAOBAI_CAPABILITY_DENIED',
  WORKFLOW_SCRIPT_UNTRUSTED: 'XIAOBAI_WORKFLOW_SCRIPT_UNTRUSTED',
  GATE_EVIDENCE_MISSING: 'XIAOBAI_GATE_EVIDENCE_MISSING',
  MEMORY_AUDIT_FAILED: 'XIAOBAI_MEMORY_AUDIT_FAILED',
  MEMORY_CONFLICT: 'XIAOBAI_MEMORY_CONFLICT',
  BASELINE_INVALID: 'XIAOBAI_BASELINE_INVALID',
  CONTRACT_INVALID: 'XIAOBAI_CONTRACT_INVALID',
  WORKSPACE_REQUIRED: 'XIAOBAI_WORKSPACE_REQUIRED',
  CONFIG_INVALID: 'XIAOBAI_CONFIG_INVALID',
  CONFIG_DRIFT: 'XIAOBAI_CONFIG_DRIFT',
  CONFIG_CONFLICT: 'XIAOBAI_CONFIG_CONFLICT',
  APPROVAL_REQUIRED: 'XIAOBAI_APPROVAL_REQUIRED',
  WRITE_FAILED: 'XIAOBAI_WRITE_FAILED',
  LOOP_NOT_FOUND: 'XIAOBAI_LOOP_NOT_FOUND',
  EXECUTION_UNSUPPORTED: 'XIAOBAI_EXECUTION_UNSUPPORTED',
  PROJECTION_REDACTION_FAILED: 'XIAOBAI_PROJECTION_REDACTION_FAILED',
})

export const ID_PATTERNS = Object.freeze({
  resource: /^(ws|prj|repo|worktree|know|mem|run|stage|skill|gate|agent|artifact|evidence|drf|rev|ev)_[a-z0-9][a-z0-9_-]{2,63}$/,
  key: /^[a-z][a-z0-9-]{1,63}$/,
  storage: /^[a-z][a-z0-9_]*$/,
})

export const LIFECYCLE_STATES = Object.freeze([
  'draft',
  'active',
  'blocked',
  'completed',
  'archived',
])

export const RESOURCE_PREFIXES = Object.freeze([
  'ws',
  'prj',
  'repo',
  'worktree',
  'know',
  'mem',
  'run',
  'stage',
  'skill',
  'gate',
  'agent',
  'artifact',
  'evidence',
  'drf',
  'rev',
  'ev',
])

export const HOST_PACKAGE_NAMES = Object.freeze({
  dsh: '@deepseek-ai/dsh',
  cordis: '@deepseek-ai/cordis',
  seams: Object.freeze({
    scope: '@deepseek-ai/dsh-scope',
    storageDomain: '@deepseek-ai/dsh-storage-domain',
    skill: '@deepseek-ai/dsh-skill',
    workflow: '@deepseek-ai/dsh-workflow',
    approval: '@deepseek-ai/dsh-user-approval',
    invariants: '@deepseek-ai/dsh-invariants',
    typert: '@deepseek-ai/dsh-typert-registry',
    workspace: '@deepseek-ai/dsh-workspace',
  }),
  runtimes: Object.freeze({
    agent: '@deepseek-ai/dsh-agent',
    agentLoop: '@deepseek-ai/dsh-agent-loop',
    headless: '@deepseek-ai/dsh-headless',
  }),
})
