// Pattern memory: load, retrieve, copy-in. Retrieval is a ranking aid; the always-available
// index (`kit patterns` with no argument) is the zero-miss fallback (RD-9).
import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { KIT_ROOT } from './version.mjs';

export const PATTERN_DIR = join(KIT_ROOT, 'patterns');

export function parseFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const fm = {};
  for (const l of m[1].split(/\r?\n/)) { const kv = l.match(/^([a-z_]+):\s*(.*)$/); if (kv) fm[kv[1]] = kv[2].trim(); }
  return { fm, body: m[2] };
}

export function loadPatterns(dir = PATTERN_DIR) {
  return readdirSync(dir).filter((d) => existsSync(join(dir, d, 'PATTERN.md'))).sort().map((d) => {
    const { fm, body } = parseFrontMatter(readFileSync(join(dir, d, 'PATTERN.md'), 'utf8'));
    // index the module's comments too: the old indexer missed modules entirely (brief 2.2.2.1)
    const mod = fm.module && existsSync(join(dir, d, fm.module)) ? readFileSync(join(dir, d, fm.module), 'utf8').split(/\r?\n/).filter((l) => /^\s*(\/\/|\*|\/\*\*)/.test(l)).join(' ') : '';
    return { dir: join(dir, d), ...fm, triggerList: (fm.triggers || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean), body, moduleDoc: mod };
  });
}

// --- method "old": trigger phrase substring match (approximation of the incumbent, ASSUMED) ---
export function retrieveOld(text, pats) {
  const t = text.toLowerCase();
  return pats.filter((p) => p.triggerList.some((tr) => t.includes(tr))).map((p) => ({ id: p.id, score: 1 }));
}

// --- method "bm25": tokenised, lightly stemmed, field-weighted BM25 over every text field ---
const STOP = new Set('a an and are as at be by can for from has have if in into is it its of on or so that the their then there these they this to was were when which with without must not never only each every per our we us you your be been being all any but do does more most other some such than too very via'.split(' '));
export function stem(w) {
  let s = w;
  for (const [suf, min] of [['ations', 4], ['ation', 4], ['ings', 4], ['ing', 4], ['edly', 4], ['ed', 4], ['ies', 3], ['es', 4], ['ers', 4], ['er', 4], ['ly', 4], ['s', 3]]) {
    if (s.length - suf.length >= min && s.endsWith(suf)) { s = s.slice(0, -suf.length) + (suf === 'ies' ? 'y' : ''); break; }
  }
  if (/([bdgklmnprt])\1$/.test(s)) s = s.slice(0, -1); // splitt -> split
  return s;
}
export const tokens = (t) => (String(t).toLowerCase().normalize('NFKD').match(/[a-z0-9]+/g) || []).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);

const FIELDS = [['id', 2], ['solves', 2], ['triggers', 3], ['body', 1], ['moduleDoc', 1]];
function docTokens(p) {
  const out = [];
  for (const [f, w] of FIELDS) { const ts = tokens(f === 'id' ? p.id.replace(/-/g, ' ') : p[f] || ''); for (let i = 0; i < w; i++) out.push(...ts); }
  return out;
}

export function bm25Index(pats) {
  const docs = pats.map((p) => { const ts = docTokens(p); const tf = new Map(); for (const t of ts) tf.set(t, (tf.get(t) || 0) + 1); return { p, tf, len: ts.length }; });
  const df = new Map(); for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avg = docs.reduce((a, d) => a + d.len, 0) / docs.length;
  return { docs, df, avg, N: docs.length };
}

export function retrieveBM25(text, pats, { threshold = DEFAULT_THRESHOLD, k1 = 1.2, b = 0.75, top = 3, index } = {}) {
  const I = index || bm25Index(pats);
  const q = [...new Set(tokens(text))];
  const scored = I.docs.map((d) => {
    let s = 0;
    for (const t of q) {
      const f = d.tf.get(t); if (!f) continue;
      const idf = Math.log(1 + (I.N - I.df.get(t) + 0.5) / (I.df.get(t) + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / I.avg));
    }
    return { id: d.p.id, score: +s.toFixed(3), status: d.p.status };
  }).sort((a, z) => z.score - a.score);
  return scored.filter((x) => x.score >= threshold).slice(0, top);
}
// Tuned on the dev split only (experiments/retrieval/run.mjs --tune). See BENCH.md / RD-9.
export const DEFAULT_THRESHOLD = 7.0;

export function indexLines(pats) {
  return pats.map((p) => `${p.id} [${p.status}] — ${p.solves}`);
}

/** Spec coverage: which spec rows match a pattern, which match none (informational, not a gate). */
export function coverage(specText, pats) {
  const rows = specText.split(/\r?\n/).filter((l) => /^\|\s*(D|AC)-\d+/.test(l));
  const I = bm25Index(pats);
  return rows.map((r) => ({ row: r.split('|')[1].trim(), hits: retrieveBM25(r, pats, { index: I }) }));
}

export function cli(o) {
  const pats = loadPatterns();
  if (o.spec) {
    const cov = coverage(readFileSync(o.spec, 'utf8'), pats);
    for (const c of cov) console.log(`${c.row.padEnd(6)} ${c.hits.length ? c.hits.map((h) => `${h.id}(${h.status})`).join(', ') : '— no pattern (write it yourself, or check the index)'}`);
    return;
  }
  const q = o._.join(' ');
  if (!q) { console.log(indexLines(pats).join('\n')); return; }
  const hits = retrieveBM25(q, pats);
  if (!hits.length) console.log('no confident match. Full index:');
  for (const h of hits) { const p = pats.find((x) => x.id === h.id); console.log(`${h.id} [${p.status}] score ${h.score}\n  ${p.solves}\n  ${p.module ? `module: kit pattern add ${p.id}` : 'prose only (unverified)'} — read ${join('patterns', p.id, 'PATTERN.md')}`); }
  if (!hits.length) console.log(indexLines(pats).join('\n'));
}

const sha = (p) => createHash('sha256').update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

/** Copy a proven pattern's module + test into the project and pin its hash in .tins/patterns.lock. */
export function addCli(root, o) {
  const id = o._[1]; const pats = loadPatterns(); const p = pats.find((x) => x.id === id);
  if (o._[0] !== 'add' || !p) { console.error(`usage: kit pattern add <id>; ids: ${pats.map((x) => x.id).join(', ')}`); process.exit(2); }
  if (!p.module) { console.error(`${id} is prose only (status ${p.status}); read ${join(p.dir, 'PATTERN.md')}`); process.exit(1); }
  const to = o.to || 'lib'; mkdirSync(join(root, to), { recursive: true });
  const lockPath = join(root, '.tins', 'patterns.lock'); const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : {};
  // pattern tests are named *.pattern-test.mjs in the kit (so a project's `node --test` does not run the
  // vendored copies) and become *.test.mjs when copied in (so the project's gate does run them).
  const dest = (f) => f.replace(/\.pattern-test\.mjs$/, '.test.mjs');
  for (const f of [p.module, p.test]) copyFileSync(join(p.dir, f), join(root, to, dest(f)));
  lock[id] = { files: [p.module, p.test].map((f) => `${to}/${dest(f)}`), hash: Object.fromEntries([p.module, p.test].map((f) => [dest(f), sha(join(p.dir, f))])) };
  mkdirSync(join(root, '.tins'), { recursive: true }); writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  console.log(`copied ${p.module}, ${dest(p.test)} -> ${to}/; pinned in .tins/patterns.lock`);
}
export { sha as fileHash };
