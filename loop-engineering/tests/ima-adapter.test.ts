import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { ConnectorRuntime } from '../packages/connector-runtime/src/connectorRuntime';
import { readYamlFile } from '../packages/shared/src/fs';
import type { ConnectorSpec } from '../packages/shared/src/types';
import {
  ImaAdapter,
  ImaAdapterError,
  ImaTransport,
  ImaTransportCallOptions
} from '../packages/connector-runtime/src/imaAdapter';
import { digestJson } from '../packages/shared/src/canonicalDigest';

const scope = 'tmax-dcm';

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    title: 'Release runbook',
    content: 'Use the release gate before cutover.',
    source: 'ima://tmax-dcm/release-runbook',
    revision: 'r3',
    scope,
    digest: digestJson({
      id: 'note-1',
      title: 'Release runbook',
      content: 'Use the release gate before cutover.',
      source: 'ima://tmax-dcm/release-runbook',
      revision: 'r3',
      scope
    }),
    ...overrides
  };
}

function transport(
  handler: (tool: string, input: Record<string, unknown>, options: ImaTransportCallOptions) => Promise<unknown> | unknown
): ImaTransport {
  return { call: async (tool, input, options) => handler(tool, input, options) };
}

test('ImaAdapter searches through an injected read-only transport and records evidence', async () => {
  const calls: Array<{ tool: string; input: Record<string, unknown>; server?: string }> = [];
  const adapter = new ImaAdapter({
    transport: transport(async (tool, input, options) => {
      calls.push({ tool, input, server: options.server });
      return { results: [document(), document({ id: 'note-1', title: 'Duplicate' })] };
    }),
    server: 'ima',
    maxLimit: 5
  });

  const result = await adapter.search({ query: 'release', projectScope: scope, limit: 2 });

  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0]?.id, 'note-1');
  assert.equal(result.evidence.query, 'release');
  assert.equal(result.evidence.queryHash.startsWith('sha256:'), true);
  assert.deepEqual(result.evidence.selectedItemIds, ['note-1']);
  assert.equal(result.evidence.scope, scope);
  assert.equal(result.evidence.adapterVersion, 'ima-adapter-v1');
  assert.equal(result.evidence.status, 'success');
  assert.deepEqual(calls, [{
    tool: 'ima_search_knowledge',
    input: { query: 'release', scope, limit: 2 },
    server: 'ima'
  }]);
});

test('ImaAdapter gets a scoped document and bounds the returned content', async () => {
  const adapter = new ImaAdapter({
    transport: transport(async () => ({ data: document({ content: '0123456789' }) })),
    maxCharacters: 4
  });

  const result = await adapter.get({ id: 'note-1', projectScope: scope, maxCharacters: 4 });

  assert.equal(result.document.content, '0123');
  assert.deepEqual(result.evidence.selectedItemIds, ['note-1']);
  assert.equal(result.evidence.source[0], 'ima://tmax-dcm/release-runbook');
});

test('ImaAdapter supports the planned searchNotes/getNote/recordEvidence contract', async () => {
  const adapter = new ImaAdapter({
    transport: transport(async (tool) => ({
      items: [document({ id: tool === 'ima_get_note_content' ? 'note-1' : 'note-2' })]
    })),
    scope
  });
  const search = await adapter.searchNotes('release', scope, 1);
  const note = await adapter.getNote('note-1', undefined);
  assert.equal(search.documents[0]?.id, 'note-2');
  assert.equal(note.document.id, 'note-1');
  assert.equal(adapter.recordEvidence(search).selectedItemIds[0], 'note-2');
});

test('ImaAdapter fails closed for scope, digest, empty, and transport errors', async () => {
  const outside = new ImaAdapter({
    transport: transport(async () => ({ items: [document({ scope: 'other-project' })] }))
  });
  await assert.rejects(
    () => outside.search({ query: 'release', projectScope: scope }),
    (error: unknown) => error instanceof ImaAdapterError && error.category === 'out-of-scope'
  );

  const digest = new ImaAdapter({
    transport: transport(async () => ({ items: [document()] }))
  });
  await assert.rejects(
    () => digest.search({ query: 'release', projectScope: scope, expectedDigest: 'sha256:' + '0'.repeat(64) }),
    (error: unknown) => error instanceof ImaAdapterError && error.category === 'digest-mismatch'
  );

  const empty = new ImaAdapter({ transport: transport(async () => ({ items: [] })) });
  await assert.rejects(
    () => empty.search({ query: 'missing', projectScope: scope }),
    (error: unknown) => error instanceof ImaAdapterError && error.category === 'empty-result'
  );

  const permission = new ImaAdapter({
    transport: transport(async () => {
      throw Object.assign(new Error('forbidden'), { status: 403 });
    })
  });
  await assert.rejects(
    () => permission.search({ query: 'release', projectScope: scope }),
    (error: unknown) => error instanceof ImaAdapterError && error.category === 'permission'
  );
});

