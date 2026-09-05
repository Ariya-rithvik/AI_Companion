/**
 * Repair double-encoded UTF-8 (mojibake) in place, and strip any BOM.
 *
 *   node tools/fix-encoding.mjs <file> [--write]
 *
 * Without --write it only reports. Nothing is modified until the repair has been
 * shown to produce valid text, because a bad "fix" here destroys the file for
 * good — the failure mode is silent and irreversible.
 *
 * How the corruption happens: read a UTF-8 file as if it were Latin-1, then save
 * it as UTF-8. Every original byte becomes its own character and is re-encoded,
 * so "🎙" (F0 9F 8E 99) becomes "ðŸŽ™". The reversal is the same trip backwards:
 * decode UTF-8, re-encode as Latin-1, decode UTF-8 again.
 */

import fs from 'node:fs';

const file = process.argv[2];
const write = process.argv.includes('--write');
if (!file) { console.error('usage: node tools/fix-encoding.mjs <file> [--write]'); process.exit(1); }

const raw = fs.readFileSync(file);
const hadBOM = raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF;
const body = hadBOM ? raw.subarray(3) : raw;

/*
 * The mis-decode is almost always Windows-1252, not Latin-1 — that is the
 * default on Windows, and it is what PowerShell's Get-Content uses. The two
 * agree everywhere except 0x80-0x9F, where CP1252 maps to typographic
 * characters (0x94 -> U+201D "). Reversing with latin1 truncates U+201D to
 * 0x1D and silently destroys every box-drawing character and emoji in the file.
 * That exact mistake is why the first attempt at this repair was refused.
 */
const CP1252_HIGH = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
  0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8A: 'Š',
  0x8B: '‹', 0x8C: 'Œ', 0x8E: 'Ž', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›', 0x9C: 'œ',
  0x9E: 'ž', 0x9F: 'Ÿ',
};
const TO_BYTE = new Map(Object.entries(CP1252_HIGH).map(([b, ch]) => [ch, Number(b)]));

/** Encode a string back to the CP1252 bytes it was mis-decoded from. */
function encodeCp1252(str) {
  const out = Buffer.alloc(str.length);
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = ch.codePointAt(0);
    if (code <= 0xFF) out[i] = code;
    else if (TO_BYTE.has(ch)) out[i] = TO_BYTE.get(ch);
    else return null;                      // not reversible — bail rather than mangle
  }
  return out;
}

const once = body.toString('utf8');
const reversed = encodeCp1252(once);
const repaired = reversed ? reversed.toString('utf8') : once;

const MOJI = /[ÃÂð][-ÿ]|â€|â”|ðŸ/;
const looksBroken = MOJI.test(once);
const repairedIsClean = !MOJI.test(repaired) && !repaired.includes('�');

console.log('');
console.log('  file            ' + file);
console.log('  bytes           ' + raw.length + (hadBOM ? '  (BOM present)' : ''));
console.log('  mojibake now    ' + looksBroken);
console.log('  repair is clean ' + repairedIsClean);

if (!looksBroken) {
  console.log('\n  nothing to do — file is already valid UTF-8.\n');
  process.exit(0);
}
if (!reversed) {
  console.error('\n  REFUSING: the text contains characters that are not reachable through a'
    + '\n  CP1252 mis-decode, so this is not the corruption this tool reverses.\n');
  process.exit(1);
}
if (!repairedIsClean) {
  console.error('\n  REFUSING: the repair did not produce clean text. The corruption is not a'
    + '\n  simple double-encode, or it has been applied more than once. Restore from git'
    + '\n  instead of guessing.\n');
  process.exit(1);
}

// Show the caller what actually changes, before anything is written.
const sample = [...repaired.matchAll(/[\u{1F000}-\u{1FAFF}─-◿]/gu)].slice(0, 12).map(m => m[0]);
console.log('  recovered chars ' + (sample.join(' ') || '(none found)'));

if (!write) {
  console.log('\n  dry run. Re-run with --write to apply.\n');
  process.exit(0);
}

fs.copyFileSync(file, file + '.bak');
fs.writeFileSync(file, Buffer.from(repaired, 'utf8'));   // no BOM
console.log('\n  written. Backup at ' + file + '.bak\n');
