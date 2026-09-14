#!/usr/bin/env node
/**
 * DSH 会话节点停留时间分析器 / DSH session stage-dwell-time analyzer.
 *
 * 从 DSH 会话存储（.dsh-home/sessions/<workspace>/<session>/session.jsonl.zstd）提取
 * 真实事件时间戳，输出 step 级（= 工具轮）与 turn 级停留时间、工具耗时、用户等待，
 * 用于按《小白评价工程体系》产出节点停留时间表（不再依赖 mtime 锚点回溯）。
 *
 * Usage:
 *   node dsh-stage-timing.mjs <session-dir-or-file> [--from <ms|ISO>] [--to <ms|ISO>] [--json]
 *
 * Dependencies: zstd on PATH (session files are zstd-compressed jsonl).
 */
import { spawnSync } from 'node:child_process';
import { statSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function resolveTarget(p) {
  const s = statSync(p);
  if (s.isFile()) return p;
  const files = readdirSync(p).filter((f) => f.endsWith('.jsonl.zstd') || f.endsWith('.jsonl'));
  if (!files.length) throw new Error(`no session log in ${p}`);
  files.sort((a, b) => statSync(join(p, b)).mtimeMs - statSync(join(p, a)).mtimeMs);
  return join(p, files[0]);
}

function readEvents(file) {
  let text;
  if (file.endsWith('.zstd')) {
    const r = spawnSync('zstd', ['-dc', file], { maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error(`zstd failed: ${r.stderr?.toString()?.slice(0, 200)}`);
    text = r.stdout.toString('utf8');
  } else {
    text = readFileSync(file, 'utf8');
  }
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (d && d.time && d.type) events.push(d);
    } catch { /* skip malformed */ }
  }
  events.sort((a, b) => a.seq - b.seq);
  return events;
}

function parseTime(v) {
  if (v == null) return null;
  if (/^\d+$/.test(String(v))) return Number(v);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

const AUTO_PREFIXES = [
  '<system-reminder', 'Current runtime context', 'The approval policy',
  'This is an automatically generated checkpoint', '[vision proxy]', '[Pasted image',
];
function isRealUserMessage(data) {
  const c = data?.content;
  let txt = '';
  if (typeof c === 'string') txt = c;
  else if (Array.isArray(c)) txt = c.map((x) => (typeof x === 'string' ? x : x?.text ?? '')).join(' ');
  const head = txt.trim().slice(0, 60);
  return head && !AUTO_PREFIXES.some((p) => head.startsWith(p));
}

function firstText(data) {
  const c = data?.content;
  let txt = '';
  if (typeof c === 'string') txt = c;
  else if (Array.isArray(c)) txt = c.map((x) => (typeof x === 'string' ? x : x?.text ?? '')).join(' ');
  return txt.replace(/\s+/g, ' ').trim().slice(0, 48);
}

function fmtDur(ms) {
  if (ms == null) return '-';
  const s = ms / 1000;
  if (s < 90) return `${s.toFixed(1)}s`;
  return `${(s / 60).toFixed(1)}m`;
}
function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false });
}

// ---- main ----
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const from = parseTime(args[args.indexOf('--from') + 1]);
const to = parseTime(args[args.indexOf('--to') + 1]);
const asJson = args.includes('--json');
if (!target) { console.error('usage: node dsh-stage-timing.mjs <session-dir-or-file> [--from t] [--to t] [--json]'); process.exit(1); }

const events = readEvents(resolveTarget(target));
const win = events.filter((e) => (!from || e.time >= from) && (!to || e.time <= to));

// step aggregation: each step/start..step/end is one tool round
const steps = new Map(); // key `${turn}:${step}` -> {turn, step, start, end, tools: []}
const pending = new Map(); // same key -> queue of open tool/call {name, t}
for (const e of win) {
  const d = e.data ?? {};
  const key = `${d.turn}:${d.step}`;
  if (e.type === 'step/start') steps.set(key, { turn: d.turn, step: d.step, start: e.time, end: null, tools: [] });
  else if (e.type === 'step/end') { const s = steps.get(key); if (s) s.end = e.time; }
  else if (e.type === 'tool/call') {
    const q = pending.get(key) ?? [];
    q.push({ name: d.name, t: e.time });
    pending.set(key, q);
  } else if (e.type === 'tool/result') {
    const q = pending.get(key);
    const call = q?.shift();
    const s = steps.get(key);
    if (call && s) s.tools.push({ name: call.name, ms: e.time - call.t });
  }
}

// user waits: real user message -> next step/tool/assistant activity
const waits = [];
let lastUserAt = null; let lastUserText = '';
for (const e of win) {
  if (e.type === 'user/message') {
    if (isRealUserMessage(e.data)) { lastUserAt = e.time; lastUserText = firstText(e.data); }
  } else if (lastUserAt != null && (e.type === 'step/start' || e.type === 'assistant/message' || e.type === 'tool/call')) {
    waits.push({ at: lastUserAt, text: lastUserText, ms: e.time - lastUserAt });
    lastUserAt = null;
  }
}

const stepList = [...steps.values()].filter((s) => s.start != null);
const toolAgg = new Map();
for (const s of stepList) for (const t of s.tools) {
  const a = toolAgg.get(t.name) ?? { name: t.name, calls: 0, ms: 0 };
  a.calls += 1; a.ms += t.ms; toolAgg.set(t.name, a);
}

if (asJson) {
  console.log(JSON.stringify({ window: { from, to, events: win.length }, steps: stepList, waits, toolAgg: [...toolAgg.values()] }, null, 2));
} else {
  const total = stepList.reduce((a, s) => a + (s.end ?? s.start) - s.start, 0);
  const toolMs = stepList.reduce((a, s) => a + s.tools.reduce((x, t) => x + t.ms, 0), 0);
  console.log(`window events=${win.length} steps=${stepList.length} stepWall=${fmtDur(total)} toolTime=${fmtDur(toolMs)} nonTool=${fmtDur(total - toolMs)}`);
  console.log('\n== steps (tool rounds) ==');
  for (const s of stepList) {
    const wall = (s.end ?? s.start) - s.start;
    const tm = s.tools.reduce((x, t) => x + t.ms, 0);
    const names = s.tools.map((t) => t.name).join(',');
    console.log(`t${s.turn}s${String(s.step).padStart(2)} ${fmtClock(s.start)} wall=${fmtDur(wall).padStart(7)} tool=${fmtDur(tm).padStart(7)} ${names || '(no tool)'}`);
  }
  console.log('\n== tool aggregate (top 15) ==');
  for (const a of [...toolAgg.values()].sort((x, y) => y.ms - x.ms).slice(0, 15)) {
    console.log(`${a.name.padEnd(28)} calls=${String(a.calls).padStart(3)} total=${fmtDur(a.ms).padStart(7)} avg=${fmtDur(a.ms / a.calls)}`);
  }
  console.log('\n== user waits (msg -> next activity) ==');
  for (const w of waits) console.log(`${fmtClock(w.at)} wait=${fmtDur(w.ms).padStart(7)} | ${w.text}`);
}
