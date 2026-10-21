#!/usr/bin/env node
// Product gate for the excalidraw fork.
//
// The kit's own gate.mjs runs the shell commands in tins.json. This script is that
// command: it runs the fork's four verification gates and writes a TAP summary the
// kit and the verification recipe can read.
//
// Rules it encodes (from the playbook's lessons):
//   L1  Windows: a .cmd must be run with shell:true or spawnSync throws EINVAL.
//   L15 A worktree may not have its own node_modules; resolve the nearest one by
//       walking up from this script, so the gate also works in the throwaway
//       worktree `kit merge` builds inside the repository.
//
// What changed on 2026-10-21, and why (locked as D-69 in SPEC.md):
//   - tsc, eslint and prettier only READ files and do not depend on each other, so
//     they now run at the same time instead of one after another. The same steps,
//     the same commands, the same reporting, the same 30-minute timeout each.
//   - vitest still runs after them, because it is the step that writes and the one
//     that needs the machine's memory to itself. Its worker count is now derived
//     from the free memory and the CPU count instead of being a fixed number, and
//     GATE_JOBS overrides it (GATE_JOBS=1 gives vitest a single worker).
//   - a test that measures time or speed is run on its own afterwards, with a
//     single worker, so its measurement is not taken while the machine is busy.
//   - the gate refuses to start while another gate or a test run is in flight, and
//     waits for the machine to go quiet rather than letting two runs fight for
//     memory - which is how the OS ends up killing vitest's workers.
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { cpus, freemem, tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
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
    "gate: FAIL - no node_modules/.bin found above " +
      root +
      "\n" +
      "       run `yarn install` in the repository root first\n",
  );
  process.exit(1);
}

const isWin = process.platform === "win32";
const EXE = {
  tsc: "tsc",
  eslint: "eslint",
  prettier: "prettier",
  vitest: "vitest",
};

const STEP_TIMEOUT_MS = 30 * 60 * 1000;

const READ_STEPS = [
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
      // Two ignore paths, in this order, on purpose. Prettier honours only the
      // LAST --ignore-path it is given (measured: with .eslintignore first and
      // .gitignore last, the .eslintignore entries stopped applying). Putting
      // .gitignore first and .eslintignore last means the union is honoured
      // by .eslintignore, which carries the kit-specific exclusions.
      "--ignore-path=.gitignore",
      "--ignore-path=.eslintignore",
      "--list-different",
    ],
    note: "prettier --list-different",
  },
];

const VITEST_STEP = {
  name: "vitest",
  cmd: EXE.vitest,
  args: ["run"],
  note: "vitest run",
};

const env = { ...process.env, FORCE_COLOR: "0" };
// Put the resolved node_modules/.bin on PATH, the way yarn does. Without this the
// spawned `tsc` / `eslint` / `vitest` would not be found when the gate runs in a
// worktree that has no node_modules of its own.
//
// On Windows the real environment variable is `Path`, not `PATH`. Reading
// `env.PATH` would return undefined, and writing it back would clobber the real
// `Path` with "<bindir>;undefined" - and then `node` itself would not be found.
// So find the existing key case-insensitively and extend that one.
const pathKey =
  Object.keys(env).find((k) => k.toLowerCase() === "path") || "PATH";
env[pathKey] = `${binDir}${isWin ? ";" : ":"}${env[pathKey] || ""}`;
// A gate launched from inside a node:test process must not report to a parent and
// exit 0 - that is a silent pass (the kit strips these too).
for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];

// ---------------------------------------------------------------------------
// The machine must be quiet
// ---------------------------------------------------------------------------

/**
 * The gate takes a lock, so two gates never run at once.
 *
 * A process scan alone would deadlock: two gates would each see the other and
 * each wait for the other. The lock serialises them instead - the second waits
 * for the first to release it.
 *
 * The lock lives in the OS TEMP directory, NOT beside the script: a gate run
 * in a worktree (the throwaway one `kit merge` builds) and a gate run in the
 * repository root are two different roots, so a per-root lock would not
 * exclude them from each other. The temp directory is the one place they
 * share.
 */
const LOCK_FILE = join(tmpdir(), "excalidraw-tins-gate.lock");

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readLock = () => {
  try {
    return JSON.parse(readFileSync(LOCK_FILE, "utf8"));
  } catch {
    return null;
  }
};

const sleep = (ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    spawnSync(process.execPath, ["-e", `setTimeout(() => {}, ${ms})`], {
      encoding: "utf8",
    });
  }
};

