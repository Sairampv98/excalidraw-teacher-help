/**
 * Where the mirror's time goes: the numbers the capture helper says, how far
 * behind its timer the extension host is, and the report that names who was
 * slow (D-370).
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  HOST_BUSY_MS,
  KEY_GIVE_UP_MS,
  classifyStall,
  createPerfMonitor,
  formatPerfReport,
} from "../extension/src/perfMonitor";
import {
  createCaptureReader,
  parseCapturePerf,
} from "../extension/src/windowCapture";

const findPackageRoot = (): string => {
  let current = process.cwd();

  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(current, "packages", "vscode-bridge");

    if (existsSync(join(candidate, "extension", "package.json"))) {
      return candidate;
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  throw new Error("the vscode-bridge package was not found");
};

const packageRoot = findPackageRoot();

/** a monitor with a clock the test moves */
const monitorWithClock = () => {
  let now = 1_000_000;
  const monitor = createPerfMonitor({ now: () => now });

  return {
    monitor,
    tick: (ms: number) => {
      now += ms;
    },
  };
};

describe("who was slow when the picture stalled", () => {
  it("AC-432 a window that drew itself slowly is the editor's, a late timer is the host's, and neither is the helper's", () => {
    // the window took nearly the whole pass to draw itself
    expect(classifyStall(3000, 2900, 0)).toBe("window");

    // the pass was long but not the window's, and the host's timer was late
    expect(classifyStall(3000, 100, 2000)).toBe("host");
    expect(classifyStall(3000, 100, HOST_BUSY_MS)).toBe("host");

    // neither was slow: the helper itself paused
    expect(classifyStall(3000, 100, 20)).toBe("helper");

    // the window wins when both were slow: it was the first link of the chain
    expect(classifyStall(3000, 2900, 2500)).toBe("window");
  });

  it("AC-432 a smooth minute says so, with the numbers", () => {
    const { monitor, tick } = monitorWithClock();

    for (let second = 0; second < 30; second++) {
      monitor.recordHelper({
        frames: 12,
        avgShotMs: 20,
        maxShotMs: 35,
        maxLoopMs: 90,
      });
      tick(1000);
    }

    const report = monitor.report();

    expect(report.framesPerSecond).toBe(12);
    expect(report.shot).toEqual({ avgMs: 20, maxMs: 35 });
    expect(report.stalls).toEqual([]);
    expect(report.verdict).toContain("smooth");
    expect(report.verdict).toContain("12 frames a second");
  });

  it("AC-432 a stalled second is named by who was slow, and the verdict says the worst", () => {
    // the editor's window was slow to draw itself
    const slowWindow = monitorWithClock();

    for (let second = 0; second < 5; second++) {
      slowWindow.monitor.recordHelper({
        frames: second === 2 ? 1 : 12,
        avgShotMs: second === 2 ? 2800 : 20,
        maxShotMs: second === 2 ? 2900 : 30,
        maxLoopMs: second === 2 ? 3000 : 80,
      });
      slowWindow.tick(1000);
    }

    const window = slowWindow.monitor.report();

    expect(window.stalls).toHaveLength(1);
    expect(window.stalls[0].cause).toBe("window");
    expect(window.verdict).toContain("editor");

    // the extension host was busy in the same second
    const busyHost = monitorWithClock();

    busyHost.monitor.recordHostLag(2400);
    busyHost.monitor.recordHelper({
      frames: 1,
      avgShotMs: 15,
      maxShotMs: 20,
      maxLoopMs: 2500,
    });
    busyHost.tick(1000);

    const host = busyHost.monitor.report();

    expect(host.stalls[0].cause).toBe("host");
    expect(host.host.maxMs).toBe(2400);
    expect(host.verdict).toContain("extension host");

    // neither: the helper's own pause
    const paused = monitorWithClock();

    paused.monitor.recordHelper({
      frames: 1,
      avgShotMs: 15,
      maxShotMs: 20,
      maxLoopMs: 2500,
    });

    expect(paused.monitor.report().stalls[0].cause).toBe("helper");
    expect(paused.monitor.report().verdict).toContain("helper itself");
  });

  it("AC-432 a host that was behind with no stall is said, a small lag is not kept, and old numbers are forgotten", () => {
    const { monitor, tick } = monitorWithClock();

    monitor.recordHostLag(10);
    monitor.recordHostLag(49);
    monitor.recordHelper({
      frames: 12,
      avgShotMs: 20,
      maxShotMs: 30,
      maxLoopMs: 80,
    });

    // lags under the least are not kept at all
    expect(monitor.report().host.maxMs).toBe(0);

    monitor.recordHostLag(900);
    monitor.recordHelper({
      frames: 12,
      avgShotMs: 20,
      maxShotMs: 30,
      maxLoopMs: 80,
    });

    const behind = monitor.report();

    expect(behind.stalls).toEqual([]);
    expect(behind.verdict).toContain(
      "extension host was behind by up to 900 ms",
    );

    // two minutes later it is all forgotten
    tick(125_000);

    const later = monitor.report();

    expect(later.host.maxMs).toBe(0);
    expect(later.verdict).toContain("has not said anything");
  });

  it("AC-432 the report is lines of text with the stalls and the verdict", () => {
    const { monitor, tick } = monitorWithClock();

    monitor.recordHelper({
      frames: 1,
      avgShotMs: 2800,
      maxShotMs: 2900,
      maxLoopMs: 3000,
    });
    tick(1000);

    const lines = formatPerfReport(monitor.report(), () => "12:00:00");

    expect(lines[0]).toContain("the mirror's performance");
    expect(
      lines.some(
        (line) =>
          line.includes("12:00:00") &&
          line.includes("editor's window was slow"),
      ),
    ).toBe(true);
    expect(lines[lines.length - 1]).toMatch(/^verdict: /);
  });
});

