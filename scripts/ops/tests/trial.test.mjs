/**
 * AC-686 - the trial of the watcher (D-589): a scripted afternoon gives exactly
 * these lines, and the real watcher starts, looks once and writes its files.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AFTERNOON, runTrial } from "../trial.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** the clock of a line depends on the time zone of the machine; the rest does not */
const withoutClock = (line) => line.replace(/^\d\d:\d\d:\d\d /, "");

describe("AC-686 a scripted afternoon", () => {
  const lines = runTrial().map(withoutClock);

  it("tells each thing that happened, once, in order", () => {
    expect(lines.map((line) => line.split(":")[0])).toEqual([
      "WARN memory",
      "INFO gate",
      "ALERT gate",
      "ALERT memory",
      "ALERT session",
      "INFO memory",
      "WARN browser",
      "WARN gate",
      "INFO main",
      "ALERT public",
    ]);
  });

  it("names the biggest users of the memory, so the person knows what to close", () => {
    expect(lines[0]).toContain("biggest: chrome 3.3 GB, vmwp 2.1 GB");
  });

  it("says which tests failed and in which checkout", () => {
    expect(lines[2]).toContain("FAIL in v3b-2-hand-made-flows");
    expect(lines[2]).toContain(
      "flowManualArrows.test.tsx > AC-588 deleting a generated arrow changes the steps",
    );
  });

  it("alerts on a session open on main with no task, and on the public branch moving", () => {
    expect(lines[4]).toContain("fd7c78a9 is open on main with no task");
    expect(lines[9]).toContain("PUBLIC dev moved bbbbbbb -> ddddddd");
    expect(lines[9]).toContain("something went public");
  });

  it("says nothing more when the same afternoon is played on after its end", () => {
    const again = runTrial([...AFTERNOON, AFTERNOON[AFTERNOON.length - 1]]);

    expect(again).toHaveLength(lines.length);
  });
});

describe("AC-686 the real watcher", () => {
  it("starts, looks once, and writes its status and says where", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "watch-trial-"));
    const result = spawnSync(
      process.execPath,
      [path.join(here, "..", "gate-watch.mjs"), "--once", "--out", out],
      {
        encoding: "utf8",
        timeout: 30000,
        cwd: path.join(here, "..", "..", ".."),
      },
    );

    try {
      expect(result.status).toBe(0);

      const status = JSON.parse(
        fs.readFileSync(path.join(out, "status.json"), "utf8"),
      );

      expect(status.memory.totalMB).toBeGreaterThan(0);
      expect(status.gate).toHaveProperty("running");
      expect(Array.isArray(status.sessions)).toBe(true);
      expect(Array.isArray(status.recentEvents)).toBe(true);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
