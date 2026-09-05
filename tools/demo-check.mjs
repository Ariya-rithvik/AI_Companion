/**
 * tools/demo-check.mjs — run the whole demo runbook the way a judge would.
 *
 * WHY THIS EXISTS
 * We shipped placeholder Razorpay keys for most of this project without noticing,
 * because every test we ran was a unit test that needed no credential. The gap was
 * not "a test failed" — it was "nothing ever ran the demo end to end in a clean
 * environment". This closes that.
 *
 * THE POINT OF THE SCRUB
 * Every step below runs with ALL 11 environment variables deleted from the child
 * process. If a step passes here, it passes on a laptop that has never seen this
 * repo's .env. That is the claim the README makes, so it is the claim that gets
 * tested. A step that only works because a key happened to be present is a step
 * that will fail on stage.
 *
 *   node tools/demo-check.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

/* Every variable any module reads. Deleted from the child env, not just blanked:
 * some code branches on `'X' in process.env` rather than truthiness. */
const ENV_VARS = [
  'GROQ_API_KEY', 'LLM_PROVIDER', 'OPENAI_API_KEY', 'PORT',
  'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET',
  'STUN_SERVER', 'TURN_CREDENTIAL', 'TURN_URL', 'TURN_USERNAME',
  'ZOOM_WEBHOOK_SECRET_TOKEN', 'SESSION_SECRET',
];

function scrubbed() {
  const e = { ...process.env };
  for (const k of ENV_VARS) delete e[k];
  return e;
}

function run(cmd, args, { timeout = 120000, env = scrubbed() } = {}) {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { env });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); resolve({ code: -1, out, err, timedOut: true }); }, timeout);
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => { clearTimeout(timer); resolve({ code, out, err, timedOut: false }); });
    p.on('error', e => { clearTimeout(timer); resolve({ code: -1, out, err: String(e), timedOut: false }); });
  });
}

const results = [];
let failed = 0;

/** A step passes when the process exits 0 AND every `expect` string is present. */
async function step(name, cmd, args, expect = [], opts = {}) {
  process.stdout.write('  ' + name.padEnd(46));
  const r = await run(cmd, args, opts);
  const missing = expect.filter(s => !(r.out + r.err).includes(s));
  const ok = r.code === 0 && !missing.length && !r.timedOut;
  if (!ok) failed++;
  console.log(ok ? 'PASS' : 'FAIL');
  if (!ok) {
    if (r.timedOut) console.log('        timed out');
    else if (r.code !== 0) console.log('        exit ' + r.code + '  ' + (r.err.split('\n')[0] || ''));
    for (const m of missing) console.log('        missing from output: ' + JSON.stringify(m));
  }
  results.push({ name, ok, out: r.out + r.err });
  return r;
}

console.log('');
console.log('  DEMO CHECK — every step with all ' + ENV_VARS.length + ' env vars deleted');
console.log('  ' + '-'.repeat(66));
console.log('');
console.log('  A. the runbook, no keys present');

await step('npm run recover', 'node', ['razorpay/recover.mjs'],
  ['DRY RUN', 'Policy engine (gated)', 'annoyed', 'claims dropped for unsupported numbers: 0']);

await step('calibration', 'node', ['razorpay/calibration.mjs'],
  ['WELL CALIBRATED']);

await step('npm test - policy  (25 properties)', 'node', ['razorpay/policy.test.mjs'],
  ['25 passed, 0 failed']);
await step('npm test - pacer   (17 properties)', 'node', ['razorpay/pacer.test.mjs'],
  ['17 passed, 0 failed']);

await step('npm run check', 'node', ['tools/graph.mjs', 'check'], ['0 error(s)']);
await step('npm run encoding', 'node', ['tools/encoding-sweep.mjs'], ['clean']);
await step('npm run bench', 'node', ['razorpay/bench.mjs'], ['THESIS HOLDS']);
await step('npm run build', 'node', ['tools/bundle.mjs'], []);

console.log('');
console.log('  B. the paths that touch a credential');

// --live with NO keys at all: rzp.mjs throws RazorpayConfigError at import.
// That must surface as a readable line, not an unhandled rejection stack.
const noKeys = await run('node', ['razorpay/recover.mjs', '--live']);
process.stdout.write('  ' + '--live, no keys at all'.padEnd(46));
{
  const t = noKeys.out + noKeys.err;
  const ok = t.includes('RAZORPAY_KEY_ID is not set');
  console.log(ok ? 'PASS' : 'FAIL');
  if (!ok) { failed++; console.log('        expected a named config error, got:\n' + t.slice(-400)); }
}

// --live with the placeholder keys from .env: must abort on preflight with the
// dashboard instructions, and must NOT attempt any payment link.
if (existsSync('.env')) {
  const withEnv = await run('node', ['--env-file=.env', 'razorpay/recover.mjs', '--live'], { env: process.env });
  process.stdout.write('  ' + '--live, placeholder keys -> clean abort'.padEnd(46));
  const t = withEnv.out + withEnv.err;
  const ok = t.includes('LIVE ABORTED') && t.includes('dashboard.razorpay.com') && !t.includes('   OK  ');
  console.log(ok ? 'PASS' : 'FAIL');
  if (!ok) { failed++; console.log('        got:\n' + t.slice(-400)); }
}

