import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, writeSnapshot } from './generate-monitor-data.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const MONITORING_ROOT = path.resolve(SCRIPT_DIR, '..');
const DASHBOARD_PATH = path.join(MONITORING_ROOT, 'dashboard.html');
const MONITOR_DATA_PATH = path.join(PROJECT_ROOT, 'workspace/.local/monitoring/monitor-data.json');
const GRAPH_PATH = path.join(PROJECT_ROOT, '.understand-anything/knowledge-graph.json');
const HOST = '127.0.0.1';
const DEFAULT_PORT = 8766;
const MAX_PORT = 8775;
const ACCESS_TOKEN = crypto.randomBytes(16).toString('hex');

function parseArgs(argv) {
  const parsed = {
    port: DEFAULT_PORT,
    open: process.env.XIAOBAI_DASHBOARD_NO_OPEN !== '1',
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--no-open') parsed.open = false;
    if (argv[index] === '--port' && argv[index + 1]) {
      const port = Number(argv[index + 1]);
      if (Number.isInteger(port) && port > 0 && port <= 65535) parsed.port = port;
      index += 1;
    }
  }
  return parsed;
}

function sendJson(response, statusCode, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(body);
}

function sendFile(response, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }
  const body = fs.readFileSync(filePath);
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
  });
  response.end(body);
}

function hasValidToken(url) {
  return url.searchParams.get('token') === ACCESS_TOKEN;
}

function refreshSnapshot() {
  const snapshot = buildSnapshot();
  writeSnapshot(snapshot, MONITOR_DATA_PATH);
  return snapshot;
}

function createRequestHandler() {
  return (request, response) => {
    const url = new URL(request.url || '/', `http://${HOST}`);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard.html')) {
      sendFile(response, DASHBOARD_PATH, 'text/html; charset=utf-8');
      return;
    }
    if (!hasValidToken(url)) {
      sendJson(response, 403, { error: 'Forbidden: missing or invalid token' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/monitor-data.json') {
      sendFile(response, MONITOR_DATA_PATH, 'application/json; charset=utf-8');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/knowledge-graph.json') {
      sendFile(response, GRAPH_PATH, 'application/json; charset=utf-8');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true, service: 'xiaobai-agent-ops' });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/refresh') {
      try {
        const snapshot = refreshSnapshot();
        sendJson(response, 200, {
          ok: true,
          generatedAt: snapshot.generatedAt,
          health: snapshot.health,
          warnings: snapshot.warnings.length,
        });
      } catch {
        sendJson(response, 500, { error: 'Snapshot refresh failed' });
      }
      return;
    }
    sendJson(response, 404, { error: 'Not found' });
  };
}

function openUrl(url) {
  const child = spawn('open', [url], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function listen(server, port, onReady) {
  const handleError = (error) => {
    server.off('error', handleError);
    if (error.code === 'EADDRINUSE' && port < MAX_PORT) {
      listen(server, port + 1, onReady);
      return;
    }
    throw error;
  };
  server.once('error', handleError);
  server.listen(port, HOST, () => {
    server.off('error', handleError);
    onReady(port);
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = refreshSnapshot();
  const server = http.createServer(createRequestHandler());
  listen(server, args.port, (port) => {
    const dashboardUrl = `http://${HOST}:${port}/dashboard.html?token=${ACCESS_TOKEN}#overview`;
    process.stdout.write(`\n  小白 Agent Ops / Xiaobai Agent Ops\n`);
    process.stdout.write(`  Snapshot: ${snapshot.health} (${snapshot.warnings.length} warnings)\n`);
    process.stdout.write(`  Dashboard URL: ${dashboardUrl}\n\n`);
    if (args.open) openUrl(dashboardUrl);
  });
}

main();
