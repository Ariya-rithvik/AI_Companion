/**
 * Sweep the repo for double-encoded (mojibake) source files and repair them.
 *
 *   node tools/encoding-sweep.mjs           report only  (exit 1 if anything found)
 *   node tools/encoding-sweep.mjs --write   repair in place
 *
 * Worth having as a standing check: this repo has been corrupted three times,
 * every time by an editor or shell reading UTF-8 as Windows-1252 and saving it
 * back. It is silent — the file still parses, it just renders as garbage — so
 * nothing else catches it.
 *
 * NOTE: every high character below is written as a \u escape on purpose. An
 * earlier version of this file used the literal characters and promptly got
 * mangled by the very problem it detects.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');

// The encoding tools hold mojibake characters as DATA (the CP1252 map, the
// detector itself), so scanning them would flag them forever.
const SKIP = /node_modules|[\\/]dist[\\/]|[\\/]\.git[\\/]|tools[\\/](fix-encoding|encoding-sweep)\.mjs/;
const EXT = /\.(mjs|js|md|html|css|json)$/;

/*
 * Mojibake signature: a Latin-1 lead character followed by whatever the NEXT
 * UTF-8 byte decoded to under CP1252.
 *
 * The obvious /[Ãâð][-ÿ]/ misses the most common
 * cases, because CP1252 maps 0x80-0x9F to typographic characters ABOVE U+00FF.
 * So "â€”" (an em dash) and "â”€" (a box-drawing
 * line) both slip through — and those two are exactly what kept corrupting this
 * repo. Including the CP1252 specials is what makes the detector actually work.
 */
const CP1252_SPECIALS =
  '€‚ƒ„…†‡ˆ‰Š‹ŒŽ'
  + '‘’“”•–—˜™š›œžŸ';
const MOJI = new RegExp('[ÂÃâð][-ÿ' + CP1252_SPECIALS + ']');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

// Docs that QUOTE mojibake to explain the bug are not corrupted. They opt out
// with this marker rather than the detector being loosened to accommodate them.
const IGNORE = 'encoding-sweep:ignore';

const hits = [];
for (const f of walk(ROOT)) {
  const buf = fs.readFileSync(f);
  const s = buf.toString('utf8');
  if (s.includes(IGNORE)) continue;
  const bom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  const moji = MOJI.test(s);
  if (moji || bom) hits.push({ f, rel: path.relative(ROOT, f), moji, bom });
}

console.log('');
if (!hits.length) {
  console.log('  clean - no mojibake, no BOM\n');
  process.exit(0);
}

let repaired = 0;
let refused = 0;

for (const h of hits) {
  console.log(`  ${h.rel}${h.moji ? '  mojibake' : ''}${h.bom ? '  BOM' : ''}`);
  if (!write) continue;

  // A BOM with no mojibake needs no decode round-trip - just drop the 3 bytes.
  if (!h.moji && h.bom) {
    const buf = fs.readFileSync(h.f);
    fs.writeFileSync(h.f, buf.subarray(3));
    console.log('     BOM stripped');
    repaired++;
    continue;
  }

  try {
    execFileSync(process.execPath, [path.join(ROOT, 'tools/fix-encoding.mjs'), h.f, '--write'],
      { stdio: 'pipe' });
    fs.rmSync(h.f + '.bak', { force: true });
    const after = fs.readFileSync(h.f, 'utf8');
    if (MOJI.test(after)) { console.log('     STILL BAD - inspect manually'); refused++; }
    else { console.log('     repaired'); repaired++; }
  } catch (e) {
    // fix-encoding refuses rather than guessing; that refusal is the useful signal
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
    const why = out.match(/REFUSING:.*/)?.[0] ?? 'see tools/fix-encoding.mjs';
    console.log('     REFUSED - ' + why);
    refused++;
  }
}

console.log('');
console.log(`  ${hits.length} flagged` + (write ? `, ${repaired} repaired, ${refused} refused` : ' - re-run with --write'));
console.log('');
process.exit(write && refused === 0 ? 0 : 1);
