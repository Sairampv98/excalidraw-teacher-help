import type { CapturePerf } from "./windowCapture";

/**
 * Where the mirror's time goes (D-370).
 *
 * The mirror is a chain: the page's key reaches the extension, the extension
 * hands it to the input helper, the editor's window draws itself, the capture
 * helper takes the picture, and the extension sends it on - and every link may
 * be the slow one. When the teacher feels a delay the question is **which
 * link**: the editor (its window was slow to draw itself), the extension host
 * (the one thread that every extension of the editor shares, and the mirror's
 * stream is served from), or the capture helper itself.
 *
 * The monitor keeps the last two minutes of three kinds of numbers and says,
 * for each second in which the picture stalled, who was slow. It imports
 * nothing from `vscode`, so a test can drive it.
 */

/** how much is kept */
export const PERF_KEEP_MS = 120_000;

/** a second in which the loop took this long, or this few frames, is a stall */
export const STALL_LOOP_MS = 800;

/** the extension host was busy when it kept its timer waiting this long */
export const HOST_BUSY_MS = 300;

/** a key that waits longer than this for the picture to change is not a measurement */
export const KEY_GIVE_UP_MS = 15_000;

/** a key whose picture took this long to change was slow (D-371) */
export const KEY_SLOW_MS = 1000;

interface HelperSecond extends CapturePerf {
  at: number;
}

interface KeyWait {
  at: number;
  ms: number;
  /** was the editor's window in front when the key went? null: not known */
  inFront: boolean | null;
}

/** how long keys took to show, for one group of them (D-371) */
export interface KeyStats {
  count: number;
  medianMs: number;
  worstMs: number;
}

interface HostLag {
  at: number;
  lagMs: number;
}

export type StallCause = "window" | "host" | "helper";

export interface Stall {
  /** when the second ended, in the monitor's clock */
  at: number;
  /** the longest one pass of the capture loop took */
  loopMs: number;
  /** how long the window took to draw itself in that second, at most */
  shotMs: number;
  /** how far behind the extension host's timer was at the time, at most */
  hostLagMs: number;
  cause: StallCause;
}

export interface PerfReport {
  /** how long the monitor has been looking, in ms (at most the keep time) */
  lookedMs: number;
  /** the frames a second the helper took over the last ten seconds */
  framesPerSecond: number;
  /** the window's draw time, on average and at worst, over the last minute */
  shot: { avgMs: number; maxMs: number };
  /** the extension host's lag over the last minute */
  host: { maxMs: number; busySeconds: number };
  stalls: Stall[];
  /**
   * How long a key took to show in the picture over the last minute: from the
   * key being sent to the first picture that differs (D-371).
   */
  keys: {
    all: KeyStats;
    slow: number;
    inFront: KeyStats;
    behind: KeyStats;
  };
  /** one sentence, for the teacher */
  verdict: string;
}

const keyStats = (waits: readonly KeyWait[]): KeyStats => {
  if (!waits.length) {
    return { count: 0, medianMs: 0, worstMs: 0 };
  }

  const sorted = waits.map((wait) => wait.ms).sort((a, b) => a - b);

  return {
    count: sorted.length,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    worstMs: sorted[sorted.length - 1],
  };
};

/** Who was slow in a second that stalled. */
export const classifyStall = (
  loopMs: number,
  shotMs: number,
  hostLagMs: number,
): StallCause => {
  // the window drew itself slowly: the editor was busy
  if (shotMs >= loopMs * 0.8) {
    return "window";
  }

  // the capture's own timer was late and so was the host's: the host was busy
  if (hostLagMs >= HOST_BUSY_MS) {
    return "host";
  }

  return "helper";
};

