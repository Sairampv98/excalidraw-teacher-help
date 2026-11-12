/**
 * What the watcher looks at (D-588).
 *
 * Each reader takes what it reads from as an argument, so that a test can point
 * it at a folder it made. `takeSnapshot` puts them together; `events.mjs` decides
 * what the snapshot means.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** the folder the watcher writes its files in, shared by every checkout */
export const opsDir = () => path.join(os.tmpdir(), "excalidraw-ops");

/** the lock `scripts/tins-gate.mjs` takes: one for the machine */
export const gateLockFile = () =>
  path.join(os.tmpdir(), "excalidraw-tins-gate.lock");

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

export const readMemory = () => ({
  freeMB: Math.floor(os.freemem() / 2 ** 20),
  totalMB: Math.floor(os.totalmem() / 2 ** 20),
});

/** the free space of the drive each path is on, once for each drive */
export const readDisks = (paths) => {
  const seen = new Set();
  const disks = [];

  for (const wanted of paths) {
    const drive = path.parse(path.resolve(wanted)).root;

    if (seen.has(drive)) {
      continue;
    }

    seen.add(drive);

    try {
      const stats = fs.statfsSync(drive);

      disks.push({
        path: drive,
        freeGB: (Number(stats.bavail) * Number(stats.bsize)) / 2 ** 30,
      });
    } catch {
      // a drive that cannot be read is not reported
    }
  }

  return disks;
};

/** the gate lock, and whether the process that took it is still there */
export const readLock = (file = gateLockFile()) => {
  const lock = readJson(file);

  return lock && Number.isFinite(lock.pid)
    ? { ...lock, alive: isAlive(lock.pid) }
    : null;
};

/** the roots of every checkout, from `git worktree list --porcelain` */
export const parseWorktrees = (text) =>
  String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim());

export const listCheckouts = (mainRoot) =>
  parseWorktrees(
    spawnSync("git", ["worktree", "list", "--porcelain"], {
      cwd: mainRoot,
      encoding: "utf8",
    }).stdout,
  );

/** the record each checkout's last gate left (D-585) */
export const readGateResults = (dir = path.join(opsDir(), "gate-results")) => {
  let names;

  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }

  return names
    .map((name) => readJson(path.join(dir, name)))
    .filter(
      (result) =>
        result &&
        typeof result.root === "string" &&
        Number.isFinite(result.endedAt) &&
        // a checkout that has been removed no longer has a gate to tell about
        fs.existsSync(result.root),
    );
};

/**
 * The kit keeps an open session in the git folder of its checkout
 * (`tins-session.json`); the main checkout's is in the common folder.
 */
export const readSessions = (commonGitDir) => {
  const found = [];
  const add = (file, isMain) => {
    const session = readJson(file);

    if (session?.id) {
      found.push({
        id: session.id,
        task: session.task ?? null,
        isMain,
        startedAt: Date.parse(session.started) || Date.now(),
        branch: session.branch ?? null,
      });
    }
  };

  add(path.join(commonGitDir, "tins-session.json"), true);

  const worktrees = path.join(commonGitDir, "worktrees");

  try {
    for (const name of fs.readdirSync(worktrees)) {
      add(path.join(worktrees, name, "tins-session.json"), false);
    }
  } catch {
    // no worktrees
  }

  return found;
};

/** `tasklist /FO CSV /NH` into name, pid and memory in MB */
export const parseTasklist = (text) =>
  String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.match(/^"([^"]*)","(\d+)","[^"]*","[^"]*","([^"]*)"/))
    .filter(Boolean)
    .map((match) => ({
      name: match[1],
      pid: Number(match[2]),
      memMB: Math.round(Number(match[3].replace(/[^\d]/g, "") || 0) / 1024),
    }));

export const readProcesses = () => {
  if (process.platform !== "win32") {
    return [];
  }

  return parseTasklist(
    spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout,
  );
};

const git = (cwd, args) =>
  spawnSync("git", args, { cwd, encoding: "utf8" }).stdout?.trim() || null;

/** where the private main and the public dev are now */
export const readRefs = ({ mainRoot, publicRoot }) => ({
  main: git(mainRoot, ["rev-parse", "main"]),
  publicDev:
    publicRoot && fs.existsSync(publicRoot)
      ? git(publicRoot, ["rev-parse", "dev"])
      : null,
  publicSubject:
    publicRoot && fs.existsSync(publicRoot)
      ? git(publicRoot, ["log", "-1", "--format=%s", "dev"])
      : null,
});

/** the main checkout: the folder that holds the common git folder */
export const findMainRoot = (cwd) => {
  const out = git(cwd, ["rev-parse", "--git-common-dir"]);

  return out ? path.dirname(path.resolve(cwd, out)) : null;
};

export const takeSnapshot = ({
  mainRoot,
  publicRoot,
  extraDisks = [],
  now = Date.now(),
}) => {
  const roots = listCheckouts(mainRoot);

  return {
    at: now,
    memory: readMemory(),
    disks: readDisks([mainRoot, ...roots, ...extraDisks]),
    lock: readLock(),
    gates: readGateResults(),
    sessions: readSessions(path.join(mainRoot, ".git")),
    processes: readProcesses(),
    refs: readRefs({ mainRoot, publicRoot }),
  };
};