console.log('');
console.log('  C. the server and its endpoints');

const PORT = 8799;
const srv = spawn(process.execPath, ['server/mcp.mjs'],
  { env: { ...scrubbed(), PORT: String(PORT) }, shell: false });
let srvLog = '';
srv.stdout.on('data', d => srvLog += d);
srv.stderr.on('data', d => srvLog += d);

// Wait for the port to actually accept a connection rather than sleeping blind.
const base = 'http://127.0.0.1:' + PORT;
let up = false;
for (let i = 0; i < 60; i++) {
  try { await fetch(base + '/', { signal: AbortSignal.timeout(500) }); up = true; break; }
  catch { await new Promise(r => setTimeout(r, 250)); }
}

if (!up) {
  console.log('  server did not start                          FAIL');
  console.log(srvLog.slice(0, 600));
  failed++;
} else {
  const routes = [
    ['/', 'text/html', 'console'],
    ['/meeting', 'text/html', 'meeting room'],
    ['/app.js', 'javascript', 'console script'],
    ['/companion.js', 'javascript', 'companion overlay'],
  ];
  for (const [path, wantType, label] of routes) {
    process.stdout.write('  ' + ('GET ' + path + '  (' + label + ')').padEnd(46));
    try {
      const r = await fetch(base + path, { signal: AbortSignal.timeout(4000) });
      const ct = r.headers.get('content-type') ?? '';
      const body = await r.text();
      // charset matters: we shipped mojibake once by serving html with no charset
      const ok = r.ok && ct.includes(wantType) && ct.includes('utf-8') && body.length > 200;
      console.log(ok ? 'PASS' : 'FAIL');
      if (!ok) { failed++; console.log('        ' + r.status + '  ' + ct + '  ' + body.length + ' bytes'); }
    } catch (e) { failed++; console.log('FAIL\n        ' + e.message); }
  }

  // Web MCP: initialize + tools/list over JSON-RPC 2.0
  process.stdout.write('  ' + 'POST /mcp  initialize'.padEnd(46));
  let toolCount = 0;
  try {
    const r = await fetch(base + '/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'demo-check', version: '1' } } }),
      signal: AbortSignal.timeout(4000),
    });
    const j = await r.json();
    const ok = r.ok && j.result?.protocolVersion && j.jsonrpc === '2.0';
    console.log(ok ? 'PASS' : 'FAIL');
    if (!ok) { failed++; console.log('        ' + JSON.stringify(j).slice(0, 300)); }
  } catch (e) { failed++; console.log('FAIL\n        ' + e.message); }

  process.stdout.write('  ' + 'POST /mcp  tools/list'.padEnd(46));
  try {
    const r = await fetch(base + '/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      signal: AbortSignal.timeout(4000),
    });
    const j = await r.json();
    toolCount = j.result?.tools?.length ?? 0;
    const ok = r.ok && toolCount > 0 && j.result.tools.every(t => t.name && t.inputSchema);
    console.log(ok ? 'PASS  (' + toolCount + ' tools)' : 'FAIL');
    if (!ok) { failed++; console.log('        ' + JSON.stringify(j).slice(0, 300)); }
  } catch (e) { failed++; console.log('FAIL\n        ' + e.message); }

  // A malformed request must produce a JSON-RPC error object, not a crash.
  process.stdout.write('  ' + 'POST /mcp  bad method -> rpc error'.padEnd(46));
  try {
    const r = await fetch(base + '/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'no/such/method', params: {} }),
      signal: AbortSignal.timeout(4000),
    });
    const j = await r.json();
    const ok = j.error && typeof j.error.code === 'number';
    console.log(ok ? 'PASS' : 'FAIL');
    if (!ok) { failed++; console.log('        ' + JSON.stringify(j).slice(0, 200)); }
  } catch (e) { failed++; console.log('FAIL\n        ' + e.message); }

  process.stdout.write('  ' + 'GET /nope -> 404, server survives'.padEnd(46));
  try {
    const r = await fetch(base + '/nope', { signal: AbortSignal.timeout(4000) });
    const still = await fetch(base + '/', { signal: AbortSignal.timeout(4000) });
    const ok = r.status === 404 && still.ok;
    console.log(ok ? 'PASS' : 'FAIL');
    if (!ok) { failed++; console.log('        404 got ' + r.status + ', recheck ok=' + still.ok); }
  } catch (e) { failed++; console.log('FAIL\n        ' + e.message); }
}

srv.stdout.removeAllListeners('data');
srv.stderr.removeAllListeners('data');
srv.kill();
await new Promise(r => setTimeout(r, 300));

console.log('');
console.log('  ' + '-'.repeat(66));
if (failed === 0) {
  console.log('  ALL STEPS PASS WITH ZERO API KEYS.');
  console.log('  The demo needs no credential. Nothing on the runbook touches the network.');
} else {
  console.log('  ' + failed + ' STEP(S) FAILED — do not record until these are green.');
}
console.log('');
process.exit(failed ? 1 : 0);
