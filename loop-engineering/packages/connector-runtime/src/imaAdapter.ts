import { digestJson } from '../../shared/src/canonicalDigest';
import { ConnectorSpec, ImaConnectorConfig, JsonRecord } from '../../shared/src/types';

export type ImaErrorCategory =
  | 'timeout'
  | 'permission'
  | 'empty-result'
  | 'out-of-scope'
  | 'digest-mismatch'
  | 'not-loaded'
  | 'invalid-response'
  | 'transport';

export class ImaAdapterError extends Error {
  readonly name = 'ImaAdapterError';

  constructor(
    readonly category: ImaErrorCategory,
    message: string,
    readonly details?: JsonRecord
  ) {
    super(message);
  }
}

export interface ImaTransportCallOptions {
  signal: AbortSignal;
  server?: string;
}

/** Injectable boundary for the IMA MCP server. It must not implement writes. */
export interface ImaTransport {
  call(tool: string, input: JsonRecord, options: ImaTransportCallOptions): Promise<unknown>;
}

export interface ImaAdapterOptions {
  transport: ImaTransport;
  server?: string;
  scope?: string;
  searchTool?: string;
  getTool?: string;
  timeoutMs?: number;
  maxLimit?: number;
  maxCharacters?: number;
  allowedScopes?: string[];
}

export interface ImaSearchRequest {
  query: string;
  projectScope: string;
  limit?: number;
  maxCharacters?: number;
  expectedRevision?: string;
  expectedDigest?: string;
}

export interface ImaGetRequest {
  id: string;
  projectScope: string;
  maxCharacters?: number;
  expectedRevision?: string;
  expectedDigest?: string;
}

export interface ImaDocument {
  id: string;
  noteId: string;
  title: string;
  content: string;
  category?: string;
  source: string;
  revision: string;
  digest: string;
  scope: string;
  updatedAt?: string;
}

export interface ImaRetrievalEvidence {
  query: string;
  queryHash: string;
  selectedItemIds: string[];
  retrievedAt: string;
  source: string[];
  revision: string[];
  digest: string[];
  scope: string;
  adapterVersion: 'ima-adapter-v1';
  status: 'success';
}

export interface ImaSearchResult {
  documents: ImaDocument[];
  evidence: ImaRetrievalEvidence;
}

export interface ImaGetResult {
  document: ImaDocument;
  evidence: ImaRetrievalEvidence;
}

const DEFAULT_SEARCH_TOOL = 'ima_search_knowledge';
const DEFAULT_GET_TOOL = 'ima_get_note_content';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_LIMIT = 20;
const DEFAULT_MAX_CHARACTERS = 12_000;

/**
 * Read-only IMA adapter. All transport failures and contract violations throw
 * an explicit category so callers can stop without inventing missing context.
 */
export class ImaAdapter {
  private readonly timeoutMs: number;
  private readonly maxLimit: number;
  private readonly maxCharacters: number;
  private readonly allowedScopes: Set<string>;
  private readonly defaultScope?: string;

