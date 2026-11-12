/**
 * The plan of the gate, as pure functions (D-581 to D-585).
 *
 * `scripts/tins-gate.mjs` runs the commands; what to run, what to leave out and
 * what to stop on is decided here, so that each decision can be tested without
 * running a gate that takes minutes.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";

/**
 * What a test file is called, including the `.mjs` tests of the scripts (a
 * pattern without them made the fast tier skip every test of the scripts).
 */
export const TEST_FILE = /(\.|_)(test|spec)\.[cm]?[jt]sx?$/;

const truthy = (value) => /^(1|true|yes)$/i.test(String(value ?? ""));

/** `full` runs every test; `fast` (GATE_FAST=1) runs what a change can reach (D-583) */
export const selectTier = (env = {}) =>
  truthy(env.GATE_FAST) ? "fast" : "full";

/** GATE_KEEP_GOING=1 runs the tests even when a static check has failed (D-582) */
export const keepsGoing = (env = {}) => truthy(env.GATE_KEEP_GOING);

/** the tests are not worth minutes when typecheck, lint or format has already failed (D-582) */
export const shouldRunTests = ({ staticFailed, env = {} }) =>
  !staticFailed || keepsGoing(env);

/** the files vitest leaves out of the big run, because they are measured alone (D-581) */
export const excludeArgs = (timingTests) =>
  timingTests.flatMap((file) => ["--exclude", file]);

/** where the caches of one checkout live: outside the repository, one folder for each checkout */
export const gateCacheDir = (root, temp) =>
  join(
    temp,
    "excalidraw-gate-cache",
    createHash("sha1").update(root).digest("hex").slice(0, 12),
  );

/**
 * The cache flags of the three static checks (D-584). They compare file
 * contents, not times, so a fresh checkout or a moved file cannot make a stale
 * answer pass.
 */
export const cacheArgs = (dir) => ({
  typecheck: [
    "--incremental",
    "--tsBuildInfoFile",
    join(dir, "tsc.tsbuildinfo"),
  ],
  eslint: [
    "--cache",
    "--cache-strategy",
    "content",
    "--cache-location",
    join(dir, "eslint-cache"),
  ],
  prettier: [
    "--cache",
    "--cache-strategy",
    "content",
    "--cache-location",
    join(dir, "prettier-cache"),
  ],
});

/** files whose tests a change can reach: the sources and tests of the packages, the app and the scripts */
const REACHABLE =
  /^(packages|excalidraw-app|scripts)\/.+\.(mjs|js|jsx|ts|tsx|json)$/;

/** the lines of `git diff --name-only` and `git ls-files --others`, kept to what can reach a test */
export const changedSources = (...outputs) => [
  ...new Set(
    outputs
      .flatMap((text) => String(text ?? "").split(/\r?\n/))
      .map((line) => line.trim().replace(/\\/g, "/"))
      .filter((line) => REACHABLE.test(line)),
  ),
];

/**
 * The vitest runs of the fast tier (D-583): the tests that import what changed,
 * and always the tests of the scripts, which hold the rules about the SPEC, the
 * handoff file and the mirror and which no import graph connects to a change.
 */
export const fastPlans = ({ changed, scriptsTests }) => {
  const plans = [];

  if (changed.length) {
    plans.push({
      name: "vitest related",
      // a change that no test reaches is not a failure
      args: ["related", ...changed, "--run", "--passWithNoTests"],
    });
  }

  if (scriptsTests.length) {
    plans.push({ name: "vitest scripts", args: ["run", ...scriptsTests] });
  }

  return plans;
};

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

/** the tests a vitest output names as failed: `FAIL  file > suite > test` */
export const parseFailures = (output) => {
  const seen = new Set();
  const found = [];

  for (const raw of String(output ?? "").split(/\r?\n/)) {
    const line = raw.replace(ANSI, "").replace(/^[\s|]+/, "");
    const match = /^FAIL\s+(\S+?)(?:\s+>\s+(.+))?$/.exec(line);

    if (!match) {
      continue;
    }

    const key = `${match[1]}|${match[2] ?? ""}`;

    if (!seen.has(key)) {
      seen.add(key);
      found.push({ file: match[1], test: match[2] ?? "" });
    }
  }

  return found;
};

/** the shared folder of the watcher and of the records of the gates, in the temp folder */
export const opsFolder = (temp) => join(temp, "excalidraw-ops");

/**
 * Where the record of one checkout's last gate is kept (D-585): in the shared
 * folder, one file for each checkout, and NOT in the repository. A file in the
 * checkout is picked up by the kit's commit at close and counts as a change
 * outside the task's paths.
 */
export const resultFile = (temp, root) =>
  join(
    opsFolder(temp),
    "gate-results",
    `${createHash("sha1").update(root).digest("hex").slice(0, 12)}.json`,
  );

/** what one gate left behind, for the people and the watcher who read it (D-585) */
export const buildResult = ({
  root,
  tier,
  steps,
  workers,
  freeMB,
  startedAt,
  endedAt,
  timingTests = [],
  skipped = [],
}) => ({
  root,
  tier,
  ok: steps.every((step) => step.ok),
  startedAt,
  endedAt,
  minutes: Number(((endedAt - startedAt) / 60000).toFixed(2)),
  workers,
  freeMB,
  timingTests,
  skipped,
  steps: steps.map((step) => ({
    name: step.name,
    ok: step.ok,
    seconds: Number(step.secs.toFixed(1)),
    failures: step.ok ? [] : parseFailures(step.output),
  })),
});
