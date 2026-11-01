/**
 * AC-525 - the public repository can be published: the tree it would hold
 * refers to nothing it does not hold, and the whole batch the mirror would
 * write has no leak, no missing file and no sentence that names the way this
 * project is built outside the reviewed list of rewrites.
 *
 * The tree it would hold is the tree as it is now: the kit gates the merged
 * tree before it commits it, so the tree that is checked has to be the one
 * on the disk and not the one HEAD points at.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkClosure } from "../closure.mjs";
import { plan } from "../engine.mjs";
import { isDenied } from "../guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");

const config = JSON.parse(
  readFileSync(join(here, "..", "config.json"), "utf8"),
);
const map = JSON.parse(
  readFileSync(join(here, "..", "rewrite-map.json"), "utf8"),
);

const git = (args, options = {}) =>
  execFileSync("git", args, { cwd: repo, maxBuffer: 1 << 30, ...options });

/**
 * The tree as it is now, as a commit the mirror's engine can be asked about.
 *
 * The kit gates the merged tree before it commits it, so in a merge HEAD is
 * still the first parent: a test that reads HEAD reads the tree that was
 * there before the merge and not the one that is on the disk. The index is
 * the tree as it is - on a branch it is the branch's tree, in a merge it is
 * the merged one - so the tree is written from the index and hung off HEAD
 * as a commit, and the engine can be asked about it as about any commit.
 * Nothing is changed by it: the commit is on no branch and no gate sees it.
 */
const nowCommit = () => {
  const tree = git(["write-tree"]).toString("utf8").trim();
  const head = git(["rev-parse", "HEAD"]).toString("utf8").trim();

  return git(["commit-tree", tree, "-p", head, "-m", "the tree as it is now"])
    .toString("utf8")
    .trim();
};

/** the blobs of many paths of a commit, in one call */
const readBlobs = (commit, paths) => {
  const files = new Map();

  if (!paths.length) {
    return files;
  }

  const out = git(["cat-file", "--batch"], {
    input: `${paths.map((path) => `${commit}:${path}\n`).join("")}`,
  });
  let at = 0;

  for (const path of paths) {
    const newline = out.indexOf(10, at);
    const [, , size] = out.toString("utf8", at, newline).split(" ");
    const start = newline + 1;

    files.set(path, out.subarray(start, start + Number(size)));
    at = start + Number(size) + 1;
  }

  return files;
};

/**
 * The files the public repository would hold: the private tree without the
 * denied paths (they are never published). The files the closure check reads
 * are the code ones, as the mirror's own tree reader holds them.
 */
const publishedTree = (commit) => {
  const paths = git(["ls-tree", "-r", "--name-only", commit])
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .filter((path) => !isDenied(path, config.deny));
  const files = new Map();
  const wanted = [];

  for (const path of paths) {
    if (
      /\.(?:[cm]?[jt]sx?|s?css)$/.test(path) ||
      path.endsWith("package.json")
    ) {
      wanted.push(path);
    } else {
      files.set(path, "");
    }
  }

  for (const [path, content] of readBlobs(commit, wanted)) {
    files.set(path, content.toString("utf8"));
  }

  return files;
};

/** what the configuration already knows and accepts */
const allowed = (list = [], item) =>
  list.some((entry) =>
    Object.entries(entry).every(([key, value]) => item[key] === value),
  );

describe("AC-525 the public repository can be published", () => {
  it("AC-525 the published tree refers to nothing it does not hold", () => {
    const missing = checkClosure(publishedTree(nowCommit())).filter(
      (entry) => !allowed(config.allowMissing, entry),
    );

    expect(missing).toEqual([]);
  });

  it("AC-525 the whole batch can be written", { timeout: 600_000 }, () => {
    // no public clone: the engine takes the root path - the tree of the
    // first public commit and every commit after it - which is the whole
    // batch the publication would write
    const batch = plan(
      repo,
      {
        ...config,
        publicClone: join(repo, ".tins", "no-public-clone-here"),
        mainBranch: nowCommit(),
      },
      { map, allowDrop: false },
    );

    expect(batch.findings).toEqual([]);
    expect(batch.missing).toEqual([]);
    expect(batch.unmapped).toEqual([]);
  });
});
