#!/usr/bin/env node
/**
 * The check to run BEFORE a gate (D-586).
 *
 *   node scripts/ops/pregate.mjs
 *
 * It does what the gate would find first, on what you changed, in a few minutes
 * and without taking the gate's lock: the SPEC lint, prettier and eslint on the
 * changed files, the typecheck, and the tests a change can reach plus the tests
 * of the scripts. A gate that follows a clean pre-gate rarely fails.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  TEST_FILE,
  changedSources,
  fastPlans,
  gateCacheDir,
} from "./lib/gatePlan.mjs";
import { pregateSteps } from "./lib/opsPlan.mjs";
import { missingPublicSection, warningsForFile } from "./lib/publicLingo.mjs";
import { isDenied } from "../public-sync/guard.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const isWin = process.platform === "win32";

const findBin = (start) => {
  let dir = start;

  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, "node_modules", ".bin");

    if (fs.existsSync(candidate)) {
      return candidate;
    }

    dir = path.dirname(dir);
  }

  return null;
};

const bin = findBin(root);

if (!bin) {
  console.error(
    "pregate: no node_modules/.bin found; run `yarn install` first",
  );
  process.exit(2);
}

const env = { ...process.env, FORCE_COLOR: "0" };
const pathKey =
  Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";

env[pathKey] = `${bin}${isWin ? ";" : ":"}${env[pathKey] ?? ""}`;

const git = (args) =>
  spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout ?? "";
const base = git(["merge-base", "HEAD", "main"]).trim() || "HEAD~1";
const everything = changedSources(
  git(["diff", "--name-only", base]),
  git(["ls-files", "--others", "--exclude-standard"]),
);
// prettier also checks documents the gate's other steps do not reach
const documents = [
  ...git(["diff", "--name-only", base]).split(/\r?\n/),
  ...git(["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/),
]
  .map((line) => line.trim())
  .filter(Boolean);

const steps = pregateSteps({
  changed: everything,
  allChanged: documents,
  cacheDir: gateCacheDir(root, os.tmpdir()),
});

fs.mkdirSync(gateCacheDir(root, os.tmpdir()), { recursive: true });

let failed = 0;
const run = (name, cmd, args) => {
  const started = Date.now();
  const result = spawnSync(cmd, args, {
    cwd: root,
    env,
    shell: isWin,
    encoding: "utf8",
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0;

  console.log(`pregate: ${name} ... ${ok ? "ok" : "FAIL"} (${secs}s)`);

  if (!ok) {
    failed++;
    console.log(
      `${result.stdout ?? ""}${result.stderr ?? ""}`
        .split(/\r?\n/)
        .slice(-25)
        .map((line) => `    | ${line}`)
        .join("\n"),
    );
  }
};

console.log(
  `pregate: ${everything.length} changed source file(s) since ${base.slice(
    0,
    7,
  )}`,
);

for (const step of steps) {
  if (step.kind === "spec") {
    const started = Date.now();
    const spec = await import(
      pathToFileURL(path.join(root, ".tins", "kit", "src", "spec.mjs")).href
    );
    const problems = spec.lintSpec(
      fs.readFileSync(path.join(root, "SPEC.md"), "utf8"),
      root,
    );

    console.log(
      `pregate: spec lint ... ${problems.length ? "FAIL" : "ok"} (${(
        (Date.now() - started) /
        1000
      ).toFixed(1)}s)`,
    );

    if (problems.length) {
      failed++;
      console.log(
        problems
          .slice(0, 10)
          .map((p) => `    | ${p}`)
          .join("\n"),
      );
    }
  } else {
    run(step.name, step.cmd, step.args);
  }
}

// the tests a change reaches, and always the tests of the scripts
const scriptsTests = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full);
    } else if (TEST_FILE.test(entry.name)) {
      scriptsTests.push(path.relative(root, full).split(path.sep).join("/"));
    }
  }
};

walk(path.join(root, "scripts"));

for (const plan of fastPlans({
  changed: everything,
  scriptsTests: scriptsTests.sort(),
})) {
  run(plan.name, "vitest", plan.args);
}

// the public wording (D-594): warnings only, they never fail the pre-gate
const config = JSON.parse(
  fs.readFileSync(path.join(root, "scripts/public-sync/config.json"), "utf8"),
);
const map = JSON.parse(
  fs.readFileSync(
    path.join(root, "scripts/public-sync/rewrite-map.json"),
    "utf8",
  ),
);
const published = documents.filter(
  (file) =>
    !isDenied(file, config.deny) && fs.existsSync(path.join(root, file)),
);
const warnings = [];

for (const file of published) {
  if (!/\.(?:[cm]?[jt]sx?|s?css|md|ya?ml|sh|ps1|py)$/i.test(file)) {
    continue;
  }

  warnings.push(
    ...warningsForFile({
      path: file,
      oldText: git(["show", `${base}:${file}`]),
      newText: fs.readFileSync(path.join(root, file), "utf8"),
      map,
    }),
  );
}

const branch = git(["branch", "--show-current"]).trim();
const taskFile = path.join(
  root,
  "tasks",
  `${branch.replace(/^task\//, "")}.md`,
);

if (branch.startsWith("task/") && fs.existsSync(taskFile)) {
  warnings.push(
    ...missingPublicSection({
      taskText: fs.readFileSync(taskFile, "utf8"),
      publishedFiles: published,
    }),
  );
}

for (const warning of warnings) {
  console.log(`pregate: WARN ${warning}`);
}

console.log(
  failed
    ? `pregate: FAIL (${failed} check(s)${
        warnings.length ? `, ${warnings.length} warning(s)` : ""
      })`
    : `pregate: PASS${
        warnings.length
          ? ` (${warnings.length} warning(s) about public wording)`
          : ""
      }`,
);
process.exit(failed ? 1 : 0);
