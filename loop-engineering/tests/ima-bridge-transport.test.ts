import assert from 'node:assert/strict';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { ImaBridgeTransport, imaBridgeTransportFromEnv, IMA_BRIDGE_URL_ENV } from '../packages/connector-runtime/src/imaBridgeTransport';

interface FakeBridgeOptions {
  respond?: (tool: string, input: Record<string, unknown>) => unknown;
  status?: number;
  delayMs?: number;
}

async function withFakeBridge(options: FakeBridgeOptions, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { tool: string; input: Record<string, unknown> };
      if (options.delayMs && options.delayMs > 0) {
        setTimeout(() => respond(), options.delayMs);
      } else {
        respond();
      }
      function respond() {
        if (options.status && options.status !== 200) {
          response.writeHead(options.status, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ ok: false, error: { code: 'mcp-error', message: 'upstream rejected' } }));
          return;
        }
        const result = options.respond ? options.respond(body.tool, body.input) : { items: [] };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true, result }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }
}

test('ImaBridgeTransport proxies tool calls to the loopback bridge verbatim', async () => {
  await withFakeBridge(
    {
      respond: (tool, input) => {
        assert.equal(tool, 'ima_search_knowledge');
        assert.deepEqual(input, { query: 'release gate', scope: 't-max', limit: 20 });
        return { items: [{ id: 'md-1', revision: 'r1' }] };
      }
    },
    async (baseUrl) => {
      const transport = new ImaBridgeTransport({ baseUrl });
      const result = (await transport.call('ima_search_knowledge', { query: 'release gate', scope: 't-max', limit: 20 }, { signal: AbortSignal.timeout(5000) })) as { items: Array<{ id: string }> };
      assert.equal(result.items[0]?.id, 'md-1');
    }
  );
});

test('ImaBridgeTransport maps bridge failures to coded errors', async () => {
  await withFakeBridge({ status: 502 }, async (baseUrl) => {
    const transport = new ImaBridgeTransport({ baseUrl });
    await assert.rejects(
      () => transport.call('ima_kb_manifest', { scope: 't-max' }, { signal: AbortSignal.timeout(5000) }),
      (error: Error & { code?: string; status?: number }) => error.code === 'mcp-error' && error.status === 502
    );
  });
});

test('ImaBridgeTransport honors abort signals from the runtime', async () => {
  await withFakeBridge({ delayMs: 2000 }, async (baseUrl) => {
    const transport = new ImaBridgeTransport({ baseUrl });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => transport.call('ima_search_knowledge', { query: 'x', scope: 't-max' }, { signal: controller.signal }),
      (error: Error & { code?: string }) => error.code === 'ABORT_ERR' || /abort/i.test(error.message)
    );
  });
});

test('imaBridgeTransportFromEnv stays dormant without the bridge environment variable', async () => {
  const previous = process.env[IMA_BRIDGE_URL_ENV];
  delete process.env[IMA_BRIDGE_URL_ENV];
  try {
    assert.equal(imaBridgeTransportFromEnv(), undefined);
    const transport = imaBridgeTransportFromEnv({ baseUrl: 'http://127.0.0.1:8791' });
    assert.equal(transport instanceof ImaBridgeTransport, true);
  } finally {
    if (previous !== undefined) process.env[IMA_BRIDGE_URL_ENV] = previous;
  }
});