/** one smooth second of the helper, with the editor in front or not */
const second = (inFront?: boolean) => ({
  frames: 12,
  avgShotMs: 20,
  maxShotMs: 30,
  maxLoopMs: 80,
  ...(inFront === undefined ? {} : { inFront }),
});

describe("how long a key takes to show", () => {
  it("AC-434 a key is timed from its sending to the next picture that differs, and only the first of a burst is", () => {
    const { monitor, tick } = monitorWithClock();

    monitor.keySent();
    tick(100);
    // the second key of the burst is not timed on its own
    monitor.keySent();
    tick(300);
    monitor.pictureChanged();

    // a picture that changes with no key waiting measures nothing
    tick(50);
    monitor.pictureChanged();

    const report = monitor.report();

    expect(report.keys.all).toEqual({ count: 1, medianMs: 400, worstMs: 400 });
    expect(report.keys.slow).toBe(0);
    expect(report.verdict).toContain("keys showed in the picture in 400 ms");
  });

  it("AC-434 a key whose picture never changed is given up, and the next key starts again", () => {
    const { monitor, tick } = monitorWithClock();

    monitor.keySent();
    tick(KEY_GIVE_UP_MS + 1000);
    monitor.keySent();
    tick(200);
    monitor.pictureChanged();

    expect(monitor.report().keys.all).toEqual({
      count: 1,
      medianMs: 200,
      worstMs: 200,
    });

    // a wait that ran past the give-up time is not a measurement at all
    const stale = monitorWithClock();

    stale.monitor.keySent();
    stale.tick(KEY_GIVE_UP_MS + 1);
    stale.monitor.pictureChanged();

    expect(stale.monitor.report().keys.all.count).toBe(0);
    expect(stale.monitor.report().verdict).not.toContain("keys");
  });

  it("AC-434 slow keys with the editor behind and fast ones in front are said to be the window's being behind", () => {
    const { monitor, tick } = monitorWithClock();

    for (let each = 0; each < 3; each++) {
      monitor.recordHelper(second(false));
      monitor.keySent();
      tick(3000);
      monitor.pictureChanged();

      monitor.recordHelper(second(true));
      monitor.keySent();
      tick(120);
      monitor.pictureChanged();
    }

    const report = monitor.report();

    expect(report.keys.behind).toEqual({
      count: 3,
      medianMs: 3000,
      worstMs: 3000,
    });
    expect(report.keys.inFront).toEqual({
      count: 3,
      medianMs: 120,
      worstMs: 120,
    });
    expect(report.keys.slow).toBe(3);
    expect(report.verdict).toContain(
      "the editor draws late when it is not in front",
    );

    const lines = formatPerfReport(report, () => "12:00:00").join("\n");

    expect(lines).toContain("editor in front:");
    expect(lines).toContain("editor behind other windows:");
  });

  it("AC-434 slow keys whether or not the editor is in front are said so, and an older helper says nothing about the front", () => {
    const { monitor, tick } = monitorWithClock();

    for (let each = 0; each < 2; each++) {
      monitor.recordHelper(second(true));
      monitor.keySent();
      tick(2500);
      monitor.pictureChanged();

      monitor.recordHelper(second(false));
      monitor.keySent();
      tick(2500);
      monitor.pictureChanged();
    }

    expect(monitor.report().verdict).toContain(
      "being in front made no difference",
    );

    // behind is NOT blamed when the keys behind were not the slow ones
    const mixed = monitorWithClock();

    mixed.monitor.keySent();
    mixed.tick(3000);
    mixed.monitor.pictureChanged();

    mixed.monitor.recordHelper(second(true));
    mixed.monitor.keySent();
    mixed.tick(100);
    mixed.monitor.pictureChanged();

    mixed.monitor.recordHelper(second(false));
    mixed.monitor.keySent();
    mixed.tick(500);
    mixed.monitor.pictureChanged();

    expect(mixed.monitor.report().keys.slow).toBe(1);
    expect(mixed.monitor.report().verdict).not.toContain("draws late");
    expect(mixed.monitor.report().verdict).toContain(
      "being in front made no difference",
    );

    // four numbers only: the front is not known, so no key is counted for it
    const older = monitorWithClock();

    older.monitor.recordHelper(second());
    older.monitor.keySent();
    older.tick(2500);
    older.monitor.pictureChanged();

    const unknown = older.monitor.report();

    expect(unknown.keys.all.count).toBe(1);
    expect(unknown.keys.inFront.count).toBe(0);
    expect(unknown.keys.behind.count).toBe(0);
  });

  it("AC-434 the helper says whether the editor is in front, the extension times the keys it sends, and old numbers are still read", () => {
    expect(parseCapturePerf("PERF 12 20 35 90 1")).toEqual({
      frames: 12,
      avgShotMs: 20,
      maxShotMs: 35,
      maxLoopMs: 90,
      inFront: true,
    });
    expect(parseCapturePerf("PERF 12 20 35 90 0")?.inFront).toBe(false);
    expect(parseCapturePerf("PERF 12 20 35 90")?.inFront).toBeUndefined();
    expect(parseCapturePerf("PERF 12 20 35 90 2")).toBeNull();

    const script = readFileSync(
      join(packageRoot, "extension", "media", "capture.ps1"),
      "utf8",
    );

    expect(script).toContain("GetForegroundWindow()");
    expect(script).toContain("[PwCap]::InFront($hwnd)");
    expect(script).toContain("' ' + $perfFront)");

    const extension = readFileSync(
      join(packageRoot, "extension", "src", "extension.ts"),
      "utf8",
    );

    // a key is timed when it is sent, and ends at the next picture that differs
    expect(extension).toContain("perfMonitor.keySent()");
    expect(extension).toContain("perfMonitor.pictureChanged()");
  });
});

