/**
 * AC-685 - the watcher says what changed, once (D-588): memory, disk, the gate,
 * a finished gate, a browser left behind, a session that should not be open, and
 * the private and the public branches.
 */

import { describe, expect, it } from "vitest";

import {
  buildStatus,
  evaluate,
  formatEvent,
  initialState,
} from "../lib/events.mjs";

const MIN = 60000;
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);

const snap = (over = {}) => ({
  at: T0,
  memory: { freeMB: 8000, totalMB: 14000 },
  disks: [{ path: "C:\\", freeGB: 80 }],
  lock: null,
  gates: [],
  sessions: [],
  processes: [],
  refs: { main: "a".repeat(40), publicDev: "b".repeat(40) },
  ...over,
});

/** feeds a list of snapshots through the watcher and returns the events of each look */
const play = (snaps, state = initialState()) =>
  snaps.map((one) => {
    const result = evaluate(state, one);

    state = result.state;

    return result.events;
  });

const kinds = (events) => events.map((e) => `${e.level}:${e.kind}`);

describe("AC-685 memory", () => {
  it("says nothing while memory is fine, and once when it crosses each line", () => {
    const looks = play([
      snap({ memory: { freeMB: 8000, totalMB: 14000 } }),
      snap({ at: T0 + 15000, memory: { freeMB: 2800, totalMB: 14000 } }),
      snap({ at: T0 + 30000, memory: { freeMB: 2700, totalMB: 14000 } }),
      snap({ at: T0 + 45000, memory: { freeMB: 1200, totalMB: 14000 } }),
      snap({ at: T0 + 60000, memory: { freeMB: 1100, totalMB: 14000 } }),
    ]);

    expect(looks.map(kinds)).toEqual([
      [],
      ["warn:memory"],
      [],
      ["alert:memory"],
      [],
    ]);
  });

  it("names the biggest users, so the person knows what to close", () => {
    const [, events] = play([
      snap(),
      snap({
        at: T0 + 15000,
        memory: { freeMB: 2000, totalMB: 14000 },
        processes: [
          { name: "chrome.exe", pid: 1, memMB: 2400 },
          { name: "chrome.exe", pid: 2, memMB: 1000 },
          { name: "vmwp.exe", pid: 3, memMB: 2100 },
          { name: "node.exe", pid: 4, memMB: 300 },
        ],
      }),
    ]);

    expect(events[0].message).toContain("chrome 3.3 GB");
    expect(events[0].message).toContain("vmwp 2.1 GB");
    expect(events[0].message).toContain("2.0 GB free of 13.7 GB");
  });

  it("needs more room to be fine again than it took to lose it", () => {
    const looks = play([
      snap(),
      snap({ at: 1, memory: { freeMB: 1000, totalMB: 14000 } }),
      snap({ at: 2, memory: { freeMB: 3500, totalMB: 14000 } }),
      snap({ at: 3, memory: { freeMB: 3600, totalMB: 14000 } }),
      snap({ at: 4, memory: { freeMB: 4500, totalMB: 14000 } }),
    ]);

    // 3500 is above the warn line but below the recover line: nothing is said
    expect(looks.map(kinds)).toEqual([
      [],
      ["alert:memory"],
      [],
      [],
      ["info:memory"],
    ]);
  });
});

describe("AC-685 disks", () => {
  it("warns below 15 GB, alerts below 5, and is fine again above 20", () => {
    const disk = (freeGB) => snap({ disks: [{ path: "C:\\", freeGB }] });
    const looks = play([
      disk(40),
      disk(14),
      disk(14),
      disk(4),
      disk(18),
      disk(21),
    ]);

    expect(looks.map(kinds)).toEqual([
      [],
      ["warn:disk"],
      [],
      ["alert:disk"],
      [],
      ["info:disk"],
    ]);
  });
});

describe("AC-685 the gate lock", () => {
  const lock = (over = {}) => ({
    pid: 4242,
    alive: true,
    startedAt: T0,
    root: "C:/work/wt/v3b-2-hand-made-flows",
    tier: "fast",
    ...over,
  });

  it("says a gate started once, with whose it is and its tier", () => {
    const looks = play([
      snap({ lock: null }),
      snap({ at: T0 + 15000, lock: lock() }),
      snap({ at: T0 + 30000, lock: lock() }),
    ]);

    expect(looks[1]).toHaveLength(1);
    expect(looks[1][0].message).toContain("fast gate started");
    expect(looks[1][0].message).toContain("v3b-2-hand-made-flows");
    expect(looks[2]).toEqual([]);
  });

  it("warns once when a gate has run 20 minutes", () => {
    const looks = play([
      snap({ lock: lock() }),
      snap({ at: T0 + 19 * MIN, lock: lock() }),
      snap({ at: T0 + 21 * MIN, lock: lock() }),
      snap({ at: T0 + 22 * MIN, lock: lock() }),
    ]);

    expect(looks.map(kinds)).toEqual([["info:gate"], [], ["warn:gate"], []]);
  });

  it("says a lock whose process is gone is stale, once", () => {
    const looks = play([
      snap({ lock: lock({ alive: false }) }),
      snap({ at: T0 + 15000, lock: lock({ alive: false }) }),
    ]);

    expect(looks[0].map((e) => e.kind)).toEqual(["gate"]);
    expect(looks[0][0].message).toContain("process that is gone");
    expect(looks[1]).toEqual([]);
  });

  it("says a new gate again after the lock was released", () => {
    const looks = play([
      snap({ lock: lock() }),
      snap({ at: T0 + 1, lock: null }),
      snap({ at: T0 + 2, lock: lock({ pid: 777, startedAt: T0 + 2 }) }),
    ]);

    expect(looks.map(kinds)).toEqual([["info:gate"], [], ["info:gate"]]);
  });
});

