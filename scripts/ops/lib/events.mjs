/**
 * What the watcher says (D-588).
 *
 * `evaluate` is a pure function: the state it remembers, a snapshot of the
 * machine, and the thresholds in, and the new state and the EVENTS out. An event
 * is said once when something crosses a line, not on every look, so that a
 * person or an agent reading the stream is told what changed and is not flooded.
 *
 * Nothing here touches the machine; `collect.mjs` takes the snapshot.
 */

export const DEFAULTS = {
  memoryWarnMB: 3072,
  memoryAlertMB: 1536,
  /** back above this the memory is called fine again, so it does not flap at the line */
  memoryRecoverMB: 4096,
  diskWarnGB: 15,
  diskAlertGB: 5,
  diskRecoverGB: 20,
  lockLongMin: 20,
  orphanBrowserMin: 10,
  sessionLongMin: 180,
};

/** the process names that Playwright's browsers run under */
export const PLAYWRIGHT_BROWSERS = ["chrome-headless-shell.exe"];

export const initialState = () => ({
  primed: false,
  memory: "ok",
  disks: {},
  lockKey: null,
  lockLong: false,
  staleLock: null,
  seenGates: {},
  orphanSince: null,
  orphanWarned: false,
  strayWarned: {},
  longWarned: {},
  refs: null,
});

const gb = (mb) => (mb / 1024).toFixed(1);
const tail = (path = "") => String(path).replace(/\\/g, "/").split("/").pop();

const event = (level, kind, message, at) => ({ level, kind, message, at });

/** the memory level: it needs more room to be called fine than it took to lose it */
const levelOf = (value, previous, { warn, alert, recover }) => {
  if (value < alert) {
    return "alert";
  }

  if (value < warn) {
    return "warn";
  }

  // between the warn line and the recover line the old level stands, silently
  if (previous !== "ok" && value < recover) {
    return previous;
  }

  return "ok";
};

const topUsers = (processes = []) => {
  const byName = new Map();

  for (const { name, memMB } of processes) {
    byName.set(name, (byName.get(name) ?? 0) + memMB);
  }

  return [...byName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, memMB]) => `${name.replace(/\.exe$/i, "")} ${gb(memMB)} GB`)
    .join(", ");
};

const failureLine = (result) => {
  const failedSteps = result.steps.filter((step) => !step.ok);
  const names = failedSteps.map((step) => step.name).join(", ");
  const tests = failedSteps
    .flatMap((step) => step.failures ?? [])
    .slice(0, 3)
    .map(
      (failure) =>
        `${tail(failure.file)}${failure.test ? ` > ${failure.test}` : ""}`,
    );

  return `failed: ${names || "a step"}${
    tests.length ? `; ${tests.join("; ")}` : ""
  }`;
};

