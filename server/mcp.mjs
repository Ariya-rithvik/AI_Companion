/**
 * Backstage — Web MCP server (REAL AI edition).
 *
 * One process does three jobs:
 *   1. Serves the operator console at  http://localhost:8787/
 *   2. Exposes capabilities as MCP tools at  POST /mcp  (JSON-RPC 2.0)
 *   3. Hosts real Socket.io meeting rooms at  /meeting  with WebRTC signaling
 *
 * Real integrations (no simulations):
 *   - GET  /meeting            → WebRTC meeting room UI
 *   - POST /api/chat           → Streaming LLM chat (token by token)
 *   - POST /api/meeting/create → Create a real meeting room
 *   - GET  /api/meeting/list   → List active rooms
 *   - POST /integrations/zoom  → Zoom webhook handler (if using Zoom)
 *
 * Run: node --env-file=.env server/mcp.mjs
 */

// ── Load environment variables (.env file) ────────────────────────────────
// If running with Node 20+ you can use --env-file=.env flag instead
try {
  const { createRequire } = await import('node:module');
  // Try native --env-file first (Node 20+), then fall back to dotenv
  if (!process.env.GROQ_API_KEY) {
    const dotenv = await import('dotenv').catch(() => null);
    if (dotenv) dotenv.config();
  }
} catch { /* dotenv optional */ }

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../engine/core.mjs';
import { SURFACE_LIST, surfaceById } from '../engine/surfaces.mjs';
import { seedLibrary } from '../engine/library.mjs';
import { attachMeetingServer, createRoom, listRooms, getRoom } from './meeting-server.mjs';
import { generateNudge, streamChat, buildChatMessages, isLLMConfigured, analyzeSession } from '../integrations/llm.mjs';
import { createMeetingCredentials } from '../integrations/zoom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8787;
const PROTOCOL_VERSION = '2025-06-18';

/* ───────────────────────────────── state ───────────────────────────────── */

const store = {
  sessions: new Map(),          // surfaceId -> live session
  experiments: [],
  skills: seedLibrary(),
};

const surf = id => {
  const s = surfaceById(id ?? 'webinar');
  if (!s) throw new Error('unknown surface: ' + id + ' (see surfaces_list)');
  return s;
};
const armedFor = sid => store.skills.filter(s => s.armed && s.surface === sid).flatMap(s => s.action);
const need = sid => {
  const s = store.sessions.get(sid ?? 'webinar');
  if (!s) throw new Error('no active session on ' + (sid ?? 'webinar') + ' — call session_start first');
  return s;
};

/* ───────────────────────────────── tools ───────────────────────────────── */

const str = d => ({ type: 'string', description: d });
const num = d => ({ type: 'number', description: d });
const surfaceArg = { type: 'string', enum: SURFACE_LIST.map(s => s.id), description: 'which surface to act on (default webinar)' };
const leverArr = { type: 'array', items: { type: 'string' }, description: 'lever ids — see experiment_levers' };