describe("AC-685 a finished gate", () => {
  const result = (over = {}) => ({
    root: "C:/work/wt/v3a-3-gate-speed",
    ok: true,
    tier: "full",
    minutes: 8.1,
    workers: 6,
    endedAt: T0 + 5 * MIN,
    steps: [{ name: "vitest", ok: true, seconds: 400, failures: [] }],
    ...over,
  });

  it("does not announce a result that was already there when it began", () => {
    const looks = play([
      snap({ gates: [result()] }),
      snap({ gates: [result()] }),
    ]);

    expect(looks).toEqual([[], []]);
  });

  it("announces a PASS once, with the tier, the minutes and the workers", () => {
    const looks = play([
      snap({ gates: [result({ endedAt: T0 })] }),
      snap({ gates: [result({ endedAt: T0 + 9 * MIN })] }),
      snap({ gates: [result({ endedAt: T0 + 9 * MIN })] }),
    ]);

    expect(looks[1]).toHaveLength(1);
    expect(looks[1][0].level).toBe("info");
    expect(looks[1][0].message).toContain("PASS in v3a-3-gate-speed");
    expect(looks[1][0].message).toContain("full, 8.1 min, 6 worker(s)");
    expect(looks[2]).toEqual([]);
  });

  it("announces a FAIL as an alert that names the failed step and the failing tests", () => {
    const looks = play([
      snap({ gates: [result({ endedAt: T0 })] }),
      snap({
        gates: [
          result({
            ok: false,
            endedAt: T0 + 9 * MIN,
            steps: [
              { name: "typecheck", ok: true, seconds: 40, failures: [] },
              {
                name: "vitest",
                ok: false,
                seconds: 300,
                failures: [
                  {
                    file: "packages/excalidraw/tests/flowLargePresets.test.tsx",
                    test: "AC-253 all seven presets build very large charts",
                  },
                ],
              },
            ],
          }),
        ],
      }),
    ]);

    expect(looks[1][0].level).toBe("alert");
    expect(looks[1][0].message).toContain("FAIL in v3a-3-gate-speed");
    expect(looks[1][0].message).toContain("failed: vitest");
    expect(looks[1][0].message).toContain("flowLargePresets.test.tsx > AC-253");
  });

  it("announces the first result of a checkout that appears later", () => {
    const looks = play([
      snap({ gates: [] }),
      snap({ gates: [result({ root: "C:/work/wt/new" })] }),
    ]);

    expect(looks[1]).toHaveLength(1);
  });
});

describe("AC-685 a browser a run left behind", () => {
  const browser = { name: "chrome-headless-shell.exe", pid: 9, memMB: 480 };
  const running = {
    pid: 1,
    alive: true,
    startedAt: T0,
    root: "C:/x",
    tier: "full",
  };

  it("warns once when it has run 10 minutes with no gate", () => {
    const looks = play([
      snap({ processes: [browser] }),
      snap({ at: T0 + 9 * MIN, processes: [browser] }),
      snap({ at: T0 + 11 * MIN, processes: [browser] }),
      snap({ at: T0 + 12 * MIN, processes: [browser] }),
    ]);

    expect(looks.map(kinds)).toEqual([[], [], ["warn:browser"], []]);
    expect(looks[2][0].message).toContain("1 Playwright browser");
  });

  it("is not a leftover while a gate runs, and the clock starts again when it goes", () => {
    const looks = play([
      snap({ processes: [browser], lock: running }),
      snap({ at: T0 + 15 * MIN, processes: [browser], lock: running }),
      snap({ at: T0 + 16 * MIN, processes: [] }),
      snap({ at: T0 + 17 * MIN, processes: [browser] }),
      snap({ at: T0 + 20 * MIN, processes: [browser] }),
    ]);

    expect(looks.flatMap(kinds).filter((k) => k === "warn:browser")).toEqual(
      [],
    );
  });

  it("does not take the person's own Chrome for a leftover", () => {
    const looks = play([
      snap({ processes: [{ name: "chrome.exe", pid: 5, memMB: 900 }] }),
      snap({
        at: T0 + 30 * MIN,
        processes: [{ name: "chrome.exe", pid: 5, memMB: 900 }],
      }),
    ]);

    expect(looks).toEqual([[], []]);
  });
});

