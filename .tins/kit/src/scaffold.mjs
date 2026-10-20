// kit new <dir> --type cli|web|library|content — a project whose gate runs and checks something on day one.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, copyFileSync } from 'node:fs';
import { join, basename, resolve, dirname } from 'node:path';
import * as G from './git.mjs';
import { KIT_ROOT, manifest, render } from './version.mjs';

export const TYPES = {
  cli: { gate: ['node --test'], pkg: true, behaviour: ['src'] },
  library: { gate: ['node --test'], pkg: true, behaviour: ['src'] },
  web: { gate: ['node --test'], pkg: true, scripts: { start: 'node src/server.mjs' }, behaviour: ['src', 'public'] },
  content: { gate: ['node --test'], pkg: false, behaviour: [] }, // prose edits are the work itself; ACs constrain them
};
/** What a project vendors: enough to run every kit command offline, nothing else. */
export const VENDORED = ['bin', 'src', 'patterns', 'ENTRY.md', 'RELAY.md'];

function copyTree(src, dst, subst) {
  for (const n of readdirSync(src)) {
    const s = join(src, n); const d = join(dst, n === 'gitignore' ? '.gitignore' : n);
    if (statSync(s).isDirectory()) { mkdirSync(d, { recursive: true }); copyTree(s, d, subst); }
    else writeFileSync(d, subst(readFileSync(s, 'utf8')));
  }
}

export function vendorKit(dir) {
  const to = join(dir, '.tins', 'kit');
  for (const part of VENDORED) {
    const s = join(KIT_ROOT, part); if (!existsSync(s)) continue;
    if (statSync(s).isDirectory()) { mkdirSync(join(to, part), { recursive: true }); copyTree(s, join(to, part), (x) => x); }
    else { mkdirSync(to, { recursive: true }); copyFileSync(s, join(to, part)); }
  }
  // the stamp of the full kit, restricted to the vendored files, so `kit doctor` can verify the copy
  const m = manifest(KIT_ROOT); const keep = m.entries.filter(([, f]) => VENDORED.some((v) => f === v || f.startsWith(v + '/')));
  writeFileSync(join(to, 'KIT-VERSION'), render({ stamp: m.stamp, entries: keep }));
  return m.stamp;
}

export function scaffold(dir, type, name = basename(resolve(dir))) {
  const T = TYPES[type]; if (!T) throw new Error(`unknown type "${type}"; use one of ${Object.keys(TYPES).join(', ')}`);
  if (existsSync(dir) && readdirSync(dir).filter((x) => x !== '.git').length) throw new Error(`${dir} is not empty`);
  mkdirSync(dir, { recursive: true });
  const subst = (s) => s.replace(/\{\{NAME\}\}/g, name);
  copyTree(join(KIT_ROOT, 'templates', 'common'), dir, subst);
  copyTree(join(KIT_ROOT, 'templates', type), dir, subst);
  writeFileSync(join(dir, 'AGENTS.md'), readFileSync(join(KIT_ROOT, 'ENTRY.md'), 'utf8'));
  const stamp = vendorKit(dir);
  writeFileSync(join(dir, 'tins.json'), JSON.stringify({ type, gate: T.gate, behaviour_paths: T.behaviour, kit: stamp }, null, 2) + '\n');
  if (T.pkg) {
    const pkg = { name: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'), version: '0.1.0', private: true, type: 'module',
      scripts: { ...(T.scripts || {}), test: 'node --test', gate: 'node .tins/kit/bin/kit.mjs gate' } };
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  }
  if (!existsSync(join(dir, '.git'))) G.git(['init', '-q'], { cwd: dir });
  G.git(['add', '-A'], { cwd: dir });
  G.git(['commit', '-q', '--no-verify', '-m', `tins: scaffold ${type} project (kit ${stamp})`], { cwd: dir });
  return { dir, type, stamp };
}

export function cli(o) {
  const dir = o._[0]; if (!dir || !o.type) { console.error(`usage: kit new <dir> --type ${Object.keys(TYPES).join('|')} [--name N]`); process.exit(2); }
  const r = scaffold(dir, o.type, typeof o.name === 'string' ? o.name : undefined);
  console.log(`created ${r.type} project in ${r.dir} (kit ${r.stamp}). Next: cd ${dir} && node .tins/kit/bin/kit.mjs gate`);
}