export const createPerfMonitor = (options: { now?: () => number } = {}) => {
  const now = options.now ?? Date.now;
  const helper: HelperSecond[] = [];
  const lags: HostLag[] = [];
  const keyWaits: KeyWait[] = [];

  /** when the oldest key that has not shown yet was sent */
  let keyPendingAt: number | null = null;
  let keyPendingFront: boolean | null = null;

  /** what the helper last said about the editor being in front */
  let lastFront: boolean | null = null;

  const trim = () => {
    const from = now() - PERF_KEEP_MS;

    while (keyWaits.length && keyWaits[0].at < from) {
      keyWaits.shift();
    }

    while (helper.length && helper[0].at < from) {
      helper.shift();
    }

    while (lags.length && lags[0].at < from) {
      lags.shift();
    }
  };

  const hostLagAround = (at: number): number => {
    let max = 0;

    for (const sample of lags) {
      if (sample.at >= at - 1500 && sample.at <= at + 500) {
        max = Math.max(max, sample.lagMs);
      }
    }

    return max;
  };

  return {
    /** the helper's numbers for the second that ended */
    recordHelper: (perf: CapturePerf) => {
      helper.push({ ...perf, at: now() });

      if (perf.inFront !== undefined) {
        lastFront = perf.inFront;
      }

      trim();
    },

    /**
     * A key went to the editor (D-371). Only the oldest key that has not shown
     * yet is timed: the question is how long the first of a burst waits.
     */
    keySent: () => {
      if (keyPendingAt === null || now() - keyPendingAt > KEY_GIVE_UP_MS) {
        keyPendingAt = now();
        keyPendingFront = lastFront;
      }
    },

    /**
     * A picture that differs from the one before was published (D-371): the
     * key that was waiting has shown.
     */
    pictureChanged: () => {
      if (keyPendingAt === null) {
        return;
      }

      const ms = now() - keyPendingAt;

      if (ms <= KEY_GIVE_UP_MS) {
        keyWaits.push({ at: now(), ms, inFront: keyPendingFront });
      }

      keyPendingAt = null;
      keyPendingFront = null;
      trim();
    },

    /** how far behind its timer the extension host was */
    recordHostLag: (lagMs: number) => {
      if (lagMs >= 50) {
        lags.push({ at: now(), lagMs });
        trim();
      }
    },

    report: (): PerfReport => {
      trim();

      const t = now();
      const lastTen = helper.filter((s) => s.at >= t - 10_000);
      const lastMinute = helper.filter((s) => s.at >= t - 60_000);
      const lagMinute = lags.filter((l) => l.at >= t - 60_000);

      const framesPerSecond = lastTen.length
        ? Math.round(
            (lastTen.reduce((sum, s) => sum + s.frames, 0) / lastTen.length) *
              10,
          ) / 10
        : 0;

      const shotAvg = lastMinute.length
        ? Math.round(
            lastMinute.reduce((sum, s) => sum + s.avgShotMs, 0) /
              lastMinute.length,
          )
        : 0;

      const shotMax = lastMinute.reduce(
        (max, s) => Math.max(max, s.maxShotMs),
        0,
      );

      const stalls: Stall[] = helper
        .filter((s) => s.maxLoopMs >= STALL_LOOP_MS)
        .map((s) => {
          const hostLagMs = hostLagAround(s.at);

          return {
            at: s.at,
            loopMs: s.maxLoopMs,
            shotMs: s.maxShotMs,
            hostLagMs,
            cause: classifyStall(s.maxLoopMs, s.maxShotMs, hostLagMs),
          };
        });

      const hostMax = lagMinute.reduce((max, l) => Math.max(max, l.lagMs), 0);
      const busySeconds = new Set(
        lagMinute
          .filter((l) => l.lagMs >= HOST_BUSY_MS)
          .map((l) => Math.floor(l.at / 1000)),
      ).size;

      let verdict: string;

      if (!helper.length) {
        verdict =
          "the capture has not said anything yet - is the mirror connected?";
      } else if (!stalls.length && hostMax < HOST_BUSY_MS) {
        verdict = `smooth: ${framesPerSecond} frames a second, the window draws itself in about ${shotAvg} ms, and the extension host is not behind`;
      } else {
        const counts = { window: 0, host: 0, helper: 0 };

        for (const stall of stalls) {
          counts[stall.cause] += 1;
        }

        const worst = (Object.keys(counts) as StallCause[]).reduce((a, b) =>
          counts[b] > counts[a] ? b : a,
        );

        if (!stalls.length) {
          verdict = `the extension host was behind by up to ${hostMax} ms in ${busySeconds} second(s), though the picture did not stall`;
        } else if (worst === "window") {
          verdict = `the editor's window was slow to draw itself (up to ${shotMax} ms) in ${counts.window} of ${stalls.length} stalled second(s): the editor is busy - the mirror is waiting for it`;
        } else if (worst === "host") {
          verdict = `the extension host was busy (behind by up to ${hostMax} ms) in ${counts.host} of ${stalls.length} stalled second(s): other extensions are using the thread the mirror shares`;
        } else {
          verdict = `the capture helper itself paused in ${counts.helper} of ${stalls.length} stalled second(s), while neither the window nor the host was slow`;
        }
      }

      const keysMinute = keyWaits.filter((wait) => wait.at >= t - 60_000);
      const keys = {
        all: keyStats(keysMinute),
        slow: keysMinute.filter((wait) => wait.ms >= KEY_SLOW_MS).length,
        inFront: keyStats(keysMinute.filter((wait) => wait.inFront === true)),
        behind: keyStats(keysMinute.filter((wait) => wait.inFront === false)),
      };

      if (keys.all.count) {
        if (!keys.slow) {
          verdict += `; keys showed in the picture in ${keys.all.medianMs} ms (worst ${keys.all.worstMs} ms)`;
        } else if (
          keys.behind.count &&
          keys.inFront.count &&
          keys.behind.medianMs >= KEY_SLOW_MS &&
          keys.inFront.medianMs < KEY_SLOW_MS
        ) {
          verdict += `; keys took ${keys.behind.medianMs} ms to show while the editor was behind other windows, but ${keys.inFront.medianMs} ms while it was in front: the editor draws late when it is not in front`;
        } else {
          verdict += `; ${keys.slow} of ${keys.all.count} keys took a second or more to show (median ${keys.all.medianMs} ms, worst ${keys.all.worstMs} ms), and being in front made no difference`;
        }
      }

      return {
        lookedMs: Math.min(PERF_KEEP_MS, helper.length ? t - helper[0].at : 0),
        framesPerSecond,
        shot: { avgMs: shotAvg, maxMs: shotMax },
        host: { maxMs: hostMax, busySeconds },
        stalls,
        keys,
        verdict,
      };
    },
  };
};

