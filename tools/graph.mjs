/**
 * Code knowledge graph.
 *
 *   node tools/graph.mjs              the graph, grouped by layer
 *   node tools/graph.mjs impact <f>   what breaks if you change <f>
 *   node tools/graph.mjs check        the invariants that have actually bitten us
 *   node tools/graph.mjs mermaid      a diagram for the docs
 *
 * WHY THIS EXISTS
 * Three real bugs in this repo were all the same shape: a change in one file
 * silently broke another file that no test covered.
 *
 *   1. memory.mjs was added and app.js imported it, but tools/bundle.mjs did not
 *      inline it — the standalone build shipped with `M` undefined.
 *   2. companion.js and app.js both declared `esc`. Flattened into one script by
 *      the bundler, that is a duplicate declaration and the whole page dies.
 *   3. app.js imported `mountCompanion`, which nothing inlined exported.
 *
 * `check` encodes exactly those three as hard invariants, so the class of bug
 * cannot come back quietly. It is a build gate, not a diagram generator — the
 * diagram is a side effect.
 *
 * Regex-based on purpose: no dependencies, and this repo's module syntax is
 * plain. It reports what it cannot parse rather than guessing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['engine', 'web', 'server', 'tools', 'razorpay', 'integrations'];
const SKIP = /node_modules|[\\/]dist[\\/]|backstage-live/;

const rel = p => path.relative(ROOT, p).replace(/\\/g, '/');
const LAYER = f => f.split('/')[0];

/* ─────────────────────────────── scan ─────────────────────────────── */

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

/* ────────────────────────────── parse ────────────────────────────── */

/*
 * Static imports are anchored to the start of a line. Without that anchor the
 * parser matches `import ... from '...'` written INSIDE a regex literal — which
 * is exactly what tools/bundle.mjs contains, since it greps app.js for imports.
 * The first run of this tool reported that as a missing module. A graph that
 * cries wolf is worse than no graph, so: line-anchored only.
 */
const RE = {
  named: /^\s*import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm,
  ns: /^\s*import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/gm,
  def: /^\s*import\s+(\w+)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"]([^'"]+)['"]/gm,
  bare: /^\s*import\s*['"]([^'"]+)['"]/gm,
  exportDecl: /^export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm,
  exportList: /^export\s*\{([^}]*)\}/gm,
  topLevel: /^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm,
  htmlScript: /<script[^>]*\ssrc=["']([^"']+)["']/g,
  htmlLink: /<link[^>]*\shref=["']([^"']+)["']/g,
};

/**
 * @param html  HTML src/href are URLs, never bare specifiers, so `src="x.js"`
 *   IS relative. Treating it like an ESM bare specifier made this tool silently
 *   skip every plain <script src> edge — which hid a page loading a file that
 *   does not exist. JS bare specifiers really are external, so they still skip.
 */
function resolve(fromFile, spec, html = false) {
  if (/^(https?:)?\/\//.test(spec) || spec.startsWith('data:')) return null;   // remote
  if (!html && !spec.startsWith('.')) return null;                             // bare specifier
  if (html && spec.startsWith('/')) return null;                               // server-mounted
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const c of [base, base + '.mjs', base + '.js', path.join(base, 'index.mjs')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return rel(c);
  }
  return { missing: spec };
}

function parse(file) {
  const src = fs.readFileSync(file, 'utf8');
  const f = rel(file);
  const m = {
    file: f, layer: LAYER(f), html: f.endsWith('.html'),
    imports: [], exports: new Set(), topLevel: new Set(), loc: src.split('\n').length,
  };

  if (m.html) {
    for (const [, spec] of src.matchAll(RE.htmlScript)) {
      const r = resolve(file, spec, true);
      if (r) m.imports.push({ to: r, names: [], kind: 'script' });
    }
    for (const [, spec] of src.matchAll(RE.htmlLink)) {
      const r = resolve(file, spec, true);
      if (r) m.imports.push({ to: r, names: [], kind: 'style' });
    }
    return m;
  }

  for (const [, names, spec] of src.matchAll(RE.named)) {
    const r = resolve(file, spec);
    if (r) m.imports.push({
      to: r, kind: 'named',
      names: names.split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean),
    });
  }
  for (const [, alias, spec] of src.matchAll(RE.ns)) {
    const r = resolve(file, spec);
    if (r) m.imports.push({ to: r, kind: 'namespace', alias, names: [] });
  }
  for (const [, alias, spec] of src.matchAll(RE.def)) {
    if (/import\s*\*/.test(alias)) continue;
    const r = resolve(file, spec);
    if (r) m.imports.push({ to: r, kind: 'default', alias, names: ['default'] });
  }
  for (const [, spec] of src.matchAll(RE.bare)) {
    const r = resolve(file, spec);
    if (r) m.imports.push({ to: r, kind: 'side-effect', names: [] });
  }

  for (const [, n] of src.matchAll(RE.exportDecl)) m.exports.add(n);
  for (const [, list] of src.matchAll(RE.exportList)) {
    for (const n of list.split(',')) {
      const t = n.trim().split(/\s+as\s+/);
      if (t[0]) m.exports.add((t[1] ?? t[0]).trim());
    }
  }
  for (const [, n] of src.matchAll(RE.topLevel)) m.topLevel.add(n);
  return m;
}