const takeLock = () => {
  const deadline = Date.now() + STEP_TIMEOUT_MS;

  for (;;) {
    const held = readLock();

    if (!held || !isAlive(held.pid)) {
      // no lock, or the lock belongs to a process that is gone
      try {
        writeFileSync(
          LOCK_FILE,
          JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
          "utf8",
        );
      } catch {
        // the .tins directory may not exist yet
      }

      const mine = readLock();

      if (mine && mine.pid === process.pid) {
        return;
      }
    } else {
      if (Date.now() > deadline) {
        process.stderr.write(
          `gate: FAIL - another gate (pid ${held.pid}) has held the lock for 30 minutes\n`,
        );
        process.exit(1);
      }

      process.stdout.write(
        `gate: waiting for the gate that holds the lock (pid ${held.pid})\n`,
      );
    }

    sleep(5000);
  }
};

const releaseLock = () => {
  const held = readLock();

  if (held && held.pid === process.pid) {
    try {
      unlinkSync(LOCK_FILE);
    } catch {
      // already gone
    }
  }
};

process.on("exit", releaseLock);

/** the pid of every other process whose command line mentions a gate or a test run */
const otherGateProcesses = () => {
  if (!isWin) {
    return [];
  }

  const probe = spawnSync(
    "wmic",
    ["process", "get", "ProcessId,CommandLine", "/format:list"],
    { encoding: "utf8", windowsHide: true },
  );

  if (probe.status !== 0 || !probe.stdout) {
    return [];
  }

  // wmic's /format:list puts ONE key=value pair per line, and a blank line
  // between records. Reading the pairs a line at a time finds nothing, so the
  // records are assembled first and only then matched.
  const records = [];
  let record = {};

  for (const line of probe.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (record.ProcessId) {
        records.push(record);
      }
      record = {};
      continue;
    }

    const eq = trimmed.indexOf("=");

    if (eq > 0) {
      record[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  }

  if (record.ProcessId) {
    records.push(record);
  }

  const out = [];

  for (const record of records) {
    const text = record.CommandLine || "";

    if (!/\b(tins-gate|vitest)\b/.test(text)) {
      continue;
    }

    // our own command line mentions the script's path
    if (Number(record.ProcessId) === process.pid) {
      continue;
    }

    out.push({
      pid: Number(record.ProcessId),
      command: text.trim().slice(0, 120),
    });
  }

  return out;
};

const waitForQuietMachine = () => {
  const deadline = Date.now() + STEP_TIMEOUT_MS;

  for (;;) {
    const busy = otherGateProcesses().filter((p) => p.pid !== process.pid);

    if (!busy.length) {
      return;
    }

    if (Date.now() > deadline) {
      process.stderr.write(
        "gate: FAIL - another gate or test run is still in flight after 30 minutes\n" +
          busy.map((p) => `       pid ${p.pid}: ${p.command}\n`).join(""),
      );
      process.exit(1);
    }

    process.stdout.write(
      `gate: waiting for the machine to go quiet (${busy.length} gate/test process(es) in flight)\n`,
    );

    sleep(5000);
  }
};

// ---------------------------------------------------------------------------
// Running a step
// ---------------------------------------------------------------------------

/** runs one step, resolving with its exit code, its output and how long it took */
const runStep = (step) =>
  new Promise((resolveStep) => {
    const started = Date.now();

    const child = spawn(step.cmd, step.args, {
      cwd: root,
      shell: isWin, // L1: npm.cmd / eslint.cmd need a shell on Windows
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: STEP_TIMEOUT_MS,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, STEP_TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(killTimer);
      resolveStep({
        ...step,
        ok: false,
        code: null,
        secs: (Date.now() - started) / 1000,
        output: `${stdout}${stderr}\n${error.message}`,
        timedOut,
      });
    });

    child.on("close", (code) => {
      clearTimeout(killTimer);
      resolveStep({
        ...step,
        ok: code === 0 && !timedOut,
        code,
        secs: (Date.now() - started) / 1000,
        output: `${stdout}${stderr}`,
        timedOut,
      });
    });
  });

const report = (step) => {
  const secs = step.secs.toFixed(1);
  process.stdout.write(
    step.ok
      ? `gate: ${step.name} ... ok (${secs}s)\n`
      : `gate: ${step.name} ... FAIL (${secs}s)\n`,
  );

  if (!step.ok) {
    const tail = (step.output || "").split(/\r?\n/).slice(-30).join("\n");
    process.stdout.write(tail.replace(/^/gm, "    | ") + "\n");
  }
};

// ---------------------------------------------------------------------------
// The vitest worker count
// ---------------------------------------------------------------------------

/** the workers vitest may use, from the free memory and the CPU count */
const computeWorkers = (freeMB) => {
  const cpuThreads = cpus().length || 1;
  const byCpu = Math.floor(cpuThreads / 2);
  const byMemory = Math.floor((freeMB - 1500) / 600);

  return Math.max(1, Math.min(byCpu, byMemory));
};

const freeMemoryMB = () => Math.floor(freemem() / (1024 * 1024));

/** GATE_JOBS overrides the computed count; 1 gives vitest a single worker. */
const workersFromEnv = () => {
  const raw = process.env.GATE_JOBS;

  if (raw === undefined || raw === "") {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// ---------------------------------------------------------------------------
// The tests that measure time or speed
// ---------------------------------------------------------------------------

const TEST_DIRS = ["packages", "excalidraw-app"];
const TEST_FILE = /(\.|_)(test|spec)\.[jt]sx?$/;

/** every test file under the repository, relative to it */
const collectTestFiles = (dir, found = []) => {
  let entries;

  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      collectTestFiles(full, found);
    } else if (TEST_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
};

/**
 * A test that measures how long something took. It must run on its own, with a
 * single worker, or its measurement is taken while the machine is busy and
 * means nothing.
 */
const MEASURES_TIME = /(?:Date|performance)\.now\(\)\s*[-+]/;

const findTimingTests = () => {
  const files = [];

  for (const dir of TEST_DIRS) {
    const base = join(root, dir);

    if (!existsSync(base)) {
      continue;
    }

    for (const file of collectTestFiles(base)) {
      let text;

      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }

      if (MEASURES_TIME.test(text)) {
        files.push(relative(root, file).split(sep).join("/"));
      }
    }
  }

  return files.sort();
};

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

const results = [];
let failed = 0;

const startedAt = Date.now();

// the lock lives here, so the directory has to exist first
if (!existsSync(join(root, ".tins"))) {
  mkdirSync(join(root, ".tins"), { recursive: true });
}

takeLock();
waitForQuietMachine();

process.stdout.write(
  `gate: ${READ_STEPS.map((s) => s.name).join(", ")} ... running in parallel\n`,
);

const readResults = await Promise.all(READ_STEPS.map(runStep));

// reported in the order the steps are declared, not the order they finished
for (const step of READ_STEPS) {
  const result = readResults.find((r) => r.name === step.name);
  report(result);
  results.push(result);
  if (!result.ok) {
    failed++;
  }
}

const freeBeforeVitest = freeMemoryMB();
const computedWorkers = computeWorkers(freeBeforeVitest);
const workers = workersFromEnv() ?? computedWorkers;

const vitestArgs = [
  ...VITEST_STEP.args,
  `--maxWorkers=${workers}`,
  "--minWorkers=1",
];

const vitestResult = await runStep({
  ...VITEST_STEP,
  args: vitestArgs,
  note: `${VITEST_STEP.note} --maxWorkers=${workers} --minWorkers=1`,
});

const timingTests = findTimingTests();
let timingResult = null;

if (timingTests.length) {
  // the measurement is taken on its own, with a single worker, so it is not
  // distorted by the rest of the suite
  process.stdout.write(
    `gate: timing test ... ${timingTests.join(", ")} (single worker)\n`,
  );

  timingResult = await runStep({
    ...VITEST_STEP,
    name: "timing test",
    args: [
      ...VITEST_STEP.args,
      ...timingTests,
      "--maxWorkers=1",
      "--minWorkers=1",
    ],
    note: `vitest run ${timingTests.join(" ")} --maxWorkers=1`,
  });
}

report(vitestResult);
results.push(vitestResult);
if (!vitestResult.ok) {
  failed++;
}

if (timingResult) {
  report(timingResult);
  if (!timingResult.ok) {
    failed++;
  }
}

const totalMinutes = (Date.now() - startedAt) / 60000;

const summary =
  `gate: workers ${workers}, free ${freeBeforeVitest}MB before vitest, ` +
  `total ${totalMinutes.toFixed(1)}min` +
  (timingTests.length ? `, ${timingTests.length} timing test(s) isolated` : "");

process.stdout.write(summary + "\n");

// The kit shows only PASS or FAIL, so the numbers go to a file as well.
const stateDir = join(root, ".tins");
if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
writeFileSync(join(stateDir, "state-gate-summary.txt"), summary + "\n");

// TAP summary: the verification recipe reads `# tests`, `# pass`, `# fail`.
const tap = [
  "TAP version 13",
  `# tests ${results.length}`,
  `# pass ${results.filter((x) => x.ok).length}`,
  `# fail ${failed}`,
  ...results.map(
    (x, i) => `${x.ok ? "ok" : "not ok"} ${i + 1} - ${x.name} (${x.note})`,
  ),
  "",
].join("\n");

writeFileSync(join(stateDir, "state-gate-last.tap"), tap);

process.stdout.write(tap);
process.stdout.write(
  failed === 0
    ? "gate: PASS\n"
    : `gate: FAIL (${failed} of ${results.length} step(s) failed)\n`,
);
process.exit(failed === 0 ? 0 : 1);