describe("the helper's numbers reach the extension", () => {
  it("AC-433 a PERF message is read as numbers, and is neither a picture nor a status", () => {
    expect(parseCapturePerf("PERF 12 20 35 90")).toEqual({
      frames: 12,
      avgShotMs: 20,
      maxShotMs: 35,
      maxLoopMs: 90,
    });
    expect(parseCapturePerf("PERF 12 20")).toBeNull();
    expect(parseCapturePerf("STATUS NO_WINDOW")).toBeNull();

    const perfs: unknown[] = [];
    const frames: Buffer[] = [];
    const lines: string[] = [];
    const reader = createCaptureReader({
      onFrame: (bytes) => frames.push(bytes),
      onLine: (line) => lines.push(line),
      onPerf: (perf) => perfs.push(perf),
    });

    const framed = (payload: Buffer) => {
      const length = Buffer.alloc(4);

      length.writeUInt32LE(payload.length, 0);

      return Buffer.concat([length, payload]);
    };

    // the header line, a picture, the numbers, a picture
    reader.push(Buffer.from("HEADER 100 50\n"));
    reader.push(framed(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1])));
    reader.push(framed(Buffer.from("PERF 11 21 36 91")));
    reader.push(framed(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 2])));

    expect(perfs).toEqual([
      { frames: 11, avgShotMs: 21, maxShotMs: 36, maxLoopMs: 91 },
    ]);
    // the numbers are not a picture and not a fact the panel says
    expect(lines).toEqual([]);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((bytes) => bytes[0] === 0xff)).toBe(true);
  });

  it("AC-433 the helper times the window's drawing, and the extension keeps the numbers and says them on a command", () => {
    const script = readFileSync(
      join(packageRoot, "extension", "media", "capture.ps1"),
      "utf8",
    );

    // the time of PrintWindow itself, and one message a second
    // Reset + Start, not Restart: Restart is .NET 4 and Windows 7's PowerShell 2.0 has the 2.0 runtime (D-481)
    expect(script).toContain("$shotClock.Reset(); $shotClock.Start()");
    expect(script).toMatch(/\$shotOk = \[PwCap\]::Shot\(\$hwnd, \$bmp\)/);
    expect(script).toContain("Write-Perf ('PERF '");
    expect(script).toContain("-ge 1000");

    const extension = readFileSync(
      join(packageRoot, "extension", "src", "extension.ts"),
      "utf8",
    );

    // the extension host's own lag is measured with a timer that does nothing
    expect(extension).toContain("perfMonitor.recordHostLag(");
    expect(extension).toContain(
      "onPerf: (perf) => perfMonitor.recordHelper(perf)",
    );
    expect(extension).toContain('"excalidraw-bridge.showPerformance"');

    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "extension", "package.json"), "utf8"),
    ) as { contributes: { commands: { command: string }[] } };

    expect(manifest.contributes.commands.map((each) => each.command)).toContain(
      "excalidraw-bridge.showPerformance",
    );
  });
});
