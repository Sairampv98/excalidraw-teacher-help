/**
 * AC-291 - the public `dev` branch has a history of its own and one commit for
 * each private commit that changes something the public repo may hold.
 *
 * The test builds a private repo and a public clone in a temporary folder and
 * runs the real engine over them with git.
 */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mirror, readState } from "../engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const real = JSON.parse(readFileSync(join(here, "..", "config.json"), "utf8"));

const git = (cwd, ...args) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Teacher",
      "-c",
      "user.email=teacher@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 1 << 26 },
  )
    .toString("utf8")
    .trim();

const write = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

const commit = (root, message) => {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);

  return git(root, "rev-parse", "HEAD");
};

let folder;
let privateRepo;
let publicRepo;
let config;
let base;

const MAP = {
  sentences: { "Wave 3 added the chart tab.": "The chart tab was added." },
};

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "public-sync-"));
  privateRepo = join(folder, "private");
  publicRepo = join(folder, "public");

  mkdirSync(privateRepo);
  mkdirSync(publicRepo);

  // the public repo: its own README, on its main branch
  git(publicRepo, "init", "-q", "-b", "main");
  write(publicRepo, "README.md", "# The public README\n");
  commit(publicRepo, "Publish the first release");

  // the private repo: the base commit
  git(privateRepo, "init", "-q", "-b", "main");
  write(
    privateRepo,
    "src/a.ts",
    "// Wave 3 added the chart tab.\nexport const a = 1;\n",
  );
  write(privateRepo, "src/util.ts", "export const util = 1;\n");
  write(privateRepo, "SPEC.md", "| D-1 | a row |\n");
  write(privateRepo, "tasks/old.md", "---\nid: old\n---\n\nOld.\n");
  write(
    privateRepo,
    "packages/excalidraw/locales/ro-RO.json",
    '{"tins": "tins"}\n',
  );
  base = commit(privateRepo, "tins: base");

  config = {
    ...real,
    publicClone: publicRepo,
    baseCommit: base,
    mainBranch: "main",
  };
});

afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

const devLog = () =>
  git(publicRepo, "log", "--format=%H|%an|%s", "refs/heads/dev")
    .split("\n")
    .filter(Boolean);

const devFile = (path) => git(publicRepo, "show", `refs/heads/dev:${path}`);

describe("AC-291 the history of dev", () => {
  it("AC-291 dev has a root commit with the scrubbed tree and the files the public repo owns", () => {
    const result = mirror(privateRepo, config, { map: MAP });

    expect(result.stops).toEqual([]);
    expect(result.done).toBe(true);

    const files = git(
      publicRepo,
      "ls-tree",
      "-r",
      "--name-only",
      "refs/heads/dev",
    )
      .split("\n")
      .sort();

    // the method's files are gone, the rest is there, the README is the public one
    expect(files).toEqual([
      "README.md",
      "packages/excalidraw/locales/ro-RO.json",
      "src/a.ts",
      "src/util.ts",
    ]);
    expect(devFile("README.md")).toBe("# The public README");

    // the text is rewritten, the locale file is as it was
    expect(devFile("src/a.ts")).toContain("The chart tab was added.");
    expect(devFile("src/a.ts")).not.toMatch(/wave/i);
    expect(devFile("packages/excalidraw/locales/ro-RO.json")).toContain(
      '"tins": "tins"',
    );

    // a history of its own: one root commit, not a copy of the private history
    expect(devLog()).toHaveLength(1);
    expect(
      git(publicRepo, "rev-list", "--max-parents=0", "refs/heads/dev"),
    ).not.toBe(
      git(publicRepo, "rev-list", "--max-parents=0", "refs/heads/main"),
    );
  });

  it("AC-291 dev has one commit for each private commit that changes something public", () => {
    // a private commit with a task: its description is the public message
    write(privateRepo, "src/util.ts", "export const util = 2;\n");
    write(
      privateRepo,
      "tasks/add-util.md",
      "---\nid: add-util\npaths: src\nbase: main\nstatus: open\n---\n\nMake the util return two. It was one.\n",
    );
    git(privateRepo, "add", "-A");
    git(
      privateRepo,
      "commit",
      "-q",
      "-m",
      "tins: merge task add-util",
      "-m",
      "Tins-Merge: add-util",
    );

    // a private commit that only touches what is denied: no public commit
    write(privateRepo, "SPEC.md", "| D-1 | a row |\n| D-2 | another |\n");
    commit(privateRepo, "tins: spec only");

    const result = mirror(privateRepo, config, { map: MAP });

    expect(result.stops).toEqual([]);
    expect(result.written).toBe(1);

    const log = devLog();

    expect(log).toHaveLength(2);

    const [newest] = log[0].split("|").slice(1);

    // the author is the private commit's, the message is the task's
    expect(newest).toBe("Teacher");
    expect(log[0].split("|")[2]).toBe("Make the util return two");
    expect(devFile("src/util.ts")).toContain("= 2");
  });

  it("AC-291 a second run changes nothing", () => {
    const before = devLog();
    const result = mirror(privateRepo, config, { map: MAP });

    expect(result.done).toBe(false);
    expect(result.stops).toEqual([]);
    expect(devLog()).toEqual(before);
    expect(readState(privateRepo).lastMirrored).toBe(
      git(privateRepo, "rev-parse", "HEAD"),
    );
  });
});

describe("AC-296 nothing is written after a stop", () => {
  it("AC-296 a leak stops the run and the branch does not move", () => {
    const before = devLog();

    write(
      privateRepo,
      "src/leak.ts",
      // built here so that no token-shaped text is in the file
      `// ${["ghp", "a".repeat(36)].join("_")}\n`,
    );
    commit(privateRepo, "tins: add a file");

    const result = mirror(privateRepo, config, { map: MAP });

    expect(result.done).toBe(false);
    expect(result.stops.join("\n")).toContain("leak: src/leak.ts:1  secret");
    expect(devLog()).toEqual(before);
  });

  it("AC-296 an unmapped sentence stops the run, and dropping it is the owner's explicit choice", () => {
    write(privateRepo, "src/leak.ts", "export const fine = 1;\n");
    write(
      privateRepo,
      "src/b.ts",
      "// Wave 9 changed everything.\nexport const b = 1;\n",
    );
    commit(privateRepo, "tins: fix");

    const before = devLog();
    const stopped = mirror(privateRepo, config, { map: MAP });

    expect(stopped.stops.join("\n")).toContain("unmapped: src/b.ts");
    expect(devLog()).toEqual(before);

    const allowed = mirror(privateRepo, config, { map: MAP, allowDrop: true });

    expect(allowed.stops).toEqual([]);
    expect(devFile("src/b.ts")).not.toMatch(/wave/i);
  });

  it("AC-294 a file the public tree needs and does not hold stops the run", () => {
    write(
      privateRepo,
      "src/c.ts",
      'import { x } from "../tasks/helper";\nexport const c = x;\n',
    );
    write(privateRepo, "tasks/helper.ts", "export const x = 1;\n");
    commit(privateRepo, "tins: use a helper");

    const before = devLog();
    const result = mirror(privateRepo, config, { map: MAP, allowDrop: true });

    expect(result.done).toBe(false);
    expect(result.stops.join("\n")).toContain(
      "missing: src/c.ts needs tasks/helper",
    );
    expect(devLog()).toEqual(before);
  });
});
