/**
 * The pure parts of the pre-gate script and of the gate wrapper (D-586, D-587).
 */

import { join } from "node:path";

import { cacheArgs } from "./gatePlan.mjs";

/** the same patterns the gate gives prettier and eslint (scripts/tins-gate.mjs) */
const PRETTIER_FILES = /\.(css|scss|json|md|html|yml)$/;
const ESLINT_FILES = /\.(js|ts|tsx)$/;

/**
 * The checks of the pre-gate for what changed: the SPEC lint, prettier and
 * eslint on the files that changed (the gate checks all of them; a person
 * checks what they touched), the typecheck, and the tests a change reaches.
 */
export const pregateSteps = ({ changed, allChanged = changed, cacheDir }) => {
  const caches = cacheDir ? cacheArgs(cacheDir) : {};
  const steps = [{ name: "spec lint", kind: "spec" }];
  const formatted = allChanged.filter((file) => PRETTIER_FILES.test(file));
  const linted = changed.filter((file) => ESLINT_FILES.test(file));

  if (formatted.length) {
    steps.push({
      name: "prettier",
      cmd: "prettier",
      args: [
        ...formatted,
        "--ignore-path=.gitignore",
        "--ignore-path=.eslintignore",
        "--list-different",
        ...(caches.prettier ?? []),
      ],
    });
  }

  if (linted.length) {
    steps.push({
      name: "eslint",
      cmd: "eslint",
      args: ["--max-warnings=0", ...linted, ...(caches.eslint ?? [])],
    });
  }

  steps.push({
    name: "typecheck",
    cmd: "tsc",
    args: [...(caches.typecheck ?? [])],
  });

  return steps;
};

/** the options of `gate-run.mjs close|merge ...` */
export const parseRunArgs = (argv) => {
  const [kind, ...rest] = argv;
  const plan = {
    kind,
    task: null,
    note: null,
    fast: false,
    jobs: null,
    force: false,
    minFreeMB: 4000,
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];

    if (arg === "--fast") {
      plan.fast = true;
    } else if (arg === "--force") {
      plan.force = true;
    } else if (arg === "--note") {
      plan.note = rest[++i] ?? null;
    } else if (arg === "--jobs") {
      plan.jobs = Number(rest[++i]) || null;
    } else if (arg === "--min-free-mb") {
      plan.minFreeMB = Number(rest[++i]) || plan.minFreeMB;
    } else if (!arg.startsWith("--") && !plan.task) {
      plan.task = arg;
    }
  }

  return plan;
};

/** what the person is told when the problem is that the arguments are wrong, or null */
export const runProblem = (plan) => {
  if (plan.kind !== "close" && plan.kind !== "merge") {
    return "the first word is close or merge";
  }

  if (plan.kind === "merge" && !plan.task) {
    return "merge needs the id of the task";
  }

  return null;
};

/** the kit's arguments for the run */
export const kitArgs = (plan) =>
  plan.kind === "merge"
    ? ["merge", plan.task]
    : ["close", ...(plan.note ? ["--note", plan.note] : [])];

/**
 * The environment of the run: Node 20.19.6 first on the PATH (the gate fails on
 * the shell's default Node), Git on the PATH, the tier, and the workers only when
 * the person asks (otherwise the gate counts them from the free memory).
 */
export const buildEnv = (base, { nodeDir, gitDir, fast, jobs }) => {
  const env = { ...base };
  const key =
    Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  const sep = process.platform === "win32" ? ";" : ":";
  const front = [nodeDir, gitDir].filter(Boolean);

  env[key] = [...front, env[key] ?? ""].join(sep);
  delete env.GATE_JOBS;

  if (jobs) {
    env.GATE_JOBS = String(jobs);
  }

  if (fast) {
    env.GATE_FAST = "1";
  }

  return env;
};

/** the advice before a gate, from the free memory and the biggest users; null when there is nothing to say */
export const memoryAdvice = ({ freeMB, minFreeMB, users }) => {
  if (freeMB >= minFreeMB) {
    return null;
  }

  const list = users.length
    ? ` Biggest: ${users
        .map((u) => `${u.name} ${(u.memMB / 1024).toFixed(1)} GB`)
        .join(", ")}.`
    : "";

  return `only ${(freeMB / 1024).toFixed(
    1,
  )} GB free (the gate runs best with ${(minFreeMB / 1024).toFixed(
    1,
  )} GB or more): close a browser or a virtual machine first.${list}`;
};

/** the name of a log file: the task or the folder, and the time */
export const logName = ({ kind, task, folder, at }) => {
  const stamp = new Date(at).toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const who = (task ?? folder).replace(/[^\w.-]+/g, "_");

  return `${who}-${kind}-${stamp}.log`;
};

export const logPath = (dir, plan, folder, at) =>
  join(dir, "gates", logName({ kind: plan.kind, task: plan.task, folder, at }));
