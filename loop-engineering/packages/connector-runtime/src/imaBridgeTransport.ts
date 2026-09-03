import { JsonRecord } from '../../shared/src/types';
import { ImaTransport, ImaTransportCallOptions } from './imaAdapter';

/** Environment variable pointing at the DSH-hosted read-only IMA bridge. */
export const IMA_BRIDGE_URL_ENV = 'XIAOBAI_IMA_BRIDGE_URL';

export const DEFAULT_IMA_BRIDGE_URL = 'http://127.0.0.1:8791';

export interface ImaBridgeTransportOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * ImaTransport backed by the DSH Host read-only IMA bridge (loopback HTTP).
 * The bridge owns scope-to-knowledge-base mapping, MCP credentials, frontmatter
 * extraction, and normalization; this client is a thin fail-closed proxy.
 */
export class ImaBridgeTransport implements ImaTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ImaBridgeTransportOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env[IMA_BRIDGE_URL_ENV] ?? DEFAULT_IMA_BRIDGE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async call(tool: string, input: JsonRecord, options: ImaTransportCallOptions): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool, input }),
        ...(options.signal ? { signal: options.signal } : {})
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(`IMA bridge ${tool} transport failed: ${message}`), {
        code: error instanceof Error && error.name === 'AbortError' ? 'ABORT_ERR' : undefined
      });
    }
    const payload = (await response.json().catch(() => undefined)) as
      | { ok?: boolean; result?: unknown; error?: { code?: string; message?: string } }
      | undefined;
    if (!response.ok || !payload || payload.ok !== true) {
      const code = payload?.error?.code ?? String(response.status);
      const message = payload?.error?.message ?? `IMA bridge ${tool} failed with HTTP ${response.status}`;
      throw Object.assign(new Error(message), { code, status: response.status });
    }
    return payload.result;
  }
}

/**
 * Resolve the runtime IMA transport from the environment. Returns undefined
 * when no bridge URL is configured so ExecutionRuntime keeps failing closed.
 */
export function imaBridgeTransportFromEnv(options: ImaBridgeTransportOptions = {}): ImaTransport | undefined {
  if (!options.baseUrl && !process.env[IMA_BRIDGE_URL_ENV]) return undefined;
  return new ImaBridgeTransport(options);
}
