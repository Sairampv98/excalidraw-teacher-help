// Session ledger. Facts are derived from git; the agent types nothing but optional notes.
// Design (RD-3/RD-4): start/close are idempotent and self-healing, so no "natural order" of
// commits, starts or closes can wedge a session. Runtime state is untracked, per worktree.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as G from './git.mjs';
import { scan, formatFinding } from './secrets.mjs';
import { violations } from './scope.mjs';
import { specDiff, parseSpec } from './spec.mjs';
import { runGate } from './gate.mjs';
import { kitVersion } from './version.mjs';

const stateFile = (root) => join(G.gitDir(root), 'tins-session.json');
export const readState = (root) => G.readJSON(stateFile(root), null);
const writeState = (root, s) => writeFileSync(stateFile(root), JSON.stringify(s, null, 2));
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
export const CLOSE_PREFIX = 'tins: close session ';

/** Base for a session nobody started: the last kit close commit on this branch, else the root commit. */
function inferBase(root) {
  const last = G.git(['log', '-1', '--format=%H', '--fixed-strings', `--grep=${CLOSE_PREFIX}`], { cwd: root, allowFail: true });
  return last || G.lines(G.git(['rev-list', '--max-parents=0', 'HEAD'], { cwd: root })).pop();
}

export function start(root, opts = {}) {
  const existing = readState(root);
  if (existing) return { ...existing, resumed: true }; // idempotent: a second start resumes
  const base = G.head(root);
  if (!base) throw new Error('repository has no commits; make an initial commit first');
  const dirty = G.lines(G.git(['status', '--porcelain'], { cwd: root })).map((l) => l.slice(3));
  const s = {
    id: randomBytes(4).toString('hex'), started: now(), base, base_source: opts.baseSource || 'start',
    branch: G.branch(root), task: opts.task || null, scope: opts.paths || null,
    scope_source: opts.scopeSource || (opts.paths ? 'agent' : 'default'),
    model_claimed: opts.model || null, model_source: opts.modelSource || (opts.model ? 'self-reported' : null),
    dirty_at_start: dirty,
  };
  writeState(root, s);
  return s;
}

function addTrailer(msg, id, root) {
  return G.git(['interpret-trailers', '--if-exists', 'doNothing', '--trailer', `Session: ${id}`], { cwd: root, input: msg.replace(/\s*$/, '\n') });
}

/** Give every commit in range a Session trailer. Trees are untouched, so this cannot conflict. */
function healTrailers(root, s, commits) {
  const foreign = []; const missing = [];
  for (const c of commits) {
    const t = (G.trailers(c, root).Session || []);
    if (t.length === 0) missing.push(c); else if (!t.includes(s.id)) foreign.push({ sha: c, session: t.join(',') });
  }
  if (foreign.length) return { foreign };
  if (!missing.length) return { rewritten: 0 };
  if (missing.some((c) => G.isPublished(c, root))) return { rangeAttributed: missing };
  const first = commits.indexOf(missing[0]);
  const map = new Map();
  for (const c of commits.slice(first)) {
    const meta = G.git(['log', '-1', '--format=%T%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI', c], { cwd: root }).split('\0');
    const [tree, parents, an, ae, ad, cn, ce, cd] = meta;
    const ps = parents.split(' ').filter(Boolean).flatMap((p) => ['-p', map.get(p) || p]);
    const env = { GIT_AUTHOR_NAME: an, GIT_AUTHOR_EMAIL: ae, GIT_AUTHOR_DATE: ad, GIT_COMMITTER_NAME: cn, GIT_COMMITTER_EMAIL: ce, GIT_COMMITTER_DATE: cd };
    const msg = addTrailer(G.message(c, root), s.id, root);
    map.set(c, G.git(['commit-tree', tree, ...ps], { cwd: root, input: msg + '\n', env }));
  }
  const tip = map.get(commits[commits.length - 1]);
  const ref = s.branch === 'HEAD' ? 'HEAD' : `refs/heads/${s.branch}`;
  G.git(['update-ref', '-m', `tins: add Session trailers (${s.id})`, ref, tip, commits[commits.length - 1]], { cwd: root });
  return { rewritten: map.size };
}

