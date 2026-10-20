// doctor (a project's health), lint-kit (the kit's own tree), upgrade (vendored kit, with provenance).
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, isAbsolute, relative } from 'node:path';
import * as G from './git.mjs';
import * as V from './version.mjs';
import { readState, start, close } from './session.mjs';
import { loadPatterns, fileHash } from './patterns.mjs';
import { scanText } from './secrets.mjs';
import { VENDORED, vendorKit } from './scaffold.mjs';

export const BUDGET = { 'ENTRY.md': 1600, 'RELAY.md': 1200 };
const MIN_GIT = [2, 22]; // %(trailers:only,unfold) — INFERRED from git release notes, not tested on old gits

export function doctor(root) {
  const out = []; const add = (level, msg) => out.push({ level, msg });
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 18) add('fail', `node ${process.versions.node} < 18`);
  const gv = (G.git(['version']).match(/(\d+)\.(\d+)/) || []).slice(1).map(Number);
  if (gv[0] < MIN_GIT[0] || (gv[0] === MIN_GIT[0] && gv[1] < MIN_GIT[1])) add('fail', `git ${gv.join('.')} < ${MIN_GIT.join('.')}`);
  // worktree pointers are absolute paths: a worktree made in WSL is not usable from Windows git and vice versa
  const dotgit = join(root, '.git');
  if (existsSync(dotgit) && statSync(dotgit).isFile()) {
    const p = readFileSync(dotgit, 'utf8').match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
    if (!p || !existsSync(isAbsolute(p) ? p : join(root, p))) add('fail', `.git points to ${p}, which does not exist here — worktree created on another OS/mount? Recreate it from this OS (git worktree add)`);
    else if (/^\/mnt\/[a-z]\//.test(p) || /^[A-Za-z]:[\\/]/.test(p)) add('warn', `.git points to ${p}: usable only from the OS that created it (WSL vs Windows)`);
  }
  const kitDir = join(root, '.tins', 'kit');
  if (!existsSync(kitDir)) add('fail', 'no vendored kit at .tins/kit');
  else {
    const v = V.verify(kitDir, { allowMissing: true });
    for (const p of v.problems) add('fail', `vendored kit: ${p}`);
    const cfg = existsSync(join(root, 'tins.json')) ? JSON.parse(readFileSync(join(root, 'tins.json'), 'utf8')) : {};
    if (cfg.kit && v.stamp && cfg.kit !== v.stamp) add('warn', `tins.json says kit ${cfg.kit}, vendored copy is ${v.stamp}`);
  }
  const s = readState(root);
  if (s) add(Date.now() - Date.parse(s.started) > 864e5 ? 'warn' : 'info', `open session ${s.id} since ${s.started} (resume with kit run/close, or kit abort)`);
  const lockP = join(root, '.tins', 'patterns.lock');
  if (existsSync(lockP)) {
    const lock = JSON.parse(readFileSync(lockP, 'utf8')); const pats = existsSync(kitDir) ? loadPatterns(join(kitDir, 'patterns')) : [];
    for (const [id, l] of Object.entries(lock)) {
      for (const f of l.files) { const name = f.split('/').pop(); if (existsSync(join(root, f)) && fileHash(join(root, f)) !== l.hash[name]) add('info', `${f} differs from the pinned ${id} copy (local change)`); }
      const p = pats.find((x) => x.id === id);
      if (p) for (const f of [p.module, p.test]) { const name = f.replace(/\.pattern-test\.mjs$/, '.test.mjs'); if (fileHash(join(p.dir, f)) !== l.hash[name]) add('info', `pattern ${id} changed in the vendored kit since you copied it (${name})`); }
    }
  }
  return out;
}

export function cli(root) {
  const r = doctor(root);
  for (const x of r) console.log(`${x.level.toUpperCase().padEnd(5)} ${x.msg}`);
  const bad = r.some((x) => x.level === 'fail');
  console.log(`doctor: ${bad ? 'FAIL' : 'ok'}`); process.exit(bad ? 1 : 0);
}

