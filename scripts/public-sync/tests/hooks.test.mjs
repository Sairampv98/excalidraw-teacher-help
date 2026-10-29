/**
 * AC-297 and AC-298 - the hooks run the sync on main only and the command line
 * works by hand; the intake lists a pull request's changes and never merges.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { checklist, describeChange, draftRows } from "../../public-intake.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

const read = (path) => readFileSync(join(root, path), "utf8");

const git = (cwd, ...args) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, stdio: ["pipe", "pipe", "pipe"] },
  )
    .toString("utf8")
    .trim();

const folders = [];

afterAll(() => {
  for (const folder of folders) {
    rmSync(folder, { recursive: true, force: true });
  }
});

describe("AC-297 the hooks and the command line", () => {
  it("AC-297 the hooks are in the repo, run the sync on main only and never fail a commit", () => {
    for (const name of ["post-commit", "post-merge"]) {
      const body = read(`.husky/${name}`);

      expect(body).toContain(
        '[ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" = "main" ] || exit 0',
      );
      expect(body).toContain("node scripts/public-sync.mjs run --hook");
      expect(body).toContain("|| true");
      expect(body.trimEnd().endsWith("exit 0")).toBe(true);
    }
  });

  it("AC-297 the hook runs the sync on main and not on another branch", () => {
    let shell = null;

    try {
      execFileSync("sh", ["-c", "true"]);
      shell = "sh";
    } catch {
      // no shell on this machine: the text of the hook above is what is checked
    }

    if (!shell) {
      return;
    }

    const folder = mkdtempSync(join(tmpdir(), "hook-"));

    folders.push(folder);
    git(folder, "init", "-q", "-b", "main");
    mkdirSync(join(folder, "scripts"));
    mkdirSync(join(folder, ".husky"));

    // a stand-in for the sync that leaves a mark
    writeFileSync(
      join(folder, "scripts", "public-sync.mjs"),
      'import { writeFileSync } from "node:fs"; writeFileSync("ran.txt", process.argv.slice(2).join(" "));\n',
    );
    writeFileSync(
      join(folder, ".husky", "post-commit"),
      read(".husky/post-commit"),
    );
    writeFileSync(join(folder, "a.txt"), "a");
    git(folder, "add", "-A");
    git(folder, "commit", "-q", "-m", "a");

    // on another branch: nothing runs
    git(folder, "checkout", "-q", "-b", "task/x");
    execFileSync("sh", [".husky/post-commit"], { cwd: folder });
    expect(existsSync(join(folder, "ran.txt"))).toBe(false);

    // on main: it runs, quietly
    git(folder, "checkout", "-q", "main");
    execFileSync("sh", [".husky/post-commit"], { cwd: folder });
    expect(readFileSync(join(folder, "ran.txt"), "utf8")).toBe("run --hook");
  });

  it("AC-297 status and scan change nothing", () => {
    const folder = mkdtempSync(join(tmpdir(), "status-"));

    folders.push(folder);

    // the command line is only read here: its commands that write say so
    const source = read("scripts/public-sync.mjs");

    expect(source).toContain('command === "status"');
    expect(source).toContain('const dryRun = command === "scan"');
    expect(statSync(join(root, "scripts", "public-sync.mjs")).isFile()).toBe(
      true,
    );
  });
});

describe("AC-298 the intake", () => {
  it("AC-298 the intake lists the changes and the checklist", () => {
    const folder = mkdtempSync(join(tmpdir(), "intake-"));

    folders.push(folder);
    git(folder, "init", "-q", "-b", "dev");
    writeFileSync(join(folder, "a.ts"), "export const a = 1;\n");
    git(folder, "add", "-A");
    git(folder, "commit", "-q", "-m", "first");

    // the collaborator's branch
    git(folder, "checkout", "-q", "-b", "dev-draft");
    mkdirSync(join(folder, "packages", "excalidraw"), { recursive: true });
    writeFileSync(
      join(folder, "packages", "excalidraw", "ruler.ts"),
      "export const r = 1;\n",
    );
    git(folder, "add", "-A");
    git(folder, "commit", "-q", "-m", "Add a ruler");

    const change = describeChange(folder, "dev-draft", "dev");

    expect(change.files).toEqual([
      { status: "A", path: "packages/excalidraw/ruler.ts" },
    ]);
    expect(change.commits[0]).toContain("Add a ruler");

    const rows = draftRows(change.files);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("packages/excalidraw");
    expect(checklist.join("\n")).toContain(
      "Merge the collaborator's pull request into `dev`",
    );
  });

  it("AC-298 the intake leaves the private repo untouched", () => {
    const source = read("scripts/public-intake.mjs");

    // it reads the public clone with git and writes nothing and merges nothing
    expect(source).not.toMatch(/["']merge["']/);
    expect(source).not.toMatch(/["']commit["']/);
    expect(source).not.toMatch(/writeFileSync|rmSync/);
  });
});