const files = SCAN.filter(d => fs.existsSync(path.join(ROOT, d)))
  .flatMap(d => walk(path.join(ROOT, d)));
const G = new Map(files.map(f => [rel(f), parse(f)]));

/* ────────────────────────── graph queries ────────────────────────── */

const dependents = f => [...G.values()]
  .filter(m => m.imports.some(i => i.to === f))
  .map(m => m.file);

/** Everything that transitively depends on `f`, breadth-first. */
function impact(f) {
  const seen = new Set([f]);
  const out = [];
  let layer = [f];
  let depth = 0;
  while (layer.length && depth++ < 12) {
    const next = [];
    for (const cur of layer) {
      for (const d of dependents(cur)) {
        if (seen.has(d)) continue;
        seen.add(d);
        next.push(d);
        out.push({ file: d, depth, via: cur });
      }
    }
    layer = next;
  }
  return out;
}

/* ──────────────────────────── invariants ─────────────────────────── */

/** Modules the bundler flattens into one script. Parsed from bundle.mjs itself. */
function bundledList() {
  const p = path.join(ROOT, 'tools/bundle.mjs');
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, 'utf8');
  const m = src.match(/const engine = \[([\s\S]*?)\];/);
  if (!m) return null;
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
}

/** Everything web/app.js pulls in, transitively. */
function appClosure() {
  const seen = new Set();
  const stack = ['web/app.js'];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !G.has(f)) continue;
    seen.add(f);
    for (const i of G.get(f).imports) if (typeof i.to === 'string') stack.push(i.to);
  }
  seen.delete('web/app.js');
  return [...seen];
}

/*
 * Known, accepted gaps. A check that is permanently red teaches people to ignore
 * it, so debt gets declared here WITH A REASON rather than silently tolerated.
 * Anything not on this list is a hard failure.
 */
const KNOWN = [
  // web/lingo/ archived — moved to archive/lingo/ (ui.js/tools.js were never committed)
];
const known = f => KNOWN.find(k => k.match.test(f));

function check() {
  const errors = [];
  const warns = [];
  const gaps = [];

  // 1. every import resolves to a file that exists
  for (const m of G.values()) {
    for (const i of m.imports) {
      if (i.to && typeof i.to === 'object' && i.to.missing) {
        const k = known(m.file);
        const msg = `${m.file} imports "${i.to.missing}" — no such file`;
        if (k) gaps.push(msg + '\n           ' + k.why); else errors.push(msg);
      }
    }
  }

  // 2. every named import is actually exported by its target
  for (const m of G.values()) {
    for (const i of m.imports) {
      if (typeof i.to !== 'string' || !G.has(i.to)) continue;
      const target = G.get(i.to);
      if (target.html) continue;
      for (const n of i.names) {
        if (n === 'default') continue;
        if (!target.exports.has(n)) {
          errors.push(`${m.file} imports { ${n} } from ${i.to}, which does not export it`);
        }
      }
    }
  }

  // 3. the bundler must inline everything app.js depends on  [bug #1 and #3]
  const bundled = bundledList();
  if (!bundled) {
    warns.push('could not read the `engine` list out of tools/bundle.mjs — bundle checks skipped');
  } else {
    for (const dep of appClosure()) {
      if (!bundled.includes(dep)) {
        errors.push(`web/app.js depends on ${dep}, but tools/bundle.mjs does not inline it `
          + '— the standalone build will break at runtime');
      }
    }
  }

  // 4. bundled modules share one scope, so a name declared twice is fatal  [bug #2]
  if (bundled) {
    const owner = new Map();
    const inBundle = [...bundled, 'web/app.js'];
    for (const f of inBundle) {
      if (!G.has(f)) continue;
      for (const n of G.get(f).topLevel) {
        if (owner.has(n)) {
          errors.push(`duplicate top-level name "${n}" in ${f} and ${owner.get(n)} `
            + '— these are flattened into one scope by the bundler');
        } else owner.set(n, f);
      }
    }
  }

  // 5. informational: modules nothing references
  for (const m of G.values()) {
    if (m.html || m.layer === 'tools') continue;
    if (!dependents(m.file).length && !/bench|graph|calibrate|seedskills/.test(m.file)) {
      warns.push(`${m.file} is imported by nothing`);
    }
  }

  return { errors, warns, gaps };
}