  constructor(private readonly options: ImaAdapterOptions) {
    this.timeoutMs = boundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1, 120_000, 'timeoutMs');
    this.maxLimit = boundedInteger(options.maxLimit ?? DEFAULT_MAX_LIMIT, 1, 100, 'maxLimit');
    this.maxCharacters = boundedInteger(
      options.maxCharacters ?? DEFAULT_MAX_CHARACTERS,
      1,
      100_000,
      'maxCharacters'
    );
    this.allowedScopes = new Set(options.allowedScopes ?? []);
    this.defaultScope = options.scope ?? (options.allowedScopes?.length === 1 ? options.allowedScopes[0] : undefined);
  }

  static fromConnector(connector: ConnectorSpec, transport: ImaTransport): ImaAdapter {
    const config = connector.config?.ima ?? connector.config ?? {};
    return new ImaAdapter({
      transport,
      server: config.server,
      scope: config.scope,
      searchTool: config.searchTool ?? config.tool,
      getTool: config.getTool,
      timeoutMs: config.timeoutMs,
      maxLimit: config.maxLimit ?? config.limit,
      maxCharacters: config.maxCharacters,
      allowedScopes: config.scope ? [config.scope] : undefined
    });
  }

  async search(request: ImaSearchRequest): Promise<ImaSearchResult> {
    const query = normalizeRequiredString(request.query, 'query');
    const projectScope = normalizeRequiredString(request.projectScope, 'projectScope');
    const limit = boundedInteger(request.limit ?? this.maxLimit, 1, this.maxLimit, 'limit');
    const maxCharacters = boundedInteger(
      request.maxCharacters ?? this.maxCharacters,
      1,
      this.maxCharacters,
      'maxCharacters'
    );
    const raw = await this.call(this.options.searchTool ?? DEFAULT_SEARCH_TOOL, {
      query,
      scope: projectScope,
      limit
    });
    const documents = this.normalize(raw, projectScope, maxCharacters).slice(0, limit);
    if (documents.length === 0) {
      throw new ImaAdapterError('empty-result', `IMA returned no documents for scope ${projectScope}`, {
        query,
        scope: projectScope
      });
    }
    this.assertExpected(documents, request.expectedRevision, request.expectedDigest);
    return {
      documents,
      evidence: this.evidence(query, projectScope, documents)
    };
  }

  /** Compatibility name from the IMA adapter contract. */
  async searchNotes(query: string, projectScope: string, limit?: number): Promise<ImaSearchResult> {
    return this.search({ query, projectScope, ...(limit === undefined ? {} : { limit }) });
  }

  async get(request: ImaGetRequest): Promise<ImaGetResult> {
    const id = normalizeRequiredString(request.id, 'id');
    const projectScope = normalizeRequiredString(request.projectScope, 'projectScope');
    const maxCharacters = boundedInteger(
      request.maxCharacters ?? this.maxCharacters,
      1,
      this.maxCharacters,
      'maxCharacters'
    );
    const raw = await this.call(this.options.getTool ?? DEFAULT_GET_TOOL, {
      id,
      scope: projectScope
    });
    const documents = this.normalize(raw, projectScope, maxCharacters);
    if (documents.length === 0) {
      throw new ImaAdapterError('empty-result', `IMA returned no document for ${id}`, { id, scope: projectScope });
    }
    const document = documents.find((item) => item.id === id);
    if (!document) {
      throw new ImaAdapterError('invalid-response', `IMA response did not contain requested document ${id}`, { id });
    }
    this.assertExpected([document], request.expectedRevision, request.expectedDigest);
    return {
      document,
      evidence: this.evidence(id, projectScope, [document])
    };
  }

  /** Compatibility name from the IMA adapter contract. */
  async getNote(noteId: string, expectedDigest?: string, projectScope?: string): Promise<ImaGetResult> {
    const scope = projectScope ?? this.defaultScope;
    if (!scope) {
      throw new ImaAdapterError('invalid-response', 'IMA getNote requires a project scope');
    }
    return this.get({ id: noteId, projectScope: scope, ...(expectedDigest ? { expectedDigest } : {}) });
  }

  /** Normalize supported MCP result envelopes into the adapter contract. */
  normalize(raw: unknown, projectScope: string, maxCharacters = this.maxCharacters): ImaDocument[] {
    maxCharacters = boundedInteger(maxCharacters, 1, this.maxCharacters, 'maxCharacters');
    const records = extractRecords(raw);
    if (records.length === 0) {
      if (raw === undefined || raw === null) return [];
      // An explicit empty MCP envelope is a valid no-result response. Let the
      // caller classify it as `empty-result`; malformed envelopes remain an
      // invalid-response and fail closed separately.
      if (isRecord(raw) && ['items', 'results', 'notes', 'documents'].some((key) => Array.isArray(raw[key]))) {
        return [];
      }
      throw new ImaAdapterError('invalid-response', 'IMA response did not contain document records');
    }
    const documents = records.map((record) => normalizeDocument(record, maxCharacters));
    const outOfScope = documents.filter((document) => !this.isAllowedScope(document.scope, projectScope));
    if (outOfScope.length > 0) {
      throw new ImaAdapterError('out-of-scope', `IMA returned documents outside scope ${projectScope}`, {
        scope: projectScope,
        itemIds: outOfScope.map((item) => item.id)
      });
    }
    const unique = new Map<string, ImaDocument>();
    for (const document of documents) unique.set(document.id, document);
    const sorted = [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
    const bounded: ImaDocument[] = [];
    let usedCharacters = 0;
    for (const document of sorted) {
      if (usedCharacters >= maxCharacters) break;
      const remaining = maxCharacters - usedCharacters;
      const content = document.content.slice(0, remaining);
      bounded.push(content === document.content ? document : { ...document, content });
      usedCharacters += content.length;
    }
    return bounded;
  }

  /** Rebuild evidence from a normalized result for run-artifact persistence. */
  recordEvidence(result: ImaSearchResult): ImaRetrievalEvidence {
    return this.evidence(result.evidence.query, result.evidence.scope, result.documents);
  }

  private isAllowedScope(scope: string, projectScope: string): boolean {
    return scope === projectScope || this.allowedScopes.has(scope);
  }

  evidence(query: string, scope: string, documents: ImaDocument[]): ImaRetrievalEvidence {
    return {
      query,
      queryHash: digestJson(query),
      selectedItemIds: documents.map((item) => item.id),
      retrievedAt: new Date().toISOString(),
      source: documents.map((item) => item.source),
      revision: documents.map((item) => item.revision),
      digest: documents.map((item) => item.digest),
      scope,
      adapterVersion: 'ima-adapter-v1',
      status: 'success'
    };
  }

  private assertExpected(documents: ImaDocument[], expectedRevision?: string, expectedDigest?: string): void {
    if (expectedRevision && documents.some((item) => item.revision !== expectedRevision)) {
      throw new ImaAdapterError('digest-mismatch', `IMA revision mismatch; expected ${expectedRevision}`, {
        expectedRevision,
        actualRevisions: documents.map((item) => item.revision)
      });
    }
    if (expectedDigest && documents.some((item) => item.digest !== expectedDigest)) {
      throw new ImaAdapterError('digest-mismatch', `IMA digest mismatch; expected ${expectedDigest}`, {
        expectedDigest,
        actualDigests: documents.map((item) => item.digest)
      });
    }
  }

  private async call(tool: string, input: JsonRecord): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.options.transport.call(tool, input, { signal: controller.signal, server: this.options.server }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new ImaAdapterError('timeout', `IMA ${tool} timed out after ${this.timeoutMs}ms`, { tool }));
          }, this.timeoutMs);
        })
      ]);
      return result;
    } catch (error) {
      if (error instanceof ImaAdapterError) throw error;
      throw classifyTransportError(error, tool);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function extractRecords(raw: unknown): JsonRecord[] {
  if (Array.isArray(raw)) {
    if (raw.some((item) => !isRecord(item))) {
      throw new ImaAdapterError('invalid-response', 'IMA response contains a non-object document item');
    }
    return raw;
  }
  if (!isRecord(raw)) return [];
  for (const key of ['items', 'results', 'notes', 'documents']) {
    if (Array.isArray(raw[key])) return extractRecords(raw[key]);
  }
  if (isRecord(raw.data)) {
    return extractRecords(raw.data);
  }
  return [raw];
}

function normalizeDocument(record: JsonRecord, maxCharacters: number): ImaDocument {
  const metadata = isRecord(record.metadata) ? record.metadata : {};
  const frontmatter = isRecord(record.frontmatter) ? record.frontmatter : {};
  const id = firstString(record.id, record.noteId, record.itemId, metadata.id);
  const title = firstString(record.title, record.name, metadata.title);
  const content = firstString(record.content, record.body, record.text, record.summary);
  const category = firstString(record.category, metadata.category, frontmatter.category);
  const source = firstString(
    record.source,
    record.sourceRef,
    record.sourceUrl,
    record.url,
    record.path,
    metadata.source,
    metadata.sourceRef
  );
  const revision = firstString(record.revision, record.version, record.updatedAt, metadata.revision);
  const scopeValue = record.scope ?? metadata.scope ?? frontmatter.scope;
  const scope = Array.isArray(scopeValue) ? firstString(scopeValue[0]) : firstString(scopeValue);
  const updatedAt = firstString(record.updatedAt, metadata.updatedAt);
  if (!id || !title || content === undefined || !source || !revision || !scope) {
    throw new ImaAdapterError('invalid-response', 'IMA document is missing id, title, content, source, revision, or scope');
  }
  const digest = firstString(record.digest, record.sha256, metadata.digest, metadata.sha256)
    ?? digestJson({ id, title, content, source, revision, scope });
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new ImaAdapterError('invalid-response', `IMA document ${id} has an invalid digest`);
  }
  return {
    id,
    noteId: id,
    title,
    content: content.slice(0, maxCharacters),
    ...(category ? { category } : {}),
    source,
    revision,
    digest,
    scope,
    ...(updatedAt ? { updatedAt } : {})
  };
}

