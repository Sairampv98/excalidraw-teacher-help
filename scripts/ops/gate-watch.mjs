#!/usr/bin/env node
/**
 * The watcher (D-588, D-589).
 *
 *   node scripts/ops/gate-watch.mjs [--interval 15] [--public <clone>] [--out <folder>] [--once]
 *
 * Every few seconds it takes a snapshot of the machine (free memory, free disk,
 * the gate lock and the result of each checkout's last gate, the open kit
 * sessions, the browsers a run may have left, and where the private `main` and
 * the public `dev` are), and PRINTS ONE LINE for each event: something that
 * crossed a line. An agent attaches to that stream (the Monitor tool of Claude
 * Code reads a command's lines as notifications); a person can read it in a
 * terminal, `events.jsonl`, or `status.json`, all in the folder named at the start.
 */

import fs from "node:fs";
import path from "node:path";

import { findMainRoot, opsDir, takeSnapshot } from "./lib/collect.mjs";
import {
  buildStatus,
  evaluate,
  formatEvent,
  initialState,
} from "./lib/events.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);

  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const once = args.includes("--once");
// more places whose free space is worth watching: --disk D:\workspace --disk E:\
const extraDisks = args.flatMap((arg, i) =>
  arg === "--disk" && args[i + 1] ? [args[i + 1]] : [],
);
const intervalSeconds = Math.max(2, Number(option("interval", "15")) || 15);
const mainRoot = findMainRoot(process.cwd());

if (!mainRoot) {
  console.error("gate-watch: this is not inside the repository");
  process.exit(2);
}

const publicRoot = option(
  "public",
  path.join(path.dirname(mainRoot), "excalidraw-public"),
);
const out = option("out", opsDir());

fs.mkdirSync(out, { recursive: true });

// one watcher at a time: two would say everything twice
const pidFile = path.join(out, "watcher.pid");

if (!once) {
  try {
    const other = Number(fs.readFileSync(pidFile, "utf8"));

    if (other && other !== process.pid) {
      try {
        process.kill(other, 0);
        console.error(`gate-watch: already running (pid ${other})`);
        process.exit(3);
      } catch {
        // a leftover file of a watcher that is gone
      }
    }
  } catch {
    // no file yet
  }

  fs.writeFileSync(pidFile, String(process.pid));
  process.on("exit", () => {
    try {
      if (Number(fs.readFileSync(pidFile, "utf8")) === process.pid) {
        fs.unlinkSync(pidFile);
      }
    } catch {
      // already gone
    }
  });
}

let state = initialState();
const recent = [];

const look = () => {
  const snap = takeSnapshot({ mainRoot, publicRoot, extraDisks });
  const result = evaluate(state, snap);

  state = result.state;

  for (const e of result.events) {
    process.stdout.write(`${formatEvent(e)}\n`);
    fs.appendFileSync(path.join(out, "events.jsonl"), `${JSON.stringify(e)}\n`);
    recent.push(e);
  }

  recent.splice(0, Math.max(0, recent.length - 20));
  fs.writeFileSync(
    path.join(out, "status.json"),
    JSON.stringify(buildStatus(snap, state, recent), null, 2),
  );

  return snap;
};

if (once) {
  const snap = look();

  console.log(JSON.stringify(buildStatus(snap, state, recent), null, 2));
  process.exit(0);
}

process.stdout.write(
  `watching every ${intervalSeconds}s: memory, disk, gates, sessions, browsers, main and the public dev; files in ${out}\n`,
);
look();
setInterval(look, intervalSeconds * 1000);