describe("AC-685 sessions", () => {
  it("alerts once on a session open on main with no task", () => {
    const stray = { id: "fd7c78a9", task: null, isMain: true, startedAt: T0 };
    const looks = play([
      snap({ sessions: [stray] }),
      snap({ at: T0 + 15000, sessions: [stray] }),
    ]);

    expect(looks[0].map((e) => `${e.level}:${e.kind}`)).toEqual([
      "alert:session",
    ]);
    expect(looks[0][0].message).toContain("no task");
    expect(looks[1]).toEqual([]);
  });

  it("does not alert on a task's own session, however it is named", () => {
    const own = {
      id: "2d90cb6c",
      task: "v3a-0-spec",
      isMain: false,
      startedAt: T0,
    };

    expect(play([snap({ sessions: [own] })])[0]).toEqual([]);
  });

  it("mentions a session open for hours, and warns past a day", () => {
    const session = {
      id: "00be67dc",
      task: "public-mirror",
      isMain: false,
      startedAt: T0,
    };
    const at4h = T0 + 4 * 60 * MIN;
    const looks = play([
      snap({ sessions: [session] }),
      snap({ at: at4h, sessions: [session] }),
    ]);

    expect(looks[1][0].level).toBe("info");
    expect(looks[1][0].message).toContain("4 hours");

    const [forgotten] = play([
      snap({
        at: T0 + 15 * 24 * 60 * MIN,
        sessions: [session],
      }),
    ]);

    expect(forgotten[0].level).toBe("warn");
    expect(forgotten[0].message).toContain("15 days");
  });

  it("says it again when a session returns after it was gone", () => {
    const stray = { id: "x1", task: null, isMain: true, startedAt: T0 };
    const looks = play([
      snap({ sessions: [stray] }),
      snap({ at: 1, sessions: [] }),
      snap({ at: 2, sessions: [stray] }),
    ]);

    expect(looks.map((events) => events.length)).toEqual([1, 0, 1]);
  });
});

describe("AC-685 the private main and the public dev", () => {
  it("says main moved as news, and the public dev moving as an alert with its subject", () => {
    const looks = play([
      snap(),
      snap({
        refs: { main: "c".repeat(40), publicDev: "b".repeat(40) },
      }),
      snap({
        refs: {
          main: "c".repeat(40),
          publicDev: "d".repeat(40),
          publicSubject: "(describe the task here)",
        },
      }),
    ]);

    expect(looks[0]).toEqual([]);
    expect(looks[1].map((e) => `${e.level}:${e.kind}`)).toEqual(["info:main"]);
    expect(looks[2].map((e) => `${e.level}:${e.kind}`)).toEqual([
      "alert:public",
    ]);
    expect(looks[2][0].message).toContain("bbbbbbb -> ddddddd");
    expect(looks[2][0].message).toContain("(describe the task here)");
    expect(looks[2][0].message).toContain("something went public");
  });

  it("says nothing when the refs are unknown", () => {
    expect(play([snap({ refs: {} }), snap({ refs: {} })]).flat()).toEqual([]);
  });
});

describe("AC-685 how an event reads", () => {
  it("is one line: the time, the level in capitals, the kind and the message", () => {
    const line = formatEvent({
      level: "alert",
      kind: "gate",
      message: "FAIL in x",
      at: new Date(2026, 10, 12, 9, 5, 7).getTime(),
    });

    expect(line).toBe("09:05:07 ALERT gate: FAIL in x");
    expect(line).not.toContain("\n");
  });

  it("the status holds the memory, the gate, the sessions, the refs and the recent events", () => {
    const state = initialState();
    const status = buildStatus(
      snap({
        lock: {
          pid: 1,
          alive: true,
          startedAt: T0,
          root: "C:/x",
          tier: "fast",
        },
      }),
      state,
      [{ level: "info", kind: "gate", message: "m", at: T0 }],
    );

    expect(status.memory.freeMB).toBe(8000);
    expect(status.gate).toEqual({
      running: true,
      root: "C:/x",
      tier: "fast",
      startedAt: T0,
    });
    expect(status.recentEvents).toHaveLength(1);
    expect(Object.keys(status).sort()).toEqual(
      [
        "disks",
        "gate",
        "lastGates",
        "memory",
        "recentEvents",
        "refs",
        "sessions",
        "updatedAt",
      ].sort(),
    );
  });
});
