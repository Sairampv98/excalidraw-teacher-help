#!/usr/bin/env node
/**
 * Runs a gate the way a session should (D-587).
 *
 *   node scripts/ops/gate-run.mjs close [--note "..."] [--fast] [--jobs N] [--force]
 *   node scripts/ops/gate-run.mjs merge <task> [--jobs N]
 *
 * It puts Node 20.19.6 first on the PATH, says how much memory is free and what
 * uses it before a gate starts, runs the kit command in this checkout, keeps the
 * whole output in a log in the shared folder, and ends with one line that says
 * PASS or FAIL, the minutes and where the log is. The gate itself waits for any
 * other gate (its lock is shared by every checkout), so a second session's run
 * simply says "waiting" and starts afterwards.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  findMainRoot,
  opsDir,
  readMemory,
  readProcesses,
} from "./lib/collect.mjs";
import {
  buildEnv,
  kitArgs,
  logPath,
  memoryAdvice,
  parseRunArgs,
  runProblem,
} from "./lib/opsPlan.mjs";

const plan = parseRunArgs(process.argv.slice(2));
const problem = runProblem(plan);

if (problem) {
  console.error(`gate-run: ${problem}`);
  process.exit(2);
}

const folder = process.cwd();
const localAppData = process.env.LOCALAPPDATA;
const nodeDir =
  localAppData && fs.existsSync(path.join(localAppData, "nvm", "v20.19.6"))
    ? path.join(localAppData, "nvm", "v20.19.6")
    : null;
const gitDir = fs.existsSync("C:\\Program Files\\Git\\cmd")
  ? "C:\\Program Files\\Git\\cmd"
  : null;

// merge runs from the main checkout, close from the task's own
const root = plan.kind === "merge" ? findMainRoot(folder) ?? folder : folder;
const kit = path.join(root, ".tins", "kit", "bin", "kit.mjs");

if (!fs.existsSync(kit)) {
  console.error(`gate-run: no kit at ${kit}; run this from the repository`);
  process.exit(2);
}

const memory = readMemory();
const users = Object.values(
  readProcesses().reduce((byName, p) => {
    byName[p.name] = byName[p.name] ?? { name: p.name, memMB: 0 };
    byName[p.name].memMB += p.memMB;

    return byName;
  }, {}),
)
  .sort((a, b) => b.memMB - a.memMB)
  .slice(0, 3);
const advice = memoryAdvice({
  freeMB: memory.freeMB,
  minFreeMB: plan.minFreeMB,
  users,
});

if (advice) {
  console.log(`gate-run: ${advice}`);

  if (memory.freeMB < 1500 && !plan.force) {
    console.error(
      "gate-run: refusing to start with so little memory (--force starts anyway)",
    );
    process.exit(4);
  }
}

const startedAt = Date.now();
const log = logPath(opsDir(), plan, path.basename(folder), startedAt);

fs.mkdirSync(path.dirname(log), { recursive: true });

const out = fs.createWriteStream(log);
const tier = plan.fast ? "fast" : "full";

console.log(
  `gate-run: ${plan.kind}${plan.task ? ` ${plan.task}` : ""}, ${tier} gate, ${(
    memory.freeMB / 1024
  ).toFixed(1)} GB free, log ${log}`,
);

const child = spawn(process.execPath, [kit, ...kitArgs(plan)], {
  cwd: root,
  env: buildEnv(process.env, {
    nodeDir,
    gitDir,
    fast: plan.fast,
    jobs: plan.jobs,
  }),
  stdio: ["ignore", "pipe", "pipe"],
});

for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    out.write(chunk);
    process.stdout.write(chunk);
  });
}

child.on("close", (code) => {
  const minutes = ((Date.now() - startedAt) / 60000).toFixed(1);

  out.end();
  console.log(
    `gate-run: ${code === 0 ? "PASS" : "FAIL"} (${plan.kind}${
      plan.task ? ` ${plan.task}` : ""
    }, ${minutes} min, exit ${code}), log ${log}`,
  );
  fs.writeFileSync(
    path.join(opsDir(), "gates", "last.json"),
    JSON.stringify({
      kind: plan.kind,
      task: plan.task,
      folder,
      tier,
      ok: code === 0,
      minutes: Number(minutes),
      log,
      endedAt: Date.now(),
    }),
  );
  process.exit(code ?? 1);
});