function commitAll(root, id, subject) {
  G.git(['add', '-A'], { cwd: root });
  if (G.git(['diff', '--cached', '--name-only'], { cwd: root }) === '') return false;
  G.git(['commit', '-q', '--no-verify', '-m', subject, '-m', `Session: ${id}`], { cwd: root });
  return true;
}

/** This session's own commits: the first-parent chain back to base. Commits that arrive through
 *  the second parent of a merge (another task's work) belong to their own sessions, not this one. */
export function ownCommits(root, base, tip) {
  return G.lines(G.git(['rev-list', '--reverse', '--first-parent', `${base}..${tip}`], { cwd: root }));
}

/** Files a commit authored: vs its parent; for a merge, only files differing from every parent (the resolution). */
function commitFiles(root, c) {
  const parents = G.git(['log', '-1', '--format=%P', c], { cwd: root }).split(' ').filter(Boolean);
  const names = G.lines(G.git(['show', '--format=', '--name-only', '--no-renames', c], { cwd: root }));
  if (parents.length <= 1) return G.numstat(parents[0] || G.git(['hash-object', '-t', 'tree', '--stdin'], { cwd: root, input: '' }), c, root);
  return G.numstat(parents[0], c, root).filter((f) => names.includes(f.path));
}

function ownSpecDiff(root, own) {
  const added = new Set(), changed = new Set(), removed = new Set();
  for (const c of own) {
    const parents = G.git(['log', '-1', '--format=%P', c], { cwd: root }).split(' ').filter(Boolean);
    const now = new Map(parseSpec(G.showFile(c, 'SPEC.md', root) || '').map((r) => [r.id, r.raw]));
    const ps = parents.map((p) => new Map(parseSpec(G.showFile(p, 'SPEC.md', root) || '').map((r) => [r.id, r.raw])));
    for (const [id, raw] of now) {
      if (ps.every((m) => !m.has(id))) added.add(id);
      else if (ps.every((m) => m.get(id) !== raw) && !added.has(id)) changed.add(id);
    }
    for (const id of new Set(ps.flatMap((m) => [...m.keys()]))) if (!now.has(id) && ps.every((m) => m.has(id))) { removed.add(id); added.delete(id); changed.delete(id); }
  }
  return { added: [...added], changed: [...changed], removed: [...removed] };
}

/** Everything the record says is computed here, from git. */
export function facts(root, s, { gate = true } = {}) {
  const tip = G.head(root);
  const own = ownCommits(root, s.base, tip);
  const all = G.commitsInRange(s.base, tip, root);
  const merged = all.filter((c) => !own.includes(c));
  const per = new Map();
  for (const c of own) for (const f of commitFiles(root, c)) {
    const x = per.get(f.path) || { path: f.path, added: 0, removed: 0 }; x.added += f.added; x.removed += f.removed; per.set(f.path, x);
  }
  const files = [...per.values()].sort((a, b) => a.path.localeCompare(b.path));
  // secret scan deliberately over-covers: everything added in base..tip, merged-in work included
  const items = G.addedLines(s.base, tip, root);
  for (const c of all) G.message(c, root).split(/\r?\n/).forEach((t, i) => items.push({ path: `commit ${c.slice(0, 10)} message`, line: i + 1, text: t }));
  const secrets = scan(items);
  const spec = ownSpecDiff(root, own);
  const scopeViol = violations(files.map((f) => f.path), s.scope);
  const g = gate ? runGate(root, { quiet: false }) : null;
  return {
    head: tip, commits: own.map((c) => ({ sha: c, patch_id: G.patchId(c, root) })), merged_in: merged.length,
    files, lines_added: files.reduce((a, f) => a + f.added, 0), lines_removed: files.reduce((a, f) => a + f.removed, 0),
    secrets, spec, scope_violations: scopeViol, gate: g,
  };
}

