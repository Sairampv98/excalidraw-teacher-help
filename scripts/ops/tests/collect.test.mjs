/**
 * AC-685 (the readers of the watcher, D-588): what the watcher reads from the
 * machine is read right, from folders and files a test makes.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseTasklist,
  parseWorktrees,
  readDisks,
  readGateResults,
  readLock,
  readMemory,
  readSessions,
} from "../lib/collect.mjs";

const made = [];
const folder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collect-"));

  made.push(dir);

  return dir;
};

afterEach(() => {
  while (made.length) {
    fs.rmSync(made.pop(), { recursive: true, force: true });
  }
});

describe("AC-685 the readers", () => {
  it("reads the free and the total memory in megabytes", () => {
    const memory = readMemory();

    expect(memory.totalMB).toBeGreaterThan(memory.freeMB);
    expect(memory.freeMB).toBeGreaterThan(0);
  });

  it("reads the free space of the drive of a path, once for each drive", () => {
    const here = folder();
    const disks = readDisks([here, path.join(here, "a"), here]);

    expect(disks).toHaveLength(1);
    expect(disks[0].freeGB).toBeGreaterThan(0);
  });

  it("reads the gate lock and whether its process is alive", () => {
    const dir = folder();
    const file = path.join(dir, "lock");

    expect(readLock(file)).toBeNull();

    fs.writeFileSync(
      file,
      JSON.stringify({
        pid: process.pid,
        startedAt: 5,
        root: "x",
        tier: "fast",
      }),
    );
    expect(readLock(file)).toMatchObject({
      alive: true,
      tier: "fast",
      root: "x",
    });

    // a process id that cannot be alive
    fs.writeFileSync(
      file,
      JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: 5 }),
    );
    expect(readLock(file).alive).toBe(false);

    fs.writeFileSync(file, "not json");
    expect(readLock(file)).toBeNull();
  });

  it("reads the record each checkout's last gate left, and skips what is not a record or has no checkout any more", () => {
    const dir = folder();
    const checkout = folder();
    const record = (name, content) =>
      fs.writeFileSync(path.join(dir, name), content);

    record(
      "a.json",
      JSON.stringify({
        root: checkout,
        ok: true,
        endedAt: 99,
        tier: "full",
        steps: [],
      }),
    );
    // the checkout of this record has been removed
    record(
      "gone.json",
      JSON.stringify({ root: path.join(dir, "nowhere"), endedAt: 5 }),
    );
    record("broken.json", "not json");
    record("no-time.json", JSON.stringify({ root: checkout }));
    record("notes.txt", "x");

    const results = readGateResults(dir);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      root: checkout,
      ok: true,
      endedAt: 99,
    });
    expect(readGateResults(path.join(dir, "no-such-folder"))).toEqual([]);
  });

  it("reads the open sessions of the main checkout and of each worktree", () => {
    const git = folder();

    fs.writeFileSync(
      path.join(git, "tins-session.json"),
      JSON.stringify({ id: "m1", task: null, started: "2026-11-11T05:14:56Z" }),
    );
    fs.mkdirSync(path.join(git, "worktrees", "t1"), { recursive: true });
    fs.writeFileSync(
      path.join(git, "worktrees", "t1", "tins-session.json"),
      JSON.stringify({
        id: "w1",
        task: "t1",
        started: "2026-11-12T08:13:51Z",
        branch: "task/t1",
      }),
    );
    fs.mkdirSync(path.join(git, "worktrees", "t2"), { recursive: true });

    const sessions = readSessions(git);

    expect(sessions.map((s) => `${s.id}:${s.task}:${s.isMain}`).sort()).toEqual(
      ["m1:null:true", "w1:t1:false"],
    );
    expect(sessions.find((s) => s.id === "w1").startedAt).toBe(
      Date.parse("2026-11-12T08:13:51Z"),
    );
  });

  it("reads the checkouts out of `git worktree list --porcelain`", () => {
    expect(
      parseWorktrees(
        "worktree C:/a/main\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/a/wt/t1\nHEAD def\n",
      ),
    ).toEqual(["C:/a/main", "C:/a/wt/t1"]);
    expect(parseWorktrees("")).toEqual([]);
  });

  it("reads `tasklist /FO CSV /NH` into names, ids and megabytes", () => {
    const text = [
      '"chrome.exe","1234","Console","1","312,480 K"',
      '"node.exe","77","Console","1","98,304 K"',
      "not a line",
    ].join("\r\n");

    expect(parseTasklist(text)).toEqual([
      { name: "chrome.exe", pid: 1234, memMB: 305 },
      { name: "node.exe", pid: 77, memMB: 96 },
    ]);
  });
});