test('ImaAdapter rejects documents without server revision or digest', async () => {
  const missingDigest = new ImaAdapter({
    transport: transport(async () => ({ items: [document({ digest: undefined })] }))
  });
  await assert.rejects(
    () => missingDigest.search({ query: 'release', projectScope: scope }),
    (error: unknown) => error instanceof ImaAdapterError && error.category === 'invalid-response'
  );

  const missingRevision = new ImaAdapter({
    transport: transport(async () => ({ items: [document({ revision: undefined })] }))
  });
  await assert.rejects(
    () => missingRevision.search({ query: 'release', projectScope: scope }),
    (error: unknown) => error instanceof ImaAdapterError && error.category === 'invalid-response'
  );
});

test('ImaAdapter classifies MCP not-loaded and timeout failures', async () => {
  const notLoaded = new ImaAdapter({
    transport: transport(async () => {
      throw Object.assign(new Error('MCP server is not loaded'), { code: 'MCP_NOT_LOADED' });
    })
  });
  await assert.rejects(
    () => notLoaded.search({ query: 'release', projectScope: scope }),
    (error: unknown) => error instanceof ImaAdapterError && error.category === 'not-loaded'
  );

  const timeout = new ImaAdapter({
    timeoutMs: 10,
    transport: transport(async (_tool, _input, options) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(options.signal.aborted, true);
      return { items: [document()] };
    })
  });
  await assert.rejects(
    () => timeout.search({ query: 'release', projectScope: scope }),
    (error: unknown) => error instanceof ImaAdapterError && error.category === 'timeout'
  );
});

test('connector schema exposes non-sensitive IMA settings and rejects credential fields', async () => {
  const schema = JSON.parse(
    await readFile(path.resolve('loop-engineering/schemas/connector.schema.json'), 'utf8')
  ) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const base = {
    kind: 'Connector',
    id: 'ima',
    capabilities: ['read_knowledge'],
    permissions: { write: { allow: [], deny: ['write_note'] } },
    rateLimit: { maxCallsPerRun: 10 }
  };
  assert.equal(validate({
    ...base,
    config: { ima: { server: 'ima', searchTool: 'ima_search_knowledge', timeoutMs: 1000, maxLimit: 10, scope } }
  }), true);
  assert.equal(validate({ ...base, config: { ima: { credentials: 'should-not-be-here' } } }), false);
  assert.equal(validate({ ...base, config: { token: 'should-not-be-here' } }), false);

  const workspaceConnector = await readYamlFile<ConnectorSpec>(path.resolve('workspace/connectors/ima.yaml'));
  assert.equal(validate(workspaceConnector), true);
  assert.equal(workspaceConnector.config?.ima?.scope, undefined);
});

test('ConnectorRuntime exposes a controlled IMA entry point and fails closed without transport', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'connector-runtime-ima-'));
  await mkdir(path.join(workspaceRoot, 'connectors'), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, 'connectors', 'ima.yaml'),
    [
      'kind: Connector',
      'id: ima',
      'capabilities:',
      '  - read_knowledge',
      'permissions:',
      '  write:',
      '    allow: []',
      '    deny:',
      '      - write_note',
      'rateLimit:',
      '  maxCallsPerRun: 10',
      'config:',
      '  ima:',
      '    server: ima'
    ].join('\n') + '\n',
    'utf8'
  );
  const runtime = new ConnectorRuntime(workspaceRoot, {
    transports: {
      ima: transport(async () => ({ items: [document()] }))
    }
  });
  const result = await runtime.searchIma({ query: 'release', projectScope: scope });
  assert.equal(result.documents[0]?.id, 'note-1');

  const noTransport = new ConnectorRuntime(workspaceRoot);
  await assert.rejects(
    () => noTransport.searchIma({ query: 'release', projectScope: scope }),
    (error: unknown) => error instanceof ImaAdapterError && error.category === 'not-loaded'
  );
});