const yamlList = (xs) => (xs.length ? '\n' + xs.map((x) => `  - ${x}`).join('\n') : ' []');

function renderRecord(s, f, extra) {
  const fm = [
    '---', `id: ${s.id}`, `task: ${s.task || ''}`, `branch: ${s.branch}`, `base: ${s.base}`, `base_source: ${s.base_source}`,
    `head: ${f.head}`, `started: ${s.started}`, `closed: ${now()}`, `status: ${extra.status}`,
    `gate: ${f.gate.ok ? 'pass' : 'fail'}`, `secrets: ${f.secrets.length ? 'found' : 'clean'}`,
    `secrets_scanned: added-lines,commit-messages,record`,
    `scope: ${f.scope_violations.length ? 'violation' : 'ok'}`, `scope_paths: ${(s.scope || ['<repo minus protected>']).join(',')}`,
    `scope_source: ${s.scope_source}`,
    `model_claimed: ${s.model_claimed || 'unknown'}`, `model_source: ${s.model_source || 'none'}`, `model_verified: false`,
    `kit_version: ${extra.kitVersion}`, `lines_added: ${f.lines_added}`, `lines_removed: ${f.lines_removed}`,
    `trailers: ${extra.trailers}`, `merged_in: ${f.merged_in}`,
    `commits:${yamlList(f.commits.map((c) => `${c.sha} ${c.patch_id || '-'}`))}`,
    `files:${yamlList(f.files.map((x) => `${x.path} +${x.added} -${x.removed}`))}`,
    `spec_added:${yamlList(f.spec.added)}`, `spec_changed:${yamlList(f.spec.changed)}`, `spec_removed:${yamlList(f.spec.removed)}`,
    `dirty_at_start:${yamlList(s.dirty_at_start || [])}`,
    `spec_waiver: ${extra.why ? JSON.stringify(extra.why) : ''}`,
    '---', '',
    `# Session ${s.id}`, '',
    'Everything above is derived from git by `kit close`. Text below is the agent\'s own note: a claim, not a fact.', '',
    extra.note ? extra.note.replace(/^---$/gm, '- - -') : '(no note)', '',
  ];
  return fm.join('\n');
}

/**
 * Close: commit leftovers, heal trailers, derive facts, gate, scan, write + commit the record.
 * Returns {ok, reasons[], record?}. On failure the session stays open (work is committed, not lost).
 */