const TOOLS = [
  {
    name: 'surfaces_list',
    description: 'Every surface Backstage can observe, with its actors, stages, clock and economics. Start here.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => ({
      surfaces: SURFACE_LIST.map(s => ({
        id: s.id, label: s.label, blurb: s.blurb,
        actor: s.actorNoun, cohort: s.cohort,
        horizon: s.horizon + ' ' + (s.clock === 'days' ? 'days' : s.clock === 'hours' ? 'hours' : 'minutes'),
        stages: s.stages.map(x => x.id),
        outcome: s.economics.outcomeNoun,
        unit_value: s.economics.unitValue,
        levers: s.levers.length,
      })),
    }),
  },
  {
    name: 'session_start',
    description: 'Open an observation session on a surface and advance it. Returns vitals plus how many rows were emitted.',
    inputSchema: {
      type: 'object',
      properties: {
        surface: surfaceArg,
        cohort: num('override the cohort size'),
        advance: num('units of the surface clock to advance immediately; omit to replay the whole run'),
        skills: { type: 'array', items: { type: 'string' }, description: 'skill ids to arm; defaults to the armed library for that surface' },
      },
    },
    handler(a) {
      const sf = surf(a.surface);
      const levers = a.skills
        ? a.skills.flatMap(id => (store.skills.find(s => s.id === id) || { action: [] }).action)
        : armedFor(sf.id);
      const s = E.createSession({ surface: sf, seed: Math.floor(Math.random() * 9e6), cohort: a.cohort, levers, live: true });
      store.sessions.set(sf.id, s);
      const target = (a.advance ?? sf.horizon) * sf.stageUnit;
      while (!s.done && s.t < target) E.tick(s);
      return { session_id: s.id, surface: sf.id, armed_levers: levers, clock: E.fmtClock(sf, s.t), stage: s.stageId, done: s.done, ...E.metricsOf(s) };
    },
  },
  {
    name: 'session_advance',
    description: 'Advance the open session on a surface and return the events emitted in that window.',
    inputSchema: { type: 'object', properties: { surface: surfaceArg, units: num('units of the surface clock (default 5)') } },
    handler(a) {
      const sf = surf(a.surface);
      const s = need(sf.id);
      const from = s.dataset.length;
      const target = s.t + (a.units ?? 5) * sf.stageUnit;
      while (!s.done && s.t < target) E.tick(s);
      return { surface: sf.id, clock: E.fmtClock(sf, s.t), stage: s.stageId, done: s.done, new_events: s.dataset.length - from, events: s.dataset.slice(from, from + 40) };
    },
  },
  {
    name: 'session_status',
    description: 'Live vitals for a surface: concurrency, retention, cohort focus, expected outcomes, ROI.',
    inputSchema: { type: 'object', properties: { surface: surfaceArg } },
    handler(a) {
      const sf = surf(a.surface);
      const s = need(sf.id);
      return { session_id: s.id, surface: sf.id, clock: E.fmtClock(sf, s.t), stage: s.stageId, done: s.done, cohort_focus: +E.focusOf(s).toFixed(4), ...E.metricsOf(s) };
    },
  },
  {
    name: 'observe_stream',
    description: 'Observation events since a cursor. Poll to follow a surface without holding a socket.',
    inputSchema: {
      type: 'object',
      properties: { surface: surfaceArg, since_seq: num('rows with seq >= this (default 0)'), types: { type: 'array', items: { type: 'string' } }, limit: num('max rows (default 100)') },
    },
    handler(a) {
      const s = need(surf(a.surface).id);
      let rows = s.dataset.filter(r => r.seq >= (a.since_seq ?? 0));
      if (a.types?.length) rows = rows.filter(r => a.types.includes(r.type));
      return { total: rows.length, next_seq: s.dataset.length, rows: rows.slice(0, a.limit ?? 100) };
    },
  },
  {
    name: 'capture_moment',
    description: 'Register a keyframe capture with a caption at the current position. Appears in the operator console.',
    inputSchema: { type: 'object', required: ['caption'], properties: { surface: surfaceArg, caption: str('what this frame shows'), kind: str('moment kind') } },
    handler(a) {
      const sf = surf(a.surface);
      const s = need(sf.id);
      const m = { id: 'cap_' + s.moments.length, t: s.t, ts: E.fmtClock(sf, s.t), kind: a.kind ?? 'manual', caption: a.caption, stage: s.stageId };
      s.moments.push(m);
      return m;
    },
  },
  {
    name: 'dataset_query',
    description: 'Filter the labelled observation dataset. Rows carry payload, features and back-filled labels.',
    inputSchema: { type: 'object', properties: { surface: surfaceArg, type: str('event type'), stage: str('stage id'), actor: str('actor id'), limit: num('default 50') } },
    handler(a) {
      const s = need(surf(a.surface).id);
      let rows = s.dataset;
      if (a.type) rows = rows.filter(r => r.type === a.type);
      if (a.stage) rows = rows.filter(r => r.stage === a.stage);
      if (a.actor) rows = rows.filter(r => r.actor === a.actor);
      return { matched: rows.length, rows: rows.slice(0, a.limit ?? 50) };
    },
  },
  {
    name: 'dataset_export',
    description: 'Export a surface dataset as JSONL or CSV. Rows from every surface share one schema.',
    inputSchema: { type: 'object', properties: { surface: surfaceArg, format: { type: 'string', enum: ['jsonl', 'csv'] } } },
    handler(a) {
      const s = need(surf(a.surface).id);
      if ((a.format ?? 'jsonl') === 'csv') {
        const head = 'ts,surface,type,actor,stage,focus,intent,tenure_s,cohort_retention,churn_next,outcome';
        const body = s.dataset.map(r => [r.ts, r.surface, r.type, r.actor, r.stage, r.features.focus ?? '',
          r.features.intent ?? '', r.features.tenure_s ?? '', r.features.cohort_retention,
          r.label.churn_next ?? '', r.label.outcome ?? ''].join(','));
        return { format: 'csv', rows: s.dataset.length, data: [head, ...body].join('\n') };
      }
      return { format: 'jsonl', rows: s.dataset.length, data: s.dataset.map(r => JSON.stringify(r)).join('\n') };
    },
  },
  {
    name: 'experiment_levers',
    description: 'The levers an experiment may vary on a surface, with the hypothesis behind each and the surfaces each is known to transfer to.',
    inputSchema: { type: 'object', properties: { surface: surfaceArg } },
    handler(a) {
      const sf = surf(a.surface);
      return { surface: sf.id, levers: sf.levers.map(({ id, label, hypo, at, cost, transfers }) => ({ id, label, hypothesis: hypo, applies_at: at, cost, transfers: transfers ?? [] })) };
    },
  },
  {
    name: 'experiment_run',
    description: 'Paired Monte-Carlo on a surface: replay n times with and without the levers on matched seeds. Returns mean lift, a bootstrap 90% interval on that mean, the run-to-run spread, and a promote/keep/reject verdict.',
    inputSchema: { type: 'object', required: ['levers'], properties: { surface: surfaceArg, levers: leverArr, n: num('runs per arm (default 120)'), seed: num('base seed (default 5)') } },
    handler(a) {
      const sf = surf(a.surface);
      const x = E.runMonteCarlo({ surface: sf, levers: a.levers, n: a.n ?? 120, seed: a.seed ?? 5 });
      store.experiments.unshift({ ...x, at: new Date().toISOString() });
      return x;
    },
  },
  {
    name: 'experiment_list',
    description: 'Every experiment this workspace has run, across all surfaces, newest first.',
    inputSchema: { type: 'object', properties: { surface: surfaceArg } },
    handler: a => ({
      count: store.experiments.length,
      experiments: store.experiments.filter(x => !a.surface || x.surface === a.surface).slice(0, 25),
    }),
  },
  {
    name: 'skill_list',
    description: 'The skill library with evidence and armed state, optionally filtered to one surface.',
    inputSchema: { type: 'object', properties: { surface: surfaceArg } },
    handler: a => ({
      armed_levers: a.surface ? armedFor(a.surface) : undefined,
      skills: store.skills.filter(s => !a.surface || s.surface === a.surface),
    }),
  },
  {
    name: 'skill_promote',
    description: 'Promote a passing experiment into an armed skill. Refuses when the interval on the mean spans zero.',
    inputSchema: { type: 'object', required: ['levers'], properties: { surface: surfaceArg, levers: leverArr, n: num('runs per arm (default 120)') } },
    handler(a) {
      const sf = surf(a.surface);
      const x = E.runMonteCarlo({ surface: sf, levers: a.levers, n: a.n ?? 120, seed: 5 });
      if (!x.significant) return { promoted: false, reason: 'ROI interval spans zero', evidence: x.metrics.roi };
      const sk = E.skillFromExperiment(sf, x);
      store.skills = store.skills.filter(s => s.id !== sk.id);
      store.skills.unshift(sk);
      return { promoted: true, skill: sk };
    },
  },
  {
    name: 'skill_arm',
    description: 'Arm or disarm a skill for the next session on its surface.',
    inputSchema: { type: 'object', required: ['skill_id', 'armed'], properties: { skill_id: str('skill id'), armed: { type: 'boolean' } } },
    handler(a) {
      const s = store.skills.find(x => x.id === a.skill_id);
      if (!s) throw new Error('unknown skill ' + a.skill_id);
      s.armed = a.armed;
      return { skill_id: s.id, surface: s.surface, armed: s.armed, armed_levers: armedFor(s.surface) };
    },
  },
  {
    name: 'skill_transfer',
    description: 'Test a skill learned on one surface against another. Maps the source lever onto the target surface\'s nearest equivalent and runs the experiment there, so a tactic proven on a webinar can be tried on a checkout without re-deriving it.',
    inputSchema: { type: 'object', required: ['skill_id', 'to'], properties: { skill_id: str('skill to transfer'), to: surfaceArg, n: num('runs per arm (default 100)') } },
    handler(a) {
      const sk = store.skills.find(x => x.id === a.skill_id);
      if (!sk) throw new Error('unknown skill ' + a.skill_id);
      const target = surf(a.to);
      const src = surfaceById(sk.surface);
      const srcLever = src.levers.find(l => l.id === sk.action[0]);
      if (!srcLever?.transfers?.includes(target.id)) {
        return { transferable: false, reason: `${sk.action[0]} declares no transfer to ${target.id}`, declared: srcLever?.transfers ?? [] };
      }
      // The counterpart on the target surface is whichever lever transfers back.
      const match = target.levers.find(l => (l.transfers ?? []).includes(src.id)) ?? target.levers[0];
      const x = E.runMonteCarlo({ surface: target, levers: [match.id], n: a.n ?? 100, seed: 5 });
      return {
        transferable: true, from: src.id, to: target.id,
        source_skill: sk.name, target_lever: match.id, target_label: match.label,
        source_lift_pct: sk.evidence.roi_lift_pct, target_lift_pct: x.metrics.roi.lift_pct,
        ci90: x.metrics.roi.ci90, verdict: x.verdict,
      };
    },
  },
  {
    name: 'roi_report',
    description: 'Compounded effect of a surface\'s armed skill library versus baseline, with the marginal contribution of each skill.',
    inputSchema: { type: 'object', properties: { surface: surfaceArg, n: num('runs per arm (default 120)') } },
    handler(a) {
      const sf = surf(a.surface);
      const n = a.n ?? 120;
      const levers = armedFor(sf.id);
      if (!levers.length) return { surface: sf.id, armed: [], note: 'no skills armed on this surface' };
      // Same sample size for every step, and the final step *is* the headline,
      // so the marginals never disagree with the number reported above them.
      const steps = [];
      let full = null;
      for (let k = 1; k <= levers.length; k++) {
        const r = E.runMonteCarlo({ surface: sf, levers: levers.slice(0, k), n, seed: 5 });
        steps.push({ added: levers[k - 1], cumulative_roi_lift_pct: r.metrics.roi.lift_pct });
        if (k === levers.length) full = r;
      }
      return {
        surface: sf.id, n, armed_levers: levers,
        roi: full.metrics.roi, retention: full.metrics.retention,
        outcomes: full.metrics.outcomes, pipeline: full.metrics.pipeline,
        outcome_noun: sf.economics.outcomeNoun, marginal: steps,
        disclaimer: 'Simulated from the calibrated model in engine/. Not measured results from a live deployment.',
      };
    },
  },
  {
    name: 'roi_portfolio',
    description: 'Run roi_report across every surface at once — the whole programme, one number per surface.',
    inputSchema: { type: 'object', properties: { n: num('runs per arm (default 60)') } },
    handler(a) {
      const n = a.n ?? 60;
      const rows = SURFACE_LIST.map(sf => {
        const levers = armedFor(sf.id);
        if (!levers.length) return { surface: sf.id, armed: 0, note: 'no skills armed' };
        const r = E.runMonteCarlo({ surface: sf, levers, n, seed: 5 });
        return {
          surface: sf.id, label: sf.label, armed: levers.length,
          roi_lift_pct: r.metrics.roi.lift_pct, ci90: r.metrics.roi.ci90,
          retention_lift_pct: r.metrics.retention.lift_pct,
          outcome_lift_pct: r.metrics.outcomes.lift_pct,
          outcome_noun: sf.economics.outcomeNoun,
        };
      });
      return { n, surfaces: rows, disclaimer: 'Simulated. See engine/ for the model.' };
    },
  },
  {
    name: 'nudge_operator',
    description: 'Push a real AI-generated suggestion into the operator console. If an LLM API key is configured, generates the nudge text using real AI; otherwise uses rule-based fallback.',
    inputSchema: { type: 'object', properties: { surface: surfaceArg, text: str('custom nudge text (if omitted, AI generates one)'), urgency: { type: 'string', enum: ['low', 'medium', 'high'] }, context: str('extra context for the AI to consider') } },
    async handler(a) {
      const sf = surf(a.surface);
      const s = need(sf.id);
      let text = a.text;
      let source = 'manual';
      let model = null;

      // If no text provided, generate it with the real LLM
      if (!text) {
        const nudgeResult = await generateNudge({
          surface: sf.id,
          stage: s.stageId,
          stageLabel: s.stageId,
          focus: E.focusOf(s),
          retention: s.peak > 0 ? s.roster.filter(a => a.leftAt === null).length / s.peak : 1,
          concurrent: s.roster.filter(a => a.leftAt === null).length,
          peak: s.peak,
          dropCount: 0,
          topReason: a.context || 'operator request',
          availableLevers: s.levers.map(l => l.label || l.id),
          triggerType: 'custom',
        });
        text = nudgeResult.text;
        source = nudgeResult.source;
        model = nudgeResult.model;
      }

      const n = {
        id: 'nud_' + s.nudges.length,
        t: s.t,
        ts: E.fmtClock(sf, s.t),
        urgency: a.urgency ?? 'medium',
        text,
        stage: s.stageId,
        source,        // 'llm', 'rules', or 'manual'
        model,         // 'llama-3.3-70b', 'gpt-4o-mini', or null
        acted: false,
      };
      s.nudges.push(n);
      return n;
    },
  },
];

