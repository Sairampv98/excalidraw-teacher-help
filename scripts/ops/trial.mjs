#!/usr/bin/env node
/**
 * The trial of the watcher (D-589).
 *
 *   node scripts/ops/trial.mjs
 *
 * Plays a scripted afternoon through the watcher's own logic (no machine is
 * touched) and prints the lines it would print: memory falling, a gate starting
 * and failing with named tests, a stray session, a browser left behind, a stale
 * lock, the public branch moving, memory coming back. `trial.test.mjs` holds the
 * exact lines; a person can run it to see what an agent attached to the watcher
 * would be told.
 */

import { fileURLToPath } from "node:url";

import { evaluate, formatEvent, initialState } from "./lib/events.mjs";

const MIN = 60000;
const T0 = Date.UTC(2026, 10, 12, 14, 0, 0);

const quiet = (at, over = {}) => ({
  at: T0 + at * MIN,
  memory: { freeMB: 8200, totalMB: 14200 },
  disks: [{ path: "C:\\", freeGB: 80 }],
  lock: null,
  gates: [],
  sessions: [],
  processes: [],
  refs: { main: "a".repeat(40), publicDev: "b".repeat(40) },
  ...over,
});

const checkout = "C:/work/excalidraw.worktrees/v3b-2-hand-made-flows";
const lock = (at) => ({
  pid: 4242,
  alive: true,
  startedAt: T0 + 1 * MIN,
  root: checkout,
  tier: "fast",
  ...(at ? { alive: at.alive } : {}),
});
const failedGate = {
  root: checkout,
  ok: false,
  tier: "fast",
  minutes: 3.4,
  workers: 6,
  endedAt: T0 + 5 * MIN,
  steps: [
    { name: "typecheck", ok: true, seconds: 40, failures: [] },
    {
      name: "vitest related",
      ok: false,
      seconds: 120,
      failures: [
        {
          file: "packages/excalidraw/tests/flowManualArrows.test.tsx",
          test: "AC-588 deleting a generated arrow changes the steps",
        },
      ],
    },
  ],
};
const chrome = [
  { name: "chrome.exe", pid: 1, memMB: 2400 },
  { name: "chrome.exe", pid: 2, memMB: 1000 },
  { name: "vmwp.exe", pid: 3, memMB: 2100 },
];
const leftover = [{ name: "chrome-headless-shell.exe", pid: 9, memMB: 480 }];
const stray = { id: "fd7c78a9", task: null, isMain: true, startedAt: T0 };

/** what the machine looks like at each minute of the afternoon */
export const AFTERNOON = [
  quiet(0),
  quiet(0.25, { memory: { freeMB: 2300, totalMB: 14200 }, processes: chrome }),
  quiet(1, { lock: lock(), memory: { freeMB: 2300, totalMB: 14200 } }),
  quiet(5.5, { gates: [failedGate], memory: { freeMB: 2300, totalMB: 14200 } }),
  quiet(6, { memory: { freeMB: 1200, totalMB: 14200 }, gates: [failedGate] }),
  quiet(7, {
    sessions: [stray],
    memory: { freeMB: 1200, totalMB: 14200 },
    gates: [failedGate],
  }),
  quiet(8, { processes: leftover, gates: [failedGate] }),
  quiet(19, { processes: leftover, gates: [failedGate] }),
  quiet(20, {
    lock: lock({ alive: false }),
    processes: leftover,
    gates: [failedGate],
  }),
  quiet(21, {
    processes: leftover,
    gates: [failedGate],
    refs: {
      main: "c".repeat(40),
      publicDev: "d".repeat(40),
      publicSubject: "(describe the task here)",
    },
  }),
  quiet(22, {
    gates: [failedGate],
    refs: { main: "c".repeat(40), publicDev: "d".repeat(40) },
  }),
];

export const runTrial = (snapshots = AFTERNOON) => {
  let state = initialState();
  const lines = [];

  for (const snap of snapshots) {
    const result = evaluate(state, snap);

    state = result.state;
    lines.push(...result.events.map(formatEvent));
  }

  return lines;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const line of runTrial()) {
    console.log(line);
  }
}