export function close(root, opts = {}) {
  let s = readState(root);
  const reasons = [];
  if (!s) { // close without start: self-heal instead of refusing (brief 2.2.5)
    s = start(root, { baseSource: 'inferred-last-close' });
    s.base = inferBase(root); writeState(root, s);
  }
  commitAll(root, s.id, 'tins: uncommitted work at close');
  const heal = healTrailers(root, s, ownCommits(root, s.base, G.head(root)));
  if (heal.foreign) {
    for (const f of heal.foreign) reasons.push(`commit ${f.sha.slice(0, 10)} belongs to session ${f.session}, not ${s.id}; two sessions share this branch — use one worktree per session`);
    return { ok: false, reasons, session: s };
  }
  const f = facts(root, s);
  for (const x of f.secrets) reasons.push(`secret: ${formatFinding(x)}`);
  for (const p of f.scope_violations) reasons.push(`scope: ${p} is outside this session's allowed paths`);
  if (!f.gate.ok) reasons.push('gate failed (output above)');
  if (!f.commits.length) reasons.push('nothing to record: no commits and no changes since session start');
  if (f.secrets.length) reasons.push(`a secret is in this session's history. Before it leaves this machine: git reset --soft ${s.base.slice(0, 12)}, remove it from the files, then run close again`);
  if (!f.commits.length) { unlinkSync(stateFile(root)); reasons.push('session discarded (it recorded nothing)'); return { ok: false, reasons, session: s, facts: f }; }
  // "Never fix a defect in code alone" made mechanical (RD-20): a session that changes behaviour paths
  // must add/change a SPEC row, or state why not (--why), which is recorded as the agent's claim.
  let behaviour = [];
  try { behaviour = JSON.parse(readFileSync(join(root, 'tins.json'), 'utf8')).behaviour_paths || []; } catch {}
  const touched = f.files.map((x) => x.path).filter((p) => behaviour.some((b) => p === b || p.startsWith(b + '/')));
  const specMoved = f.spec.added.length + f.spec.changed.length + f.spec.removed.length > 0;
  if (touched.length && !specMoved && !opts.why) reasons.push(`changed ${touched.slice(0, 3).join(', ')}${touched.length > 3 ? ' …' : ''} but no D-n/AC-n row in SPEC.md was added or changed. Add or adjust the row that describes this behaviour; if behaviour did not change (refactor, comments), run close again with --why "<reason>"`);
  const handover = opts.handover && !f.secrets.length && f.commits.length;
  if (reasons.length && !handover) return { ok: false, reasons, session: s, facts: f };

  const trailers = heal.rangeAttributed ? `range-attributed:${heal.rangeAttributed.length}` : heal.rewritten ? `healed:${heal.rewritten}` : 'present';
  const rec = renderRecord(s, f, { status: reasons.length ? 'handover' : 'closed', note: opts.note, kitVersion: kitVersion(), trailers, why: opts.why });
  const recFindings = scan(rec.split(/\r?\n/).map((t, i) => ({ path: 'record', line: i + 1, text: t })));
  if (recFindings.length) return { ok: false, reasons: recFindings.map((x) => `secret in note: ${formatFinding(x)}`), session: s };
  const stamp = s.started.replace(/[-:]/g, '').replace(/\..*|Z$/, '');
  const rel = `sessions/${stamp}-${s.id}.md`;
  mkdirSync(join(root, 'sessions'), { recursive: true });
  writeFileSync(join(root, rel), rec);
  G.git(['add', '--', rel], { cwd: root });
  G.git(['commit', '-q', '--no-verify', '-m', `${CLOSE_PREFIX}${s.id}`, '-m', `Session: ${s.id}`], { cwd: root });
  unlinkSync(stateFile(root));
  return { ok: !reasons.length, handover: !!reasons.length, reasons, record: rel, session: s, facts: f };
}

export function abort(root) {
  const s = readState(root); if (s) unlinkSync(stateFile(root)); return s;
}

/** Parse a record's front matter (flat keys + simple lists). */
export function parseRecord(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/); if (!m) return null;
  const o = {}; let key = null;
  for (const l of m[1].split(/\r?\n/)) {
    const kv = l.match(/^([a-z_]+):\s?(.*)$/);
    if (kv) { key = kv[1]; o[key] = kv[2] === '[]' ? [] : kv[2] === '' ? [] : kv[2]; continue; }
    const li = l.match(/^\s+-\s(.*)$/); if (li && key) { if (!Array.isArray(o[key])) o[key] = []; o[key].push(li[1]); }
  }
  return o;
}

export function records(root, ref = null) {
  const out = new Map();
  if (ref) {
    for (const p of G.lines(G.git(['ls-tree', '--name-only', `${ref}:sessions`], { cwd: root, allowFail: true }))) {
      const r = parseRecord(G.showFile(ref, `sessions/${p}`, root) || ''); if (r) out.set(r.id, { ...r, file: `sessions/${p}` });
    }
    return out;
  }
  const dir = join(root, 'sessions'); if (!existsSync(dir)) return out;
  for (const p of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const r = parseRecord(readFileSync(join(dir, p), 'utf8')); if (r) out.set(r.id, { ...r, file: `sessions/${p}` });
  }
  return out;
}

/**
 * Merge-time check of base..HEAD. Trusts nothing in records it can recompute:
 * re-scans secrets, re-checks scope per session from git, re-runs the gate.
 */