export const evaluate = (state, snap, config = DEFAULTS) => {
  const next = {
    ...state,
    disks: { ...state.disks },
    seenGates: { ...state.seenGates },
    strayWarned: { ...state.strayWarned },
    longWarned: { ...state.longWarned },
  };
  const events = [];
  const at = snap.at;

  // --- memory
  const memory = levelOf(snap.memory.freeMB, state.memory, {
    warn: config.memoryWarnMB,
    alert: config.memoryAlertMB,
    recover: config.memoryRecoverMB,
  });

  if (memory !== state.memory) {
    const free = `${gb(snap.memory.freeMB)} GB free of ${gb(
      snap.memory.totalMB,
    )} GB`;

    if (memory === "ok") {
      events.push(event("info", "memory", `memory is fine again, ${free}`, at));
    } else {
      const users = topUsers(snap.processes);

      events.push(
        event(
          memory,
          "memory",
          `${free}${
            memory === "alert"
              ? ", a gate or a browser may be killed"
              : ", a gate will be slow"
          }${users ? `; biggest: ${users}` : ""}`,
          at,
        ),
      );
    }

    next.memory = memory;
  }

  // --- disks
  for (const disk of snap.disks ?? []) {
    const level = levelOf(disk.freeGB, state.disks[disk.path] ?? "ok", {
      warn: config.diskWarnGB,
      alert: config.diskAlertGB,
      recover: config.diskRecoverGB,
    });

    if (level !== (state.disks[disk.path] ?? "ok")) {
      events.push(
        event(
          level === "ok" ? "info" : level,
          "disk",
          level === "ok"
            ? `${disk.path} has room again, ${disk.freeGB.toFixed(1)} GB free`
            : `${disk.path} has ${disk.freeGB.toFixed(1)} GB free`,
          at,
        ),
      );
    }

    next.disks[disk.path] = level;
  }

  // --- the gate lock
  const lock = snap.lock;

  if (lock && lock.alive) {
    const key = `${lock.pid}:${lock.startedAt}`;

    if (key !== state.lockKey) {
      events.push(
        event(
          "info",
          "gate",
          `a ${lock.tier ?? "full"} gate started in ${
            tail(lock.root) || "a checkout"
          } (pid ${lock.pid})`,
          at,
        ),
      );
      next.lockKey = key;
      next.lockLong = false;
    }

    const minutes = (at - lock.startedAt) / 60000;

    if (minutes >= config.lockLongMin && !next.lockLong) {
      events.push(
        event(
          "warn",
          "gate",
          `the gate of ${tail(lock.root) || "a checkout"} has run ${Math.round(
            minutes,
          )} minutes`,
          at,
        ),
      );
      next.lockLong = true;
    }
  } else if (lock && !lock.alive) {
    const key = `${lock.pid}:${lock.startedAt}`;

    if (state.staleLock !== key) {
      events.push(
        event(
          "warn",
          "gate",
          `a gate lock is left by a process that is gone (pid ${lock.pid}); the next gate clears it`,
          at,
        ),
      );
      next.staleLock = key;
    }

    next.lockKey = null;
  } else {
    next.lockKey = null;
    next.lockLong = false;
  }

  // --- finished gates: each checkout's last result, told once
  for (const result of snap.gates ?? []) {
    const seen = state.seenGates[result.root];

    if (state.primed && (seen === undefined || result.endedAt > seen)) {
      const where = tail(result.root) || "a checkout";
      const how = `${result.tier}, ${result.minutes} min, ${result.workers} worker(s)`;

      events.push(
        result.ok
          ? event("info", "gate", `PASS in ${where} (${how})`, at)
          : event(
              "alert",
              "gate",
              `FAIL in ${where} (${how}) ${failureLine(result)}`,
              at,
            ),
      );
    }

    next.seenGates[result.root] = result.endedAt;
  }

  // --- browsers that a run left behind
  const leftovers = (snap.processes ?? []).filter((process) =>
    PLAYWRIGHT_BROWSERS.includes(process.name.toLowerCase()),
  );

  if (leftovers.length && !(lock && lock.alive)) {
    next.orphanSince = state.orphanSince ?? at;

    const minutes = (at - next.orphanSince) / 60000;

    if (minutes >= config.orphanBrowserMin && !state.orphanWarned) {
      const total = leftovers.reduce((sum, process) => sum + process.memMB, 0);

      events.push(
        event(
          "warn",
          "browser",
          `${
            leftovers.length
          } Playwright browser process(es) still running, ${gb(
            total,
          )} GB, for ${Math.round(minutes)} minutes with no gate`,
          at,
        ),
      );
      next.orphanWarned = true;
    }
  } else {
    next.orphanSince = null;
    next.orphanWarned = false;
  }

  // --- sessions
  const ids = new Set();

  for (const session of snap.sessions ?? []) {
    ids.add(session.id);

    if (session.isMain && !session.task && !state.strayWarned[session.id]) {
      events.push(
        event(
          "alert",
          "session",
          `session ${session.id} is open on main with no task; end it before a task session can start (kit abort)`,
          at,
        ),
      );
      next.strayWarned[session.id] = true;
    }

    const minutes = (at - session.startedAt) / 60000;

    if (minutes >= config.sessionLongMin && !state.longWarned[session.id]) {
      // past a day it is probably forgotten, not working
      const forgotten = minutes >= 24 * 60;

      events.push(
        event(
          forgotten ? "warn" : "info",
          "session",
          `session ${session.id} (${session.task ?? "no task"}) has been open ${
            forgotten
              ? `${Math.round(minutes / 60 / 24)} days`
              : `${Math.round(minutes / 60)} hours`
          }${forgotten ? "; close or abort it if the work is done" : ""}`,
          at,
        ),
      );
      next.longWarned[session.id] = true;
    }
  }

  for (const id of Object.keys(next.strayWarned)) {
    if (!ids.has(id)) {
      delete next.strayWarned[id];
    }
  }

  for (const id of Object.keys(next.longWarned)) {
    if (!ids.has(id)) {
      delete next.longWarned[id];
    }
  }

  // --- the branches: main moving is news, the public branch moving is an alert
  const refs = snap.refs ?? {};

  if (state.refs) {
    if (refs.main && state.refs.main && refs.main !== state.refs.main) {
      events.push(
        event(
          "info",
          "main",
          `main moved ${state.refs.main.slice(0, 7)} -> ${refs.main.slice(
            0,
            7,
          )}`,
          at,
        ),
      );
    }

    if (
      refs.publicDev &&
      state.refs.publicDev &&
      refs.publicDev !== state.refs.publicDev
    ) {
      events.push(
        event(
          "alert",
          "public",
          `the PUBLIC dev moved ${state.refs.publicDev.slice(
            0,
            7,
          )} -> ${refs.publicDev.slice(0, 7)}${
            refs.publicSubject ? ` ("${refs.publicSubject}")` : ""
          }: something went public`,
          at,
        ),
      );
    }
  }

  next.refs = { main: refs.main ?? null, publicDev: refs.publicDev ?? null };
  next.primed = true;

  return { state: next, events };
};

const two = (n) => String(n).padStart(2, "0");

/** one line for an event, for a person and for a stream an agent reads */
export const formatEvent = (e) => {
  const d = new Date(e.at);

  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(
    d.getSeconds(),
  )} ${e.level.toUpperCase()} ${e.kind}: ${e.message}`;
};

/** the whole picture for status.json, which a person or an agent can read at any time */
export const buildStatus = (snap, state, recent) => ({
  updatedAt: snap.at,
  memory: {
    level: state.memory,
    freeMB: snap.memory.freeMB,
    totalMB: snap.memory.totalMB,
  },
  disks: snap.disks ?? [],
  gate: snap.lock
    ? {
        running: Boolean(snap.lock.alive),
        root: snap.lock.root ?? null,
        tier: snap.lock.tier ?? null,
        startedAt: snap.lock.startedAt,
      }
    : { running: false },
  lastGates: (snap.gates ?? []).map((g) => ({
    root: g.root,
    ok: g.ok,
    tier: g.tier,
    minutes: g.minutes,
    endedAt: g.endedAt,
  })),
  sessions: snap.sessions ?? [],
  refs: snap.refs ?? {},
  recentEvents: recent,
});
