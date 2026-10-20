// Multi-agent path (RD-12): one task = one branch + one worktree + one declared scope.
// The reconciler merges a task only after re-deriving everything (check) on the task branch,
// then gates the merged tree before committing. Conflicts abort cleanly; nothing half-merges.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import * as G from './git.mjs';
import { overlaps, violations } from './scope.mjs';
import { check } from './session.mjs';
import { runGate } from './gate.mjs';

export function readTask(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/); if (!m) return null;
  const t = { body: m[2].trim() };
  for (const l of m[1].split(/\r?\n/)) { const kv = l.match(/^([a-z_]+):\s*(.*)$/); if (kv) t[kv[1]] = kv[2].trim(); }
  t.pathList = (t.paths || '').split(',').map((s) => s.trim()).filter(Boolean);
  return t;
}
const renderTask = (t) => `---\nid: ${t.id}\npaths: ${t.pathList.join(',')}\n${t.read ? `read: ${t.read}\n` : ''}base: ${t.base}\nstatus: ${t.status}\n---\n\n${t.body}\n`;

export function tasks(root) {
  const d = join(root, 'tasks'); if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => f.endsWith('.md')).map((f) => readTask(readFileSync(join(d, f), 'utf8'))).filter(Boolean);
}

export function newTask(root, id, { paths, body = '', dir, overlapOk = false, read = '' }) {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) throw new Error('task id: lowercase letters, digits, dashes');
  if (!paths || !paths.length) throw new Error('a task needs --paths (its scope); this is what makes parallel work mergeable');
  if (!G.isClean(root)) throw new Error('working tree not clean');
  if (existsSync(join(root, 'tasks', `${id}.md`))) throw new Error(`task ${id} exists`);
  const clash = tasks(root).filter((t) => t.status === 'open' && overlaps(t.pathList, paths));
  if (clash.length && !overlapOk) throw new Error(`paths overlap open task(s) ${clash.map((t) => t.id).join(', ')}; narrow the scope or pass --overlap-ok (expect merge conflicts)`);
  const base = G.branch(root);
  const t = { id, pathList: paths, read: read || '', base, status: 'open', body: body || '(describe the task here)' };
  mkdirSync(join(root, 'tasks'), { recursive: true });
  writeFileSync(join(root, 'tasks', `${id}.md`), renderTask(t));
  G.git(['add', '--', `tasks/${id}.md`], { cwd: root });
  G.git(['commit', '-q', '--no-verify', '-m', `tins: task ${id}`, '-m', `Tins-Task: ${id}`], { cwd: root });
  const wt = resolve(dir || join(dirname(root), `${basename(root)}.worktrees`, id));
  G.git(['worktree', 'add', '-q', '-b', `task/${id}`, wt, 'HEAD'], { cwd: root });
  return { task: t, worktree: wt };
}

