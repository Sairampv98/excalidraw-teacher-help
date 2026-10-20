#!/usr/bin/env node
// rowcheck - the fast feedback loop.
//
// The full gate runs 120 test files and takes minutes. A builder working on one
// acceptance row needs to know whether THAT row is green in seconds.
//
//   node scripts/rowcheck.mjs AC-1 AC-2
//   node scripts/rowcheck.mjs --all
//
// It reads SPEC.md, finds the check file each row names, and runs vitest on just
// those files. It also reports which rows have no test yet, so a missing test is
// visible rather than silent.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/** The SPEC.md row parser, mirrored from .tins/kit/src/spec.mjs so both agree. */
const ROW = /^\|\s*((?:D|AC)-\d+)\s*\|(.*)\|\s*$/;
function parseSpec(text) {
  const rows = [];
  text.split(/\r?\n/).forEach((l, i) => {
    const m = l.match(ROW);
    if (m) rows.push({ id: m[1], cells: m[2].split("|").map((c) => c.trim()), line: i + 1 });
  });
  return rows;
}

function findBinDir(start) {
  let d = start;
  for (let i = 0; i < 10; i++) {
    const c = join(d, "node_modules", ".bin");
    if (existsSync(c)) return c;
    const p = dirname(d);
    if (p === d) break;
    d = p;
  }
  return null;
}

const specPath = join(root, "SPEC.md");
if (!existsSync(specPath)) {
  process.stderr.write("rowcheck: no SPEC.md\n");
  process.exit(2);
}
const rows = parseSpec(readFileSync(specPath, "utf8")).filter((r) =>
  r.id.startsWith("AC-"),
);

const args = process.argv.slice(2);
const wantAll = args.includes("--all");
const wanted = args.filter((a) => !a.startsWith("--"));
const selected = wantAll ? rows : rows.filter((r) => wanted.includes(r.id));

if (!selected.length) {
  process.stderr.write(
    `rowcheck: no acceptance rows matched${wanted.length ? `: ${wanted.join(", ")}` : ""}\n` +
      `known rows: ${rows.map((r) => r.id).join(", ")}\n`,
  );
  process.exit(2);
}

const binDir = findBinDir(root);
if (!binDir) {
  process.stderr.write("rowcheck: no node_modules/.bin found; run `yarn install`\n");
  process.exit(2);
}

const files = [];
const missing = [];
const missingId = [];
for (const r of selected) {
  const check = r.cells[1] || "";
  if (/^manual\b/i.test(check)) {
    process.stdout.write(`${r.id}: manual - nothing to run\n`);
    continue;
  }
  for (const f of check.split(/[,\s]+/).map((s) => s.replace(/`/g, "")).filter(Boolean)) {
    const abs = join(root, f);
    if (!existsSync(abs)) {
      missing.push(`${r.id} -> ${f}`);
      continue;
    }
    if (!readFileSync(abs, "utf8").includes(r.id)) missingId.push(`${r.id} not mentioned in ${f}`);
    if (!files.includes(abs)) files.push(abs);
  }
}

for (const m of missing) process.stdout.write(`MISSING FILE  ${m}\n`);
for (const m of missingId) process.stdout.write(`MISSING ID    ${m}\n`);

if (!files.length) {
  process.stdout.write("rowcheck: nothing to run\n");
  process.exit(missing.length || missingId.length ? 1 : 0);
}

const rel = files.map((f) => f.slice(root.length + 1).replace(/\\/g, "/"));
process.stdout.write(`rowcheck: running ${rel.length} file(s)\n  ${rel.join("\n  ")}\n`);

const env = { ...process.env, FORCE_COLOR: "0" };
// Extend the existing PATH key rather than writing a new `PATH` one: on Windows
// the real variable is `Path`, and clobbering it would hide `node` from the child.
const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") || "PATH";
env[pathKey] = `${binDir}${process.platform === "win32" ? ";" : ":"}${env[pathKey] || ""}`;
for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];

const r = spawnSync("vitest", ["run", ...rel], {
  cwd: root,
  shell: process.platform === "win32",
  stdio: "inherit",
  env,
  timeout: 20 * 60 * 1000,
});

process.exit(r.status === 0 && !missing.length && !missingId.length ? 0 : 1);
