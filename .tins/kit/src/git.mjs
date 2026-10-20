// Thin, shell-free wrappers around the git CLI. Every fact the kit records comes through here.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';

export function git(args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd: opts.cwd || process.cwd(),
    encoding: 'utf8',
    input: opts.input,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(opts.env || {}) },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0 && !opts.allowFail) {
    const e = new Error(`git ${args.join(' ')} failed (${r.status}): ${(r.stderr || '').trim()}`);
    e.status = r.status; e.stderr = r.stderr; throw e;
  }
  return opts.raw ? r : (r.stdout || '').replace(/\r?\n$/, '');
}

export const lines = (s) => (s ? s.split(/\r?\n/).filter(Boolean) : []);

export function topLevel(cwd) { return git(['rev-parse', '--show-toplevel'], { cwd }); }

/** Per-worktree git dir (.git, or .git/worktrees/<name>); kit runtime state lives here, untracked. */
export function gitDir(cwd) {
  const d = git(['rev-parse', '--git-dir'], { cwd });
  return isAbsolute(d) ? d : resolve(cwd || process.cwd(), d);
}

export function head(cwd) { return git(['rev-parse', 'HEAD'], { cwd, allowFail: true }) || null; }

export function branch(cwd) { return git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }); }

export function isClean(cwd) { return git(['status', '--porcelain'], { cwd }) === ''; }

/** Commits in base..head, oldest first. */
export function commitsInRange(base, tip, cwd) {
  return lines(git(['rev-list', '--reverse', `${base}..${tip}`], { cwd }));
}

export function message(sha, cwd) { return git(['log', '-1', '--format=%B', sha], { cwd }); }

export function trailers(sha, cwd) {
  const out = git(['log', '-1', '--format=%(trailers:only,unfold)', sha], { cwd });
  const t = {};
  for (const l of lines(out)) { const m = l.match(/^([\w-]+):\s*(.*)$/); if (m) (t[m[1]] ||= []).push(m[2].trim()); }
  return t;
}

export function patchId(sha, cwd) {
  const diff = git(['show', '--format=', '--no-color', sha], { cwd });
  if (!diff.trim()) return null;
  const out = git(['patch-id', '--stable'], { cwd, input: diff + '\n' });
  return out.split(' ')[0] || null;
}

/** numstat between two refs: [{path, added, removed, binary}] */
export function numstat(base, tip, cwd) {
  return lines(git(['diff', '--numstat', '--no-renames', base, tip], { cwd })).map((l) => {
    const [a, r, ...p] = l.split('\t');
    return { path: p.join('\t'), added: a === '-' ? 0 : +a, removed: r === '-' ? 0 : +r, binary: a === '-' };
  });
}

export function changedFiles(base, tip, cwd) {
  return lines(git(['diff', '--name-only', '--no-renames', base, tip], { cwd }));
}

/** Added lines of a diff, per file: [{path, line, text}] — the input to the secret scan. */
export function addedLines(base, tip, cwd) {
  const diff = git(['diff', '--no-color', '--no-renames', '-U0', base, tip], { cwd });
  const out = []; let path = null; let ln = 0;
  for (const l of diff.split(/\r?\n/)) {
    if (l.startsWith('+++ ')) { path = l === '+++ /dev/null' ? null : l.slice(6); continue; }
    const h = l.match(/^@@ -\S+ \+(\d+)(?:,\d+)? @@/);
    if (h) { ln = +h[1]; continue; }
    if (path && l.startsWith('+')) { out.push({ path, line: ln, text: l.slice(1) }); ln++; }
  }
  return out;
}

export function showFile(ref, path, cwd) {
  const r = git(['show', `${ref}:${path}`], { cwd, allowFail: true, raw: true });
  return r.status === 0 ? r.stdout : null;
}

/** True if any remote-tracking branch already contains sha (then it must never be rewritten). */
export function isPublished(sha, cwd) {
  return git(['branch', '-r', '--contains', sha], { cwd, allowFail: true }).trim() !== '';
}

export function readJSON(p, dflt) { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : dflt; }
export { join };
