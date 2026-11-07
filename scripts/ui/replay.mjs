#!/usr/bin/env node
/* eslint-disable no-console */
// Opens the real browser on one scenario, slowly, and leaves the window open so you can look and try.
//
//   node scripts/ui/replay.mjs <scenario id or row>        e.g.  fly-switch   or   AC-538
//   options: --slow <ms> (default 600)   --hold <s> (default 60)
import { main } from "./run.mjs";

const [target, ...rest] = process.argv.slice(2);

if (!target) {
  console.error(
    "usage: node scripts/ui/replay.mjs <scenario id or row> [--slow ms] [--hold s]",
  );
  process.exit(2);
}

const has = (flag) => rest.includes(flag);
const argv = [
  target.startsWith("AC-") || target.startsWith("D-") ? "--rows" : "--only",
  target,
  "--headed",
];

if (!has("--slow")) {
  argv.push("--slow", "600");
}
if (!has("--hold")) {
  argv.push("--hold", "60");
}

main([...argv, ...rest]).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(2);
  },
);