/* ─────────────────────────────── output ─────────────────────────────── */

const arg = process.argv[2];
const bar = '─'.repeat(74);

if (arg === 'check') {
  const { errors, warns, gaps } = check();
  console.log('');
  for (const g of gaps) console.log('  known  ' + g);
  for (const w of warns) console.log('  warn   ' + w);
  for (const e of errors) console.log('  ERROR  ' + e);
  console.log('');
  console.log(`  ${errors.length} error(s), ${warns.length} warning(s), ${gaps.length} known gap(s)`
    + ` across ${G.size} modules`);
  console.log('');
  process.exit(errors.length ? 1 : 0);
}

if (arg === 'impact') {
  const target = (process.argv[3] || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!G.has(target)) {
    console.error(`\n  unknown module "${target}". Known:\n` +
      [...G.keys()].map(k => '   ' + k).join('\n') + '\n');
    process.exit(1);
  }
  const hits = impact(target);
  console.log('');
  console.log('  CHANGING  ' + target);
  console.log('  ' + bar);
  if (!hits.length) console.log('  nothing else imports it.');
  for (const h of hits) {
    console.log('  ' + '  '.repeat(h.depth - 1) + '└─ ' + h.file + '   (via ' + h.via + ')');
  }
  const entries = hits.map(h => h.file)
    .filter(f => /app\.js|index\.html|mcp\.mjs|bundle\.mjs|meeting-room\.html/.test(f));
  if (entries.length) {
    console.log('');
    console.log('  RE-TEST   ' + [...new Set(entries)].join(', '));
  }
  const bundled = bundledList();
  if (bundled?.includes(target)) {
    console.log('  ALSO      this file is flattened into dist/ — run `node tools/bundle.mjs` after');
  }
  console.log('');
  process.exit(0);
}

if (arg === 'mermaid') {
  const id = f => f.replace(/[^\w]/g, '_');
  console.log('```mermaid\nflowchart LR');
  const byLayer = {};
  for (const m of G.values()) (byLayer[m.layer] ??= []).push(m);
  for (const [layer, ms] of Object.entries(byLayer)) {
    console.log(`  subgraph ${layer}`);
    for (const m of ms) console.log(`    ${id(m.file)}["${path.basename(m.file)}"]`);
    console.log('  end');
  }
  for (const m of G.values()) {
    for (const i of m.imports) {
      if (typeof i.to === 'string' && G.has(i.to)) console.log(`  ${id(m.file)} --> ${id(i.to)}`);
    }
  }
  console.log('```');
  process.exit(0);
}

/* default: the graph */
console.log('');
console.log('  CODE KNOWLEDGE GRAPH — ' + G.size + ' modules');
console.log('  ' + bar);
const layers = [...new Set([...G.values()].map(m => m.layer))].sort();
for (const layer of layers) {
  console.log('');
  console.log('  ' + layer.toUpperCase());
  for (const m of [...G.values()].filter(x => x.layer === layer).sort((a, b) => a.file.localeCompare(b.file))) {
    const deps = m.imports.filter(i => typeof i.to === 'string').map(i => path.basename(i.to));
    const used = dependents(m.file).length;
    console.log('    ' + m.file.padEnd(30) + String(m.loc).padStart(5) + ' loc'
      + '  ←' + String(used).padStart(2) + '  ' + (deps.length ? '→ ' + deps.join(' ') : ''));
  }
}
const { errors, warns } = check();
console.log('');
console.log('  ' + bar);
console.log('  invariants: ' + (errors.length ? errors.length + ' ERROR(S)' : 'all pass')
  + (warns.length ? ', ' + warns.length + ' warning(s)' : '') + '   — run `graph.mjs check` for detail');
console.log('');
