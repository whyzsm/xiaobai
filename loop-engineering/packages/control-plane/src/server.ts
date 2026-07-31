#!/usr/bin/env node
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { AnySchema, ErrorObject } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import workspaceSchema from '../../../schemas/xiaobai-workspace.schema.json';
import { WorkspaceControlPlane, WorkspaceControlPlaneValidationError } from './workspaceControlPlane';
import { CreateWorkspaceInput, PreflightIssue } from './types';

const DEFAULT_PORT = 18002;
const MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_ALLOWED_ORIGINS = ['http://127.0.0.1:3001', 'http://localhost:3001', 'http://127.0.0.1:8000', 'http://localhost:8000'];
const requestValidator = new Ajv2020({ allErrors: true, strict: false }).compile(workspaceSchema as AnySchema);

export function startControlPlaneServer(options: {
  port?: number;
  host?: string;
  dataRoot?: string;
  xiaonengSourcePath?: string;
  allowedOrigins?: string[];
} = {}) {
  const port = options.port ?? readPort(process.env.XIAOBAI_CONTROL_PLANE_PORT);
  const host = options.host ?? readHost(process.env.XIAOBAI_CONTROL_PLANE_HOST);
  const dataRoot = path.resolve(options.dataRoot ?? process.env.XIAOBAI_DATA_ROOT ?? '.xiaobai-data');
  const xiaonengSourcePath = options.xiaonengSourcePath ?? process.env.XIAONENG_SOURCE_PATH;
  const allowedOrigins = options.allowedOrigins ?? readAllowedOrigins(process.env.XIAOBAI_ALLOWED_ORIGINS);
  const controlPlane = new WorkspaceControlPlane({ dataRoot, xiaonengSourcePath });

  const server = createServer(async (request, response) => {
    try {
      if (!applyCors(request, response, allowedOrigins)) {
        return;
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204).end();
        return;
      }
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, { status: 'ok' });
        return;
      }
      if (request.method === 'GET' && request.url === '/config') {
        sendJson(response, 200, {
          dataRoot: controlPlane.dataRoot,
          projectsAgentRoot: controlPlane.projectsAgentRoot,
          backgroundsAgentRoot: controlPlane.backgroundsAgentRoot
        });
        return;
      }
      if (request.method === 'GET' && request.url === '/workspaces') {
        sendJson(response, 200, { workspaces: await controlPlane.listWorkspaces() });
        return;
      }
      if (request.method === 'POST' && request.url === '/workspaces/preflight') {
        sendJson(response, 200, await controlPlane.preflight(await readJsonBody(request)));
        return;
      }
      if (request.method === 'POST' && request.url === '/workspaces') {
        sendJson(response, 201, { workspace: await controlPlane.createWorkspace(await readJsonBody(request)) });
        return;
      }
      sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof WorkspaceControlPlaneValidationError) {
        sendJson(response, 422, { error: error.code, issues: error.issues });
      } else if (error instanceof InvalidRequestError) {
        sendJson(response, 400, { error: error.code, issues: error.issues });
      } else if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: 'invalid_json' });
      } else if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: 'payload_too_large' });
      } else {
        console.error('Xiaobai control-plane request failed', error instanceof Error ? error.message : error);
        sendJson(response, 500, { error: 'operation_failed' });
      }
    }
  });

  server.listen(port, host, () => {
    process.stdout.write(`Xiaobai control plane: http://${host}:${port}\n`);
    process.stdout.write(`Managed data root: ${dataRoot}\n`);
  });
  return server;
}

class PayloadTooLargeError extends Error {}

class InvalidRequestError extends Error {
  readonly code = 'invalid_request';

  constructor(readonly issues: PreflightIssue[]) {
    super('Invalid workspace request');
  }
}

async function readJsonBody(request: IncomingMessage): Promise<CreateWorkspaceInput> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!requestValidator(value)) {
    throw new InvalidRequestError(formatSchemaIssues(requestValidator.errors));
  }
  return value as CreateWorkspaceInput;
}

function formatSchemaIssues(errors: ErrorObject[] | null | undefined): PreflightIssue[] {
  return (errors ?? []).map((error) => {
    const missingProperty =
      error.keyword === 'required' && typeof error.params.missingProperty === 'string'
        ? error.params.missingProperty
        : null;
    const field = [error.instancePath.replace(/^\//, '').replaceAll('/', '.'), missingProperty]
      .filter(Boolean)
      .join('.');
    return {
      field: field || 'request',
      code: 'invalid_request',
      message: error.message ?? 'Invalid value.'
    };
  });
}

function applyCors(request: IncomingMessage, response: ServerResponse, allowedOrigins: string[]): boolean {
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.includes(origin)) {
    sendJson(response, 403, { error: 'origin_not_allowed' });
    return false;
  }
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  return true;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(body)}\n`);
}

function readPort(value: string | undefined): number {
  const parsed = Number(value ?? DEFAULT_PORT);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_PORT;
}

function readHost(value: string | undefined): '127.0.0.1' | '0.0.0.0' {
  return value === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
}

function readAllowedOrigins(value: string | undefined): string[] {
  return value ? value.split(',').map((origin) => origin.trim()).filter(Boolean) : DEFAULT_ALLOWED_ORIGINS;
}

if (require.main === module) {
  startControlPlaneServer();
}