function classifyTransportError(error: unknown, tool: string): ImaAdapterError {
  const record = isRecord(error) ? error : {};
  const message = error instanceof Error ? error.message : String(error);
  const code = firstString(record.code, record.status, record.statusCode) ?? '';
  if (code === 'MCP_NOT_LOADED' || /not loaded|unsupported|server.*unavailable|mcp.*not/i.test(message)) {
    return new ImaAdapterError('not-loaded', `IMA MCP is not loaded for ${tool}`);
  }
  if (code === '401' || code === '403' || /permission|forbidden|unauthori[sz]ed|access denied/i.test(message)) {
    return new ImaAdapterError('permission', `IMA permission denied for ${tool}`);
  }
  if (code === 'ETIMEDOUT' || code === 'ABORT_ERR' || /timed? ?out|timeout|aborted/i.test(message)) {
    return new ImaAdapterError('timeout', `IMA ${tool} timed out`);
  }
  return new ImaAdapterError('transport', `IMA ${tool} transport failed`, { message: redactSensitive(message) });
}

function boundedInteger(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ImaAdapterError('invalid-response', `${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function normalizeRequiredString(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ImaAdapterError('invalid-response', `${name} is required`);
  }
  return value.trim();
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactSensitive(message: string): string {
  return message.replace(
    /(authorization|api[-_ ]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
    '$1=[REDACTED]'
  );
}
