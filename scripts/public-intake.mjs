#!/usr/bin/env node
/**
 * The intake of a collaborator's code.
 *
 *   node scripts/public-intake.mjs <ref>
 *
 * `<ref>` is what the collaborator pushed to the public clone: a branch
 * (`github-public/dev-draft`), or a pull request (`pull/12/head`, fetched). The
 * intake never merges anything into this repo. It lists what the change touches
 * and prints a draft of the rows the change would need in the specification, and
 * the steps the change goes through to come back: write the rows, open a task
 * and a worktree, compare against the collaborator's code, build it under the
 * method, merge it here, let the mirror publish it, and only then merge the pull
 * request into `dev`.
 */

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isDenied } from "./public-sync/guard.mjs";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

const git = (cwd, args) =>
  execFileSync("git", args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 1 << 28,
  })
    .toString("utf8")
    .trim();

/** the files a change touches against the public `dev`, and the commits it holds */
export const describeChange = (clone, ref, devBranch = "dev") => {
  const base = git(clone, ["merge-base", devBranch, ref]);
  const files = git(clone, ["diff", "--name-status", `${base}...${ref}`])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...path] = line.split("\t");

      return { status, path: path.join("\t") };
    });
  const commits = git(clone, ["log", "--format=%h %an: %s", `${base}..${ref}`])
    .split("\n")
    .filter(Boolean);

  return { base, files, commits };
};

/** a draft of the rows a change needs: one decision per top-level area it touches */
export const draftRows = (files) => {
  const areas = new Map();

  for (const { path } of files) {
    const parts = path.split("/");
    const area = parts.length > 2 ? parts.slice(0, 2).join("/") : parts[0];

    areas.set(area, (areas.get(area) ?? 0) + 1);
  }

  return [...areas.entries()].map(
    ([area, count], index) =>
      `| D-?${
        index + 1
      } | (name the behaviour of the change in ${area}) | proposed | ${count} file(s) in \`${area}\` change. Say what the user sees. |\n` +
      `| AC-?${
        index + 1
      } | (the check for it) | \`(a test file)\` | One row for what must hold. Tests: \`(the test titles)\`. |`,
  );
};

export const checklist = [
  "1. Write the rows above into the specification, with the behaviour in plain words.",
  "2. Open a task and a worktree for it (a scope that names the areas above).",
  "3. Compare the collaborator's code with what the rows say: keep the idea, not the code.",
  "4. Build it under the method: rows, tests that fail without the code, the gate.",
  "5. Merge the task into the private main. The mirror publishes it to `dev`.",
  "6. Merge the collaborator's pull request into `dev`, and thank them.",
];

const main = () => {
  const ref = process.argv[2];

  if (!ref) {
    console.error("usage: node scripts/public-intake.mjs <ref>");

    return 2;
  }

  const config = JSON.parse(
    readFileSync(join(here, "public-sync", "config.json"), "utf8"),
  );
  const { files, commits } = describeChange(
    config.publicClone,
    ref,
    config.devBranch,
  );

  console.log(
    `Commits (${commits.length}):\n${commits
      .map((line) => `  ${line}`)
      .join("\n")}`,
  );
  console.log(
    `\nFiles (${files.length}):\n${files
      .map(({ status, path }) => `  ${status} ${path}`)
      .join("\n")}`,
  );

  const denied = files.filter(({ path }) => isDenied(path, config.deny));

  if (denied.length) {
    console.log(
      `\nThese paths are not part of the public repo and are ignored: ${denied
        .map(({ path }) => path)
        .join(", ")}`,
    );
  }

  console.log(`\nDraft rows:\n${draftRows(files).join("\n")}`);
  console.log(`\nSteps:\n${checklist.join("\n")}`);

  return 0;
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main();
}
