#!/usr/bin/env node
/**
 * The public mirror, from the command line.
 *
 *   node scripts/public-sync.mjs status               where the mirror stands
 *   node scripts/public-sync.mjs scan                 what the next batch would hold, and what stops it
 *   node scripts/public-sync.mjs explain <commit>     the public commit a private commit becomes
 *   node scripts/public-sync.mjs run [--dry-run]      write the next commits to the public `dev` branch
 *   node scripts/public-sync.mjs push                 push `dev` to the public remote
 *   node scripts/public-sync.mjs approve-first-push   the owner's go for the first push
 *
 * Options: `--allow-drop` lets sentences that are not in the rewrite map be
 * dropped (a first look, never a publication); `--hook` is what the git hooks
 * pass: it is quiet, it never fails the commit, and it pushes after a clean run
 * once the first push was approved.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  changesOf,
  commitInfo,
  commonDir,
  mirror,
  plan,
  problems,
  publicOperation,
  readState,
} from "./public-sync/engine.mjs";
import { deriveMessage, taskIdOf } from "./public-sync/message.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const git = (cwd, args) =>
  execFileSync("git", args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 1 << 28,
  })
    .toString("utf8")
    .trim();

const tryGit = (cwd, args) => {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
};

export const loadConfig = (file = join(here, "public-sync", "config.json")) =>
  JSON.parse(readFileSync(file, "utf8"));

export const loadMap = (file = join(here, "public-sync", "rewrite-map.json")) =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { sentences: {} };

/** the private repo this script is in (the main worktree's git directory is the common one) */
const repoRoot = () => resolve(here, "..");

const stateFile = (repo, name) => join(commonDir(repo), "public-sync", name);

const firstPushApproved = (repo) =>
  existsSync(stateFile(repo, "first-push-approved"));

/** pushes `dev`, unless this would be the first push and the owner has not said go */
export const push = (repo, config) => {
  const clone = config.publicClone;
  const remote = config.publicRemote;
  const onRemote = tryGit(clone, [
    "ls-remote",
    "--heads",
    remote,
    config.devBranch,
  ]);

  if (!onRemote && !firstPushApproved(repo)) {
    return {
      pushed: false,
      reason:
        "the first push of dev waits for the owner's go: node scripts/public-sync.mjs approve-first-push",
    };
  }

  git(clone, ["push", remote, `${config.devBranch}:${config.devBranch}`]);

  return { pushed: true };
};

const flag = (args, name) => args.includes(name);

const main = () => {
  const [command = "status", ...args] = process.argv.slice(2);
  const config = loadConfig();
  const map = loadMap();
  const repo = repoRoot();
  const hook = flag(args, "--hook");
  const allowDrop = flag(args, "--allow-drop");
  const say = (line) => {
    if (!hook) {
      console.log(line);
    }
  };

  if (command === "status") {
    const state = readState(repo);
    const dev = tryGit(config.publicClone, [
      "rev-parse",
      "--short",
      `refs/heads/${config.devBranch}`,
    ]);

    console.log(`public clone      ${config.publicClone}`);
    console.log(`dev branch        ${dev ?? "not created yet"}`);
    console.log(
      `last mirrored     ${state.lastMirrored?.slice(0, 8) ?? "nothing yet"}`,
    );
    console.log(
      `first push        ${
        firstPushApproved(repo) ? "approved" : "waiting for the owner's go"
      }`,
    );
    console.log(
      `rewrite map       ${
        Object.keys(map.sentences ?? {}).length
      } reviewed sentences`,
    );

    return 0;
  }

  if (command === "approve-first-push") {
    mkdirSync(dirname(stateFile(repo, "x")), { recursive: true });
    writeFileSync(
      stateFile(repo, "first-push-approved"),
      `${new Date().toISOString()}\n`,
    );
    console.log("the first push of dev is approved");

    return 0;
  }

  if (command === "explain") {
    const commit = args.find((arg) => !arg.startsWith("--"));

    if (!commit) {
      console.error("explain needs a private commit");

      return 2;
    }

    const info = commitInfo(repo, commit);
    const unmapped = [];
    const operations = changesOf(repo, commit)
      .map((change) =>
        publicOperation(repo, commit, change, config, {
          map,
          allowDrop: true,
          unmapped,
        }),
      )
      .filter(Boolean);
    const id = taskIdOf(info.message);
    const taskText = id
      ? tryGit(repo, ["show", `${commit}:tasks/${id}.md`])
      : null;
    const derived = deriveMessage(
      {
        message: info.message,
        taskText,
        paths: operations.map((operation) => operation.path),
      },
      { map, allowDrop: true },
    );

    console.log(derived.message);
    console.log(
      operations
        .map(
          (operation) =>
            `${operation.type === "delete" ? "D" : "M"} ${operation.path}`,
        )
        .join("\n"),
    );

    if (unmapped.length || derived.unmapped.length) {
      console.log(
        `\n${
          unmapped.length + derived.unmapped.length
        } sentence(s) are not in the rewrite map`,
      );
    }

    return 0;
  }

  if (command === "scan" || command === "run") {
    const dryRun = command === "scan" || flag(args, "--dry-run");
    const lock = stateFile(repo, "lock");

    if (command === "run" && existsSync(lock)) {
      say("another sync is running");

      return 0;
    }

    mkdirSync(dirname(lock), { recursive: true });

    if (command === "run") {
      writeFileSync(lock, `${process.pid}\n`);
    }

    try {
      const result = mirror(repo, config, { map, allowDrop, dryRun });

      if (result.stops.length) {
        const report = result.stops.join("\n");

        if (hook) {
          writeFileSync(stateFile(repo, "last-problems.txt"), `${report}\n`);
        } else {
          console.error(report);
        }

        return hook ? 0 : 1;
      }

      say(
        dryRun
          ? `${result.result.commits.length} commit(s) would be written`
          : `${result.written ?? 0} commit(s) written to ${config.devBranch}`,
      );

      if (hook && !dryRun && result.done) {
        const pushed = push(repo, config);

        if (!pushed.pushed) {
          writeFileSync(
            stateFile(repo, "last-problems.txt"),
            `${pushed.reason}\n`,
          );
        }
      }

      return 0;
    } catch (error) {
      if (hook) {
        writeFileSync(
          stateFile(repo, "last-problems.txt"),
          `${error.message}\n`,
        );

        return 0;
      }

      throw error;
    } finally {
      if (command === "run") {
        rmSync(lock, { force: true });
      }
    }
  }

  if (command === "push") {
    const result = push(repo, config);

    console.log(result.pushed ? "pushed" : result.reason);

    return result.pushed ? 0 : 1;
  }

  console.error(`unknown command: ${command}`);

  return 2;
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main();
}

export { plan, problems };
