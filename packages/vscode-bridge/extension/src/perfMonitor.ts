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

interface HelperSecond extends CapturePerf {
  at: number;
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
  /** one sentence, for the teacher */
  verdict: string;
}

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

  const trim = () => {
    const from = now() - PERF_KEEP_MS;

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

      return {
        lookedMs: Math.min(PERF_KEEP_MS, helper.length ? t - helper[0].at : 0),
        framesPerSecond,
        shot: { avgMs: shotAvg, maxMs: shotMax },
        host: { maxMs: hostMax, busySeconds },
        stalls,
        verdict,
      };
    },
  };
};

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