const byName = Object.fromEntries(TOOLS.map(t => [t.name, t]));

/* ──────────────────────────────── JSON-RPC ─────────────────────────────── */

function rpc(msg) {
  const { id, method, params } = msg;
  const ok = result => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'backstage', version: '0.2.0' },
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;                                   // notifications get no reply

    case 'ping':
      return ok({});

    case 'tools/list':
      return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });

    case 'tools/call': {
      const tool = byName[params?.name];
      if (!tool) return err(-32602, 'unknown tool: ' + params?.name);
      try {
        const out = tool.handler(params.arguments ?? {});
        return ok({ content: [{ type: 'text', text: JSON.stringify(out) }], isError: false });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }], isError: true });
      }
    }

    default:
      return err(-32601, 'method not found: ' + method);
  }
}

/* ──────────────────────────────── HTTP ─────────────────────────────────── */

/*
 * charset=utf-8 is not optional on any of these. Without it a browser guesses,
 * and on a page full of box-drawing characters and emoji it guesses wrong —
 * which is how this served a wall of mojibake while the file on disk was fine.
 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

const json = (res, code, obj) => {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host ?? 'localhost'));

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, mcp-session-id, mcp-protocol-version');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  // ── /meeting — Real WebRTC meeting room ──────────────────────────────
  if (url.pathname === '/meeting' || url.pathname === '/meeting/') {
    const file = path.join(ROOT, 'web/meeting-room.html');
    return fs.readFile(file, (e, data) => {
      if (e) return res.writeHead(404).end('meeting-room.html not found');
      res.writeHead(200, { 'content-type': MIME['.html'] }).end(data);
    });
  }

  // Socket.io's browser client is served by the package, while the meeting
  // transport itself uses the separate /meeting-socket path.
  if (url.pathname === '/socket.io/socket.io.js' && req.method === 'GET') {
    const file = path.join(ROOT, 'node_modules/socket.io/client-dist/socket.io.js');
    return fs.readFile(file, (e, data) => {
      if (e) return res.writeHead(404).end('socket.io client not found');
      res.writeHead(200, { 'content-type': 'text/javascript' }).end(data);
    });
  }

  // ── /api/chat — Real streaming LLM chat endpoint ─────────────────────
  // Used by the operator console AI widget. Streams tokens as SSE.
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    let body = '';
    for await (const c of req) body += c;
    let parsed;
    try { parsed = JSON.parse(body); } catch { return res.writeHead(400).end('bad json'); }

    const { messages, sessionContext } = parsed;
    const fullMessages = await buildChatMessages(messages || [], sessionContext || null);

    // Server-Sent Events for streaming
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    });
    res.write(': stream open\n\n');

    await streamChat(fullMessages, (token) => {
      if (token === null) {
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    });
    return;
  }

  // ── /api/meeting/create — Create a real meeting room ─────────────────
  if (url.pathname === '/api/meeting/create' && req.method === 'POST') {
    let body = '';
    for await (const c of req) body += c;
    let data = {};
    try { data = JSON.parse(body); } catch {}
    const credentials = createMeetingCredentials(data.hostName || 'Host', data.surface || 'webinar');
    createRoom(credentials.meetingId, credentials.password, credentials.host, credentials.surface);
    credentials.shareUrl = `/meeting?m=${encodeURIComponent(credentials.meetingId)}&p=${encodeURIComponent(credentials.password)}&n=${encodeURIComponent(credentials.host)}`;
    return json(res, 200, { ok: true, credentials });
  }

  // ── /api/meeting/list — List active real meeting rooms ────────────────
  if (url.pathname === '/api/meeting/list' && req.method === 'GET') {
    return json(res, 200, { rooms: listRooms() });
  }

  // ── /api/llm/status — Check if real AI is configured ─────────────────
  if (url.pathname === '/api/llm/status') {
    return json(res, 200, {
      configured: isLLMConfigured(),
      provider: process.env.LLM_PROVIDER || 'groq',
      model: isLLMConfigured() ? 'llama-3.3-70b-versatile' : null,
    });
  }

  if (url.pathname === '/mcp') {
    if (req.method === 'GET') {                       // streamable-HTTP notification channel
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': backstage stream open\n\n');
      const beat = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => clearInterval(beat));
      return;
    }
    if (req.method !== 'POST') return res.writeHead(405).end();

    let body = '';
    for await (const c of req) body += c;
    let msg;
    try { msg = JSON.parse(body); } catch {
      return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    }

    const batch = Array.isArray(msg) ? msg : [msg];
    const out = batch.map(rpc).filter(Boolean);
    if (!out.length) return res.writeHead(202).end();
    return json(res, 200, Array.isArray(msg) ? out : out[0]);
  }

  // Lingo demo archived — ui.js and tools.js were never committed (see archive/lingo/)
  if (url.pathname.startsWith('/lingo')) return res.writeHead(404).end('not found');

  let p = url.pathname === '/' ? '/web/index.html' : url.pathname;
  if (!p.startsWith('/web') && !p.startsWith('/engine') && !p.startsWith('/dist')) p = '/web' + p;
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();

  fs.readFile(file, (e, data) => {
    if (e) return res.writeHead(404, { 'content-type': 'text/plain' }).end('not found: ' + p);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  });
});

// ── Attach Socket.io meeting server to the same HTTP server ──────────────
// This is how your canvas repo does it — same process, same port.
attachMeetingServer(server);

server.listen(PORT, () => {
  const llmStatus = isLLMConfigured() ? '✓ real AI (' + (process.env.LLM_PROVIDER || 'groq') + ')' : '✗ no key (rule-based fallback)';
  console.log('');
  console.log('  Backstage — Real AI Edition');
  console.log('  console    http://localhost:' + PORT + '/');
  console.log('  meeting    http://localhost:' + PORT + '/meeting');
  console.log('  web mcp    http://localhost:' + PORT + '/mcp   (' + TOOLS.length + ' tools, protocol ' + PROTOCOL_VERSION + ')');
  console.log('  surfaces   ' + SURFACE_LIST.map(s => s.id).join(', '));
  console.log('  AI nudges  ' + llmStatus);
  console.log('');
  if (!isLLMConfigured()) {
    console.log('  ⚠  Add GROQ_API_KEY to .env to enable real AI nudges.');
    console.log('     Get a free key at https://console.groq.com');
    console.log('');
  }
});
