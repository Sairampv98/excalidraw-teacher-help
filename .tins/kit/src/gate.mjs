// The gate: SPEC.md lint + the project's own commands from tins.json. No skip flag exists, by design.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintSpec, lintDependencies } from './spec.mjs';

export function loadConfig(root) {
  const p = join(root, 'tins.json');
  if (!existsSync(p)) throw new Error(`no tins.json in ${root} — not a TINS project (run "kit new")`);
  const c = JSON.parse(readFileSync(p, 'utf8'));
  if (!Array.isArray(c.gate)) throw new Error('tins.json: "gate" must be an array of shell commands');
  return c;
}

export function runGate(root, { quiet = false } = {}) {
  const steps = []; const log = [];
  const say = (s) => { log.push(s); if (!quiet) process.stdout.write(s + '\n'); };
  let cfg;
  try { cfg = loadConfig(root); } catch (e) { say(`gate: FAIL config — ${e.message}`); return { ok: false, steps: [{ name: 'config', ok: false }], log: log.join('\n') }; }
  // setup commands run before the SPEC lint: e.g. linking an acceptance suite kept in another repo,
  // so a fresh checkout (merge-time check worktree) can resolve AC check files (RF-21).
  const env0 = { ...process.env, FORCE_COLOR: '0' };
  for (const k of Object.keys(env0)) if (k.startsWith('NODE_TEST_')) delete env0[k];
  for (const cmd of cfg.setup || []) {
    const r = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8', timeout: 300000, env: env0 });
    steps.push({ name: `setup: ${cmd}`, ok: r.status === 0, code: r.status });
    if (r.status !== 0) say(`  setup ${cmd}: exit ${r.status}\n${`${r.stdout || ''}${r.stderr || ''}`.split(/\r?\n/).slice(-10).join('\n').replace(/^/gm, '    | ')}`);
  }
  const specPath = join(root, 'SPEC.md');
  const problems = existsSync(specPath) ? lintSpec(readFileSync(specPath, 'utf8'), root) : ['SPEC.md missing'];
  const pkgPath = join(root, 'package.json');
  if (existsSync(specPath) && existsSync(pkgPath)) problems.push(...lintDependencies(readFileSync(specPath, 'utf8'), readFileSync(pkgPath, 'utf8')));
  steps.push({ name: 'spec', ok: problems.length === 0 });
  for (const p of problems) say(`  spec: ${p}`);
  // NODE_TEST_CONTEXT makes a nested `node --test` report to a parent and exit 0 even when tests
  // fail (RF-7). A gate launched from inside any node:test process would silently pass. Strip it.
  const env = { ...process.env, FORCE_COLOR: '0' };
  for (const k of Object.keys(env)) if (k.startsWith('NODE_TEST_')) delete env[k];
  for (const cmd of cfg.gate) {
    const r = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8', timeout: (cfg.gate_timeout_s || 600) * 1000, env });
    const ok = r.status === 0;
    steps.push({ name: cmd, ok, code: r.status });
    if (!ok) {
      const tail = `${r.stdout || ''}${r.stderr || ''}`.split(/\r?\n/).slice(-25).join('\n');
      say(`  ${cmd}: exit ${r.status}${r.error ? ' (' + r.error.code + ')' : ''}\n${tail.replace(/^/gm, '    | ')}`);
    }
  }
  const ok = steps.every((s) => s.ok);
  say(`gate: ${ok ? 'PASS' : 'FAIL'} (${steps.map((s) => `${s.name}=${s.ok ? 'ok' : 'fail'}`).join(', ')})`);
  return { ok, steps, log: log.join('\n') };
}