/** Reconcile task/<id> into the current branch. Returns {ok, stage, problems, conflicts?}. */
export function merge(root, id) {
  const tf = join(root, 'tasks', `${id}.md`);
  if (!existsSync(tf)) return { ok: false, stage: 'task', problems: [`no tasks/${id}.md on this branch`] };
  if (!G.isClean(root)) return { ok: false, stage: 'task', problems: ['working tree not clean'] };
  const t = readTask(readFileSync(tf, 'utf8')); const br = `task/${id}`;
  const tip = G.git(['rev-parse', '--verify', '-q', br], { cwd: root, allowFail: true });
  if (!tip) return { ok: false, stage: 'task', problems: [`no branch ${br}`] };
  const mb = G.git(['merge-base', 'HEAD', br], { cwd: root });
  // 1. verify the task branch on its own, in a throwaway detached worktree (never trusts records)
  // The throwaway worktree is created INSIDE the repository, not in the OS temp
  // directory. Reason: the gate runs inside this worktree, and Node resolves a
  // package by walking up from the importing file. In %TEMP% that walk reaches
  // C:\ and finds no node_modules, so the gate would fail for a path reason and
  // not a code reason. Inside the repo the walk reaches the repository's own
  // node_modules. `.tins/merge-tmp-*/` is gitignored so the main tree stays clean.
  mkdirSync(join(root, '.tins'), { recursive: true });
  const tmp = mkdtempSync(join(root, '.tins', 'merge-tmp-'));
  let res;
  try {
    G.git(['worktree', 'add', '-q', '--detach', tmp, tip], { cwd: root });
    res = check(tmp, mb);
  } finally { G.git(['worktree', 'remove', '--force', tmp], { cwd: root, allowFail: true }); rmSync(tmp, { recursive: true, force: true }); }
  const problems = [...res.problems];
  const changed = G.changedFiles(mb, tip, root).filter((p) => !p.startsWith('sessions/'));
  for (const p of violations(changed, t.pathList)) problems.push(`${p} is outside task ${id}'s paths (${t.pathList.join(',')})`);
  if (!res.sessions.length) problems.push(`task ${id} has no closed session`);
  if (problems.length) return { ok: false, stage: 'check', problems };
  // 2. merge without committing, gate the merged tree, then commit or abort
  const m = G.git(['merge', '--no-ff', '--no-commit', br], { cwd: root, allowFail: true, raw: true });
  if (m.status !== 0) {
    const conflicts = G.lines(G.git(['diff', '--name-only', '--diff-filter=U'], { cwd: root, allowFail: true }));
    G.git(['merge', '--abort'], { cwd: root, allowFail: true });
    return { ok: false, stage: 'conflict', conflicts, problems: [`conflict in ${conflicts.join(', ') || '(unknown)'}; in the task worktree run a new session: git merge ${G.branch(root)}, resolve, kit close; then merge again`] };
  }
  writeFileSync(tf, renderTask({ ...t, status: 'merged' }));
  G.git(['add', '--', `tasks/${id}.md`], { cwd: root });
  const g = runGate(root);
  if (!g.ok) { G.git(['merge', '--abort'], { cwd: root, allowFail: true }); return { ok: false, stage: 'gate', problems: ['gate fails on the merged tree (each side passed alone); merge aborted'] }; }
  G.git(['commit', '-q', '--no-verify', '-m', `tins: merge task ${id}`, '-m', `Tins-Merge: ${id}`], { cwd: root });
  return { ok: true, stage: 'merged', problems: [], sessions: res.sessions };
}

export function cli(root, o) {
  const [sub, id] = o._;
  if (sub === 'list') { for (const t of tasks(root)) console.log(`${t.id.padEnd(20)} ${t.status.padEnd(7)} ${t.pathList.join(',')}`); return; }
  if (sub !== 'new' || !id) { console.error('usage: kit task new <id> --paths a,b [--read c,d] [-m "description"] [--dir path] [--overlap-ok] | kit task list'); process.exit(2); }
  const paths = typeof o.paths === 'string' ? o.paths.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const r = newTask(root, id, { paths, body: o.m, dir: typeof o.dir === 'string' ? o.dir : undefined, overlapOk: !!o['overlap-ok'], read: typeof o.read === 'string' ? o.read : '' });
  console.log(`task ${id}: branch task/${id}, worktree ${r.worktree}\nworker: cd ${r.worktree} && node .tins/kit/bin/kit.mjs run --task ${id} -- <agent command>\nrelay:  cd ${r.worktree} && node .tins/kit/bin/kit.mjs packet ${id}`);
}

export function mergeCli(root, o) {
  const id = o._[0]; if (!id) { console.error('usage: kit merge <task-id>'); process.exit(2); }
  const r = merge(root, id);
  for (const p of r.problems) console.log(`  - ${p}`);
  console.log(`merge ${id}: ${r.ok ? 'MERGED' : `REFUSED at ${r.stage}`}`);
  process.exit(r.ok ? 0 : r.stage === 'conflict' ? 3 : 1);
}
