#!/usr/bin/env node
// Product gate for the excalidraw fork.
//
// The kit's own gate.mjs runs the shell commands in tins.json. This script is that
// command: it runs the fork's four verification gates, in order, and writes a TAP
// summary the kit and the verification recipe can read.
//
// Rules it encodes (from the playbook's lessons):
//   L1  Windows: a .cmd must be run with shell:true or spawnSync throws EINVAL.
//   L9  One heavy command at a time. The gates are sequential, never parallel.
//   L15 A worktree may not have its own node_modules; resolve the nearest one by
//       walking up from this script, so the gate also works in the throwaway
//       worktree `kit merge` builds inside the repository.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/** The nearest node_modules/.bin at or above `start`. */
function findBinDir(start) {
  let d = start;
  for (let i = 0; i < 10; i++) {
    const candidate = join(d, "node_modules", ".bin");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return null;
}

const binDir = findBinDir(root);
if (!binDir) {
  process.stderr.write(
    "gate: FAIL - no node_modules/.bin found above " + root + "\n" +
      "       run `yarn install` in the repository root first\n",
  );
  process.exit(1);
}

const isWin = process.platform === "win32";
const EXE = { tsc: "tsc", eslint: "eslint", prettier: "prettier", vitest: "vitest" };

const STEPS = [
  {
    name: "typecheck",
    cmd: EXE.tsc,
    args: [],
    note: "tsc",
  },
  {
    name: "eslint",
    cmd: EXE.eslint,
    args: ["--max-warnings=0", "--ext", ".js,.ts,.tsx", "."],
    note: "eslint --max-warnings=0",
  },
  {
    name: "prettier",
    cmd: EXE.prettier,
    args: [
      "**/*.{css,scss,json,md,html,yml}",
      "--ignore-path=.eslintignore",
      "--list-different",
    ],
    note: "prettier --list-different",
  },
  {
    name: "vitest",
    cmd: EXE.vitest,
    args: ["run"],
    note: "vitest run",
  },
];

const env = { ...process.env, FORCE_COLOR: "0" };
// Put the resolved node_modules/.bin on PATH, the way yarn does. Without this the
// spawned `tsc` / `eslint` / `vitest` would not be found when the gate runs in a
// worktree that has no node_modules of its own.
//
// On Windows the real environment variable is `Path`, not `PATH`. Reading
// `env.PATH` would return undefined, and writing it back would clobber the real
// `Path` with "<bindir>;undefined" - and then `node` itself would not be found.
// So find the existing key case-insensitively and extend that one.
const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") || "PATH";
env[pathKey] = `${binDir}${isWin ? ";" : ":"}${env[pathKey] || ""}`;
// A gate launched from inside a node:test process must not report to a parent and
// exit 0 - that is a silent pass (the kit strips these too).
for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];

const results = [];
let failed = 0;

for (const step of STEPS) {
  process.stdout.write(`gate: ${step.name} ... `);
  const started = Date.now();
  const r = spawnSync(step.cmd, step.args, {
    cwd: root,
    shell: isWin, // L1: npm.cmd / eslint.cmd need a shell on Windows
    encoding: "utf8",
    env,
    timeout: 30 * 60 * 1000,
  });
  const ok = r.status === 0;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(ok ? `ok (${secs}s)\n` : `FAIL (${secs}s)\n`);
  if (!ok) {
    failed++;
    const tail = `${r.stdout || ""}${r.stderr || ""}`.split(/\r?\n/).slice(-30).join("\n");
    process.stdout.write(tail.replace(/^/gm, "    | ") + "\n");
  }
  results.push({ name: step.name, ok, code: r.status, note: step.note });
}

// TAP summary: the verification recipe reads `# tests`, `# pass`, `# fail`.
const tap = [
  "TAP version 13",
  `# tests ${results.length}`,
  `# pass ${results.filter((x) => x.ok).length}`,
  `# fail ${failed}`,
  ...results.map((x, i) => `${x.ok ? "ok" : "not ok"} ${i + 1} - ${x.name} (${x.note})`),
  "",
].join("\n");

const stateDir = join(root, ".tins");
if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
writeFileSync(join(stateDir, "state-gate-last.tap"), tap);

process.stdout.write(tap);
process.stdout.write(
  failed === 0
    ? "gate: PASS\n"
    : `gate: FAIL (${failed} of ${results.length} step(s) failed)\n`,
);
process.exit(failed === 0 ? 0 : 1);
