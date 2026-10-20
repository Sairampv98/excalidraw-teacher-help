#!/usr/bin/env node
// tins-kit CLI. Zero dependencies, Node >= 18, git. Run as: node <kit>/bin/kit.mjs <command>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as G from '../src/git.mjs';
import * as S from '../src/session.mjs';
import { runGate } from '../src/gate.mjs';
import { scanText, formatFinding } from '../src/secrets.mjs';
import * as V from '../src/version.mjs';

const HELP = `kit — tins-kit. Commands (run inside a TINS project unless noted):
  gate                          run SPEC lint + tins.json gate commands (no skip flag exists)
  run [opts] -- <agent cmd...>  start a session, run the agent, close the session
  start [opts] | close [--note T] [--why T] [--handover] | status | abort
  check --base <ref>            merge-time verification of every commit in <ref>..HEAD
  scan <file...>                secret scan files (prints class + line, never the value)
  patterns <text> | --spec F    find proven building blocks for a need or a spec
  pattern add <id> [--to dir]   copy a pattern's module + test into this project
  task new <id> --paths a,b [-m text] | task list
  merge <task-id>               reconcile a task branch into the current branch
  packet <task-id> | apply <task-id> <reply-file>   chat-relay mode
  new <dir> --type cli|web|library|content           scaffold (anywhere)
  version [--write|--check] | doctor | lint-kit | upgrade --from <kit-dir>
options: --task ID --paths a,b --model NAME --timeout SECONDS`;

function parse(argv) {
  const o = { _: [] }; const dd = argv.indexOf('--');
  const head = dd >= 0 ? argv.slice(0, dd) : argv; o.rest = dd >= 0 ? argv.slice(dd + 1) : [];
  for (let i = 0; i < head.length; i++) {
    const a = head[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = head[i + 1]; if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; } }
    else if (a === '-m') o.m = head[++i]; else o._.push(a);
  }
  return o;
}
const list = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : null);
const root = () => { try { return G.topLevel(process.cwd()); } catch { die('not inside a git repository'); } };
function die(msg, code = 1) { process.stderr.write(`kit: ${msg}\n`); process.exit(code); }
function report(r) {
  if (r.record) process.stdout.write(`kit: ${r.handover ? 'HANDOVER (not mergeable)' : 'closed'} session ${r.session.id} -> ${r.record}\n`);
  for (const x of r.reasons || []) process.stdout.write(`  - ${x}\n`);
  if (!r.ok && !r.record && !(r.reasons || []).some((x) => x.includes('discarded'))) process.stdout.write(`kit: session ${r.session?.id} stays OPEN; fix the above and run close again\n`);
  process.exit(r.ok ? 0 : 1);
}

const [cmd, ...argv] = process.argv.slice(2);
const o = parse(argv);
const opts = { task: o.task, paths: list(o.paths), model: o.model, modelSource: o['model-source'], timeoutS: o.timeout ? +o.timeout : undefined, note: o.note, handover: !!o.handover, why: typeof o.why === 'string' ? o.why : undefined };

async function main() {
  switch (cmd) {
    case 'gate': process.exit(runGate(root()).ok ? 0 : 1);
    case 'start': { const r = root(); withTask(r, opts); const s = S.start(r, opts); console.log(`kit: session ${s.id} ${s.resumed ? 'resumed' : 'started'} (base ${s.base.slice(0, 10)})`); return; }
    case 'close': return report(S.close(root(), opts));
    case 'run': { if (!o.rest.length) die('usage: kit run [opts] -- <agent command...>', 2); const r = root(); withTask(r, opts); return report(S.run(r, o.rest, opts)); }
    case 'status': { const s = S.readState(root()); console.log(s ? JSON.stringify(s, null, 2) : 'no open session'); return; }
    case 'abort': { const s = S.abort(root()); console.log(s ? `aborted session ${s.id} (commits are kept; they are unattributed until a new session closes over them)` : 'no open session'); return; }
    case 'check': {
      if (!o.base) die('usage: kit check --base <ref>', 2);
      const r = S.check(root(), o.base);
      for (const p of r.problems) console.log(`  - ${p}`);
      console.log(`check: ${r.ok ? 'PASS' : 'FAIL'} (${r.sessions.length} session(s))`); process.exit(r.ok ? 0 : 1);
    }
    case 'scan': {
      let n = 0;
      for (const f of o._) { if (!existsSync(f)) die(`no such file: ${f}`, 2); for (const x of scanText(f, readFileSync(f, 'utf8'))) { console.log(formatFinding(x)); n++; } }
      console.log(`scan: ${n ? `${n} finding(s) — values not shown` : 'clean'}`); process.exit(n ? 1 : 0);
    }
    case 'patterns': { const P = await import('../src/patterns.mjs'); return P.cli(o); }
    case 'pattern': { const P = await import('../src/patterns.mjs'); return P.addCli(root(), o); }
    case 'task': { const T = await import('../src/tasks.mjs'); return T.cli(root(), o); }
    case 'merge': { const T = await import('../src/tasks.mjs'); return T.mergeCli(root(), o); }
    case 'packet': { const R = await import('../src/relay.mjs'); return R.packetCli(root(), o); }
    case 'apply': { const R = await import('../src/relay.mjs'); return R.applyCli(root(), o, opts); }
    case 'new': { const N = await import('../src/scaffold.mjs'); return N.cli(o); }
    case 'version': {
      if (o.write) return console.log(V.writeStamp());
      if (o.check) { const r = V.verify(); r.problems.forEach((p) => console.log(`  - ${p}`)); console.log(`kit tree: ${r.ok ? 'matches' : 'DRIFT from'} KIT-VERSION ${r.stamp || ''}`); process.exit(r.ok ? 0 : 1); }
      return console.log(V.kitVersion());
    }
    case 'doctor': { const D = await import('../src/doctor.mjs'); return D.cli(root(), o); }
    case 'lint-kit': { const D = await import('../src/doctor.mjs'); return D.lintKitCli(); }
    case 'upgrade': { const D = await import('../src/doctor.mjs'); return D.upgradeCli(root(), o); }
    case undefined: case 'help': case '--help': case '-h': console.log(HELP); return;
    default: die(`unknown command "${cmd}"\n${HELP}`, 2);
  }
}

/** A task file (tasks/<id>.md) supplies scope; the launcher's --paths wins over the agent's guess. */
function withTask(r, opts) {
  if (!opts.task || opts.paths) return;
  const p = join(r, 'tasks', `${opts.task}.md`);
  if (!existsSync(p)) die(`no task file tasks/${opts.task}.md`, 2);
  const m = readFileSync(p, 'utf8').match(/^paths:\s*(.+)$/m);
  if (m) { opts.paths = list(m[1]); opts.scopeSource = 'task-file'; }
}

main().catch((e) => die(e.message));