const keyLine = (stats: KeyStats): string =>
  stats.count
    ? `${stats.medianMs} ms typically, ${stats.worstMs} ms at worst (${stats.count} keys)`
    : "none";

/** The report as lines of text, for the editor's Output panel. */
export const formatPerfReport = (
  report: PerfReport,
  clock: (at: number) => string = (at) => new Date(at).toLocaleTimeString(),
): string[] => {
  const lines = [
    `the mirror's performance, over the last ${Math.round(
      report.lookedMs / 1000,
    )} s`,
    `  frames a second taken:        ${report.framesPerSecond}`,
    `  the window drew itself in:    ${report.shot.avgMs} ms on average, ${report.shot.maxMs} ms at worst`,
    `  the extension host was behind: up to ${report.host.maxMs} ms (${report.host.busySeconds} second(s) over ${HOST_BUSY_MS} ms)`,
    `  stalled seconds:              ${report.stalls.length}`,
    `  a key showed in the picture:  ${
      report.keys.all.count
        ? `${report.keys.all.medianMs} ms typically, ${report.keys.all.worstMs} ms at worst (${report.keys.all.count} keys, ${report.keys.slow} took a second or more)`
        : "no key was sent in the last minute"
    }`,
    `    editor in front:            ${keyLine(report.keys.inFront)}`,
    `    editor behind other windows: ${keyLine(report.keys.behind)}`,
  ];

  for (const stall of report.stalls.slice(-8)) {
    lines.push(
      `    ${clock(stall.at)}  the loop took ${stall.loopMs} ms  (window ${
        stall.shotMs
      } ms, host behind ${stall.hostLagMs} ms) -> ${
        stall.cause === "window"
          ? "the editor's window was slow"
          : stall.cause === "host"
          ? "the extension host was busy"
          : "the capture helper paused"
      }`,
    );
  }

  lines.push("", `verdict: ${report.verdict}`);

  return lines;
};
