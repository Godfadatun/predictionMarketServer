#!/usr/bin/env node
/**
 * layout-lint.js — enforces SKILL.md → Decisions on one feature module.
 * Usage: node files/layout-lint.js src/<feature>
 * Exit 1 on any violation. Wire into CI before jest.
 */
const fs = require('fs'); const path = require('path');
const root = process.argv[2];
if (!root || !fs.existsSync(root)) { console.error('usage: layout-lint.js src/<feature>'); process.exit(2); }
const errors = [];
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(root).filter(f => /\.(ts|js)$/.test(f));
const rel = f => path.relative(root, f);
const inDir = (f, d) => rel(f).split(path.sep)[0] === d;

for (const f of files) {
  const r = rel(f); const src = fs.readFileSync(f, 'utf8'); const lines = src.split('\n');

  // tests only under tests/
  if (/\.(spec|test)\.(ts|js)$/.test(r) && !inDir(f, 'tests')) errors.push(`${r}: test file outside tests/`);

  // mocks only under integrations/<p>/mocks/ or services/mocks/
  if (/mock/i.test(path.basename(r)) || /\/mocks\//.test('/' + r.replace(/\\/g, '/'))) {
    const ok = /^integrations\/[^/]+\/mocks\//.test(r.replace(/\\/g, '/')) || /^services\/mocks\//.test(r.replace(/\\/g, '/'));
    if (!ok) errors.push(`${r}: mock file outside integrations/<provider>/mocks/ or services/mocks/`);
    else if (!/export\s+class\s+/.test(src)) errors.push(`${r}: mock must export a class of fixtures`);
  }

  // Model / entity access only in repositories/
  if (!inDir(f, 'repositories') && /@InjectModel\(|from ['"]mongoose['"]|Repository<|@InjectRepository\(|PrismaClient|\.prisma\./.test(src))
    errors.push(`${r}: Model/entity/query access outside repositories/`);

  // controller must not touch repos or business logic (controller lives at the feature root)
  if (/\.controller\.(ts|js)$/.test(r)) {
    if (r.includes(path.sep)) errors.push(`${r}: controller must sit at the feature root`);
    if (/repositor(y|ies)/i.test(src)) errors.push(`${r}: controller references a repository`);
    if (/\n\s+if\s*\(/.test(src)) errors.push(`${r}: controller contains an if — move to guard/pipe/service`);
  }

  // feature client must use the shared connection
  if (/^integrations\/[^/]+\/client\.(ts|js)$/.test(r.replace(/\\/g, '/')) && /axios\.create\(|new HttpService\(|\bfetch\(/.test(src))
    errors.push(`${r}: creates its own HTTP connection — import the app-level connection manager`);

  // generic throws
  lines.forEach((l, i) => { if (/throw new Error\(/.test(l)) errors.push(`${r}:${i + 1}: throw new Error — use a specific error class`); });

  // service returns via wrappers; joi checks as ifs
  if (inDir(f, 'services') && !/\/mocks\//.test('/' + r.replace(/\\/g, '/'))) {
    const returns = (src.match(/\breturn\s+(?!SuccessResponse|errorResponse|this\.|await\s+this\.)/g) || []).length;
    if (returns) errors.push(`${r}: ${returns} return(s) not wrapped in SuccessResponse/errorResponse`);
    lines.forEach((l, i) => { if (/if\s*\(\s*!?\s*(input|body|dto|payload|data)\.\w+\s*[)!=<>]/.test(l)) errors.push(`${r}:${i + 1}: input check as if — belongs in a Joi schema`); });
    lines.forEach((l, i) => { if (/(===|!==)\s*['"][A-Z_]{3,}['"]/.test(l)) errors.push(`${r}:${i + 1}: hard-coded code/status literal — use constants/`); });
  }

  // comments: <=4 consecutive lines above a function; inline (own line, inside a body) max 1 consecutive line
  let run = 0, depth = 0;
  lines.forEach((l, i) => {
    const t = l.trim(); const isComment = /^(\/\/|\/\*|\*)/.test(t);
    run = isComment ? run + 1 : 0;
    if (isComment && run === 2 && depth > 0) errors.push(`${r}:${i + 1}: inline comment longer than 1 line`);
    if (isComment && run === 5) errors.push(`${r}:${i + 1}: comment block longer than 4 lines`);
    if (!isComment) { depth += (t.match(/{/g) || []).length - (t.match(/}/g) || []).length; }
  });
}

// no folders outside the allowed tree
const ALLOWED = ['services', 'repositories', 'dto', 'interfaces', 'constants', 'sanitizers', 'integrations', 'tests', 'docs'];
for (const d of fs.readdirSync(root, { withFileTypes: true })) {
  if (d.isDirectory() && !ALLOWED.includes(d.name)) errors.push(`${d.name}/: folder not allowed in a feature — extend the app-level file instead`);
}
for (const sub of ['repositories', 'dto', 'interfaces', 'constants', 'sanitizers', 'tests'])
  if (fs.existsSync(path.join(root, sub))) for (const d of fs.readdirSync(path.join(root, sub), { withFileTypes: true }))
    if (d.isDirectory()) errors.push(`${sub}/${d.name}/: no sub-folders allowed under ${sub}/`);
if (!files.some(f => /\.controller\.(ts|js)$/.test(rel(f)) && !rel(f).includes(path.sep)) && !files.some(f => /\.consumer\.|\.cron\./.test(rel(f))))
  errors.push(`no <feature>.controller.ts at the feature root`);
if (!files.some(f => /\.module\.(ts|js)$/.test(rel(f)) && !rel(f).includes(path.sep))) errors.push(`no <feature>.module.ts at the feature root`);

// integrations completeness
const integ = path.join(root, 'integrations');
if (fs.existsSync(integ)) for (const p of fs.readdirSync(integ)) {
  const d = path.join(integ, p); if (!fs.statSync(d).isDirectory()) continue;
  for (const need of ['client.ts', 'index.ts']) if (!fs.existsSync(path.join(d, need))) errors.push(`integrations/${p}: missing ${need}`);
  const mocks = path.join(d, 'mocks'); if (!fs.existsSync(mocks) || !fs.readdirSync(mocks).length) errors.push(`integrations/${p}: no mocks/<version>.ts`);
}

if (errors.length) { console.error(`layout-lint: ${errors.length} violation(s)\n - ` + errors.join('\n - ')); process.exit(1); }
console.log(`layout-lint: OK — ${files.length} files in ${root}`);