/** The kit's own tree: drift, budgets, pattern rules, no secrets, docs IDs well-formed. */
export function lintKit(root = V.KIT_ROOT) {
  const problems = [];
  for (const p of V.verify(root).problems) problems.push(`KIT-VERSION: ${p} (run: node bin/kit.mjs version --write, and commit)`);
  for (const [f, max] of Object.entries(BUDGET)) { const n = readFileSync(join(root, f)).length; if (n > max) problems.push(`${f} is ${n} bytes > budget ${max}`); }
  for (const p of loadPatterns(join(root, 'patterns'))) {
    for (const k of ['id', 'solves', 'triggers', 'not_when', 'status', 'license', 'source', 'consumers']) if (!p[k]) problems.push(`pattern ${p.id || p.dir}: missing ${k}`);
    if (p.status === 'proven') {
      if (!p.module || !p.test || !existsSync(join(p.dir, p.module)) || !existsSync(join(p.dir, p.test))) problems.push(`pattern ${p.id}: proven needs module + test on disk`);
      if (p.consumers.split(',').filter((x) => x.trim()).length < 2) problems.push(`pattern ${p.id}: proven needs >= 2 consumers`);
    } else if (p.status === 'candidate') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.review_by || '')) problems.push(`pattern ${p.id}: candidate needs review_by`);
      else if (Date.parse(p.review_by) < Date.now()) problems.push(`pattern ${p.id}: review_by ${p.review_by} has passed — promote with evidence or delete`);
    } else problems.push(`pattern ${p.id}: status must be proven or candidate`);
  }
  const walk = (rel) => { const p = join(root, rel); return statSync(p).isDirectory() ? readdirSync(p).filter((n) => n !== '.git' && n !== 'node_modules' && n !== 'results').flatMap((n) => walk(rel ? `${rel}/${n}` : n)) : [rel]; };
  for (const f of walk('')) {
    if (/\.(png|jpg|gif|ico)$/.test(f)) continue;
    for (const x of scanText(f, readFileSync(join(root, f), 'utf8'))) problems.push(`secret-like text in kit tree: ${x.path}:${x.line} ${x.class}`);
  }
  if (existsSync(join(root, 'DESIGN.md'))) {
    const d = readFileSync(join(root, 'DESIGN.md'), 'utf8');
    for (const sec of d.split(/^### /m).slice(1).filter((x) => /^RD-\d+/.test(x))) {
      const id = sec.match(/^(RD-\d+)/)[1];
      for (const k of ['Problem', 'Options', 'Choice', 'Why', 'Cost', 'Tested', 'Merge note']) if (!new RegExp(`\\*\\*${k}`).test(sec)) problems.push(`DESIGN.md ${id}: missing **${k}**`);
    }
  }
  if (existsSync(join(root, 'FINDINGS.md'))) {
    for (const sec of readFileSync(join(root, 'FINDINGS.md'), 'utf8').split(/^### /m).slice(1).filter((x) => /^RF-\d+/.test(x)))
      if (!/\b(VERIFIED|INFERRED|ASSUMED)\b/.test(sec.split('\n')[0])) problems.push(`FINDINGS.md ${sec.match(/^(RF-\d+)/)[1]}: heading needs a VERIFIED/INFERRED/ASSUMED label`);
  }
  return problems;
}

export function lintKitCli() {
  const p = lintKit();
  for (const x of p) console.log(`  - ${x}`);
  console.log(`lint-kit: ${p.length ? 'FAIL' : 'ok'}`); process.exit(p.length ? 1 : 0);
}

/** What would an upgrade change? Files whose change can alter agent behaviour or gate verdicts are flagged. */
export function upgradePlan(root, fromKit) {
  const cur = V.readStamp(join(root, '.tins', 'kit')); const next = V.manifest(fromKit);
  const keep = next.entries.filter(([, f]) => VENDORED.some((v) => f === v || f.startsWith(v + '/')));
  const old = new Map((cur?.entries || []).map(([h, f]) => [f, h])); const neu = new Map(keep.map(([h, f]) => [f, h]));
  const changed = [...neu.keys()].filter((f) => old.get(f) !== neu.get(f)); const removed = [...old.keys()].filter((f) => !neu.has(f));
  const behavioural = (f) => /^(ENTRY\.md|RELAY\.md|src\/(gate|spec|scope|secrets|session)\.mjs|patterns\/)/.test(f);
  return { from: cur?.stamp, to: next.stamp, changed, removed, behavioural: [...changed, ...removed].filter(behavioural) };
}

export function upgradeCli(root, o) {
  if (typeof o.from !== 'string') { console.error('usage: kit upgrade --from <kit-dir> [--apply]'); process.exit(2); }
  const plan = upgradePlan(root, o.from);
  console.log(`kit ${plan.from} -> ${plan.to}: ${plan.changed.length} changed, ${plan.removed.length} removed`);
  for (const f of plan.behavioural) console.log(`  BEHAVIOUR  ${f}  (can change what agents do or what the gate accepts — review the diff)`);
  if (!o.apply) { console.log('dry run. Re-run with --apply to vendor it inside a recorded session.'); return; }
  if (!G.isClean(root)) { console.error('working tree not clean'); process.exit(1); }
  start(root, { paths: ['.tins/kit', 'tins.json', 'AGENTS.md'], scopeSource: 'kit-upgrade', model: 'kit-upgrade', modelSource: 'human' });
  const oldEntry = readFileSync(join(root, '.tins', 'kit', 'ENTRY.md'), 'utf8');
  // vendor from the other kit by running its own scaffold code path
  import(new URL(`file://${join(o.from, 'src', 'scaffold.mjs').replace(/\\/g, '/')}`).href).then((m) => {
    const stamp = m.vendorKit(root);
    if (readFileSync(join(root, 'AGENTS.md'), 'utf8') === oldEntry) writeFileSync(join(root, 'AGENTS.md'), readFileSync(join(o.from, 'ENTRY.md'), 'utf8'));
    const cfg = JSON.parse(readFileSync(join(root, 'tins.json'), 'utf8')); cfg.kit = stamp; writeFileSync(join(root, 'tins.json'), JSON.stringify(cfg, null, 2) + '\n');
    const r = close(root, { note: `kit upgrade ${plan.from} -> ${stamp}; behavioural files: ${plan.behavioural.join(', ') || 'none'}` });
    for (const x of r.reasons) console.log(`  - ${x}`);
    console.log(r.ok ? `upgraded; recorded in ${r.record}` : 'upgrade applied but session not closed (see above)'); process.exit(r.ok ? 0 : 1);
  });
}