export function check(root, base, { gate = true } = {}) {
  const problems = [];
  const tip = G.head(root);
  const recs = records(root, tip);
  const commits = G.commitsInRange(base, tip, root);
  const bySession = new Map();
  for (const c of commits) {
    const parents = G.git(['log', '-1', '--format=%P', c], { cwd: root }).split(' ').filter(Boolean);
    const t = G.trailers(c, root);
    if (parents.length > 1 && t['Tins-Merge']) continue; // reconciler merge commit, verified below by re-checks
    if (t['Tins-Task'] && parents.length === 1) { // planner commit: may only add/alter its own task file
      const fs = G.lines(G.git(['show', '--name-only', '--format=', c], { cwd: root }));
      if (fs.every((p) => p === `tasks/${t['Tins-Task'][0]}.md`)) continue;
    }
    const ids = t.Session || [];
    if (ids.length !== 1) { problems.push(`commit ${c.slice(0, 10)}: needs exactly one Session trailer (has ${ids.length})`); continue; }
    if (!bySession.has(ids[0])) bySession.set(ids[0], []);
    bySession.get(ids[0]).push(c);
  }
  for (const [id, cs] of bySession) {
    const r = recs.get(id);
    if (!r) { problems.push(`session ${id}: no record in sessions/ (was it closed?)`); continue; }
    if (r.status !== 'closed') problems.push(`session ${id}: record status is ${r.status}, not closed`);
    if (r.gate !== 'pass') problems.push(`session ${id}: record says gate ${r.gate}`);
    const scope = r.scope_paths && !r.scope_paths.startsWith('<') ? r.scope_paths.split(',') : null;
    for (const c of cs) {
      const isRecordCommit = G.message(c, root).startsWith(CLOSE_PREFIX + id);
      const files = G.lines(G.git(['show', '--name-only', '--format=', '--no-renames', c], { cwd: root }));
      if (isRecordCommit) {
        for (const p of files) if (p !== r.file) problems.push(`session ${id}: close commit ${c.slice(0, 10)} touches ${p}`);
        continue;
      }
      for (const p of violations(files, scope)) problems.push(`session ${id}: commit ${c.slice(0, 10)} changes ${p}, outside its scope`);
    }
  }
  const items = G.addedLines(base, tip, root);
  for (const c of commits) G.message(c, root).split(/\r?\n/).forEach((t, i) => items.push({ path: `commit ${c.slice(0, 10)} message`, line: i + 1, text: t }));
  for (const f of scan(items)) problems.push(`secret: ${formatFinding(f)}`);
  if (gate) {
    if (!G.isClean(root)) problems.push('working tree not clean; check runs the gate on HEAD exactly');
    else if (!runGate(root).ok) problems.push('gate fails on HEAD');
  }
  return { ok: problems.length === 0, problems, sessions: [...bySession.keys()] };
}

/** kit run: start (or resume) around an arbitrary agent command, then close. The model cannot forget either step. */
export function run(root, argv, opts = {}) {
  const s = start(root, { ...opts, scopeSource: opts.scopeSource || (opts.paths ? 'launcher' : 'default'), modelSource: opts.model ? 'launcher' : null });
  if (s.resumed) process.stdout.write(`kit: resuming open session ${s.id} (started ${s.started})\n`);
  else process.stdout.write(`kit: session ${s.id} started at ${s.base.slice(0, 10)}\n`);
  const t0 = Date.now();
  const r = spawnSync(argv[0], argv.slice(1), { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, TINS_SESSION: s.id }, timeout: opts.timeoutS ? opts.timeoutS * 1000 : undefined });
  const note = [`agent command exit: ${r.status}${r.signal ? ' signal ' + r.signal : ''}`, `agent wall time: ${Math.round((Date.now() - t0) / 1000)}s`, opts.note || ''].filter(Boolean).join('\n');
  // The agent may have obeyed AGENTS.md and closed the session itself; that must not turn into a failure.
  if (!readState(root) && G.isClean(root) && G.message('HEAD', root).startsWith(CLOSE_PREFIX + s.id)) {
    const rec = G.git(['show', '--name-only', '--format=', 'HEAD'], { cwd: root });
    return { ok: true, record: rec, session: s, reasons: [], closedByAgent: true };
  }
  return close(root, { note, handover: opts.handover, why: opts.why });
}
