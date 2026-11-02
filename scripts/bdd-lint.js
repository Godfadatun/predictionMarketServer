#!/usr/bin/env node
/**
 * bdd-lint.js — enforces SKILL.md → Decisions → File rules on a BDD file.
 * Usage: node files/bdd-lint.js <path/to/feature.bdd.spec.ts>
 * Exit 1 on any violation. Wire into CI before jest.
 */
const fs = require('fs');
const file = process.argv[2];
if (!file) { console.error('usage: bdd-lint.js <spec file>'); process.exit(2); }
const src = fs.readFileSync(file, 'utf8');
const errors = [];

const bad = [/\b(it|describe|test)\.only\(/, /\b(it|describe|test)\.skip\(/, /\bxit\(/, /\bxdescribe\(/, /\bxtest\(/];
bad.forEach(re => { if (re.test(src)) errors.push(`forbidden: ${re}`); });

// split into it-blocks (rough but effective: from `it(` to the next `it(`/`describe(`/EOF)
const blocks = src.split(/\n\s*it\(/).slice(1);
const itCount = blocks.length;
blocks.forEach((b, i) => {
  const name = (b.match(/^['"`]([^'"`]+)/) || [,'?'])[1].slice(0, 60);
  if (/\bif\s*\(|\?\s*[^:]+:\s|\bswitch\s*\(|\btry\s*\{/.test(b)) errors.push(`conditional in it #${i + 1} "${name}"`);
  if (!/\bdb\.|\bfindOne\(|\bcount\(|\bfindMany\(|\brepository\.|\bprisma\.|\bModel\./.test(b)) errors.push(`no DB-state assertion in it #${i + 1} "${name}"`);
  if (/\.toBeDefined\(\)|\.toBeTruthy\(\)|\.toBeTruthy\b/.test(b)) errors.push(`loose assertion (toBeDefined/toBeTruthy) in it #${i + 1} "${name}"`);
  if (/jest\.mock\(['"][^'"]*(service|repository|guard|controller)/i.test(b)) errors.push(`mocks the thing under test in it #${i + 1}`);
});

// case-table sync
const rows = (src.match(/^\s*\*\s*\|\s*([A-Z]+-?[A-Z]*\d+)\s*\|/gm) || []).length;
if (rows && rows !== itCount) errors.push(`case table has ${rows} rows but file has ${itCount} it() blocks`);

// mandatory red classes
const need = { validation: /R-V\d/, guard: /R-G\d/, middleware: /R-M\d/, 'third-party': /R-T\d/, concurrency: /R-C\d/, 'data-state': /R-S\d/ };
Object.entries(need).forEach(([k, re]) => { if (!re.test(src)) errors.push(`missing mandatory red class: ${k}`); });

// describe classes
['Happy', 'Amber', 'Red'].forEach(c => { if (!new RegExp(`describe\\([^)]*${c}`).test(src)) errors.push(`missing describe for ${c} paths`); });

if (errors.length) { console.error(`bdd-lint: ${errors.length} violation(s)\n - ` + errors.join('\n - ')); process.exit(1); }
console.log(`bdd-lint: OK — ${itCount} cases, ${rows} table rows`);
