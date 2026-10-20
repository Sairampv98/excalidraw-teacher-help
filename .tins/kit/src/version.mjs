// KIT-VERSION: a content hash over everything that can change what an agent does or what the gate
// accepts. Line 1 is the stamp; the rest is "sha256  path" so a vendored copy can be verified file by file.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const STAMPED = ['ENTRY.md', 'RELAY.md', 'bin', 'src', 'patterns', 'templates'];

function walk(root, rel, out) {
  const p = join(root, rel);
  if (!existsSync(p)) return out;
  if (statSync(p).isDirectory()) for (const n of readdirSync(p).sort()) walk(root, rel + '/' + n, out);
  else out.push(rel);
  return out;
}

/** Normalise CRLF so a Windows checkout with autocrlf hashes the same as Linux. */
const hashFile = (p) => createHash('sha256').update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

export function manifest(root = KIT_ROOT, parts = STAMPED) {
  const files = parts.flatMap((x) => walk(root, x, [])).sort();
  const entries = files.map((f) => [hashFile(join(root, f)), f]);
  const stamp = createHash('sha256').update(entries.map((e) => e.join('  ')).join('\n')).digest('hex').slice(0, 12);
  return { stamp, entries };
}

export const render = (m) => [m.stamp, ...m.entries.map((e) => e.join('  '))].join('\n') + '\n';

export function readStamp(root = KIT_ROOT) {
  const p = join(root, 'KIT-VERSION');
  if (!existsSync(p)) return null;
  const [stamp, ...rest] = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trim().split('\n');
  return { stamp, entries: rest.map((l) => { const i = l.indexOf('  '); return [l.slice(0, i), l.slice(i + 2)]; }) };
}

/** Compare the files on disk with the stamp file. Files absent on disk are fine only if allowMissing (vendored subset). */
export function verify(root = KIT_ROOT, { allowMissing = false } = {}) {
  const st = readStamp(root);
  if (!st) return { ok: false, problems: ['KIT-VERSION missing'] };
  const problems = [];
  for (const [h, f] of st.entries) {
    const p = join(root, f);
    if (!existsSync(p)) { if (!allowMissing) problems.push(`missing: ${f}`); continue; }
    if (hashFile(p) !== h) problems.push(`changed since stamp: ${f}`);
  }
  if (!allowMissing) {
    const now = manifest(root);
    const known = new Set(st.entries.map((e) => e[1]));
    for (const [, f] of now.entries) if (!known.has(f)) problems.push(`not in stamp: ${f}`);
    if (!problems.length && now.stamp !== st.stamp) problems.push('stamp line does not match file list');
  }
  return { ok: problems.length === 0, stamp: st.stamp, problems };
}

export const writeStamp = (root = KIT_ROOT) => { const m = manifest(root); writeFileSync(join(root, 'KIT-VERSION'), render(m)); return m.stamp; };

/** Version of the kit code that is running right now. */
export function kitVersion() { const s = readStamp(KIT_ROOT); return s ? s.stamp : 'unstamped'; }
export const relKit = (p) => relative(KIT_ROOT, p);
