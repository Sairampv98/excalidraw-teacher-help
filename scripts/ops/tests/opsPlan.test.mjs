/**
 * AC-683 - the pre-gate (D-586) and AC-684 - the gate wrapper (D-587).
 * AC-692 - a change of documents only is checked in seconds (D-595).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildEnv,
  docsOnlyTests,
  isDocsOnly,
  kitArgs,
  logName,
  memoryAdvice,
  parseRunArgs,
  pregateSteps,
  runProblem,
} from "../lib/opsPlan.mjs";

describe("AC-683 the pre-gate checks what was changed", () => {
  const names = (steps) => steps.map((step) => step.name);

  it("always lints the SPEC and typechecks, and only checks the files that changed", () => {
    expect(
      names(
        pregateSteps({
          changed: ["packages/excalidraw/a.ts", "scripts/x.mjs"],
          allChanged: [
            "packages/excalidraw/a.ts",
            "scripts/x.mjs",
            "docs/next.md",
          ],
        }),
      ),
    ).toEqual(["spec lint", "prettier", "eslint", "typecheck"]);
  });

  it("with no document and no script changed, the steps for them are left out", () => {
    expect(
      names(
        pregateSteps({
          changed: ["scripts/x.mjs"],
          allChanged: ["scripts/x.mjs"],
        }),
      ),
    ).toEqual(["spec lint", "typecheck"]);
  });

  it("prettier takes the documents of the gate's own patterns, with its ignore files", () => {
    const [, prettier] = pregateSteps({
      changed: [],
      allChanged: ["docs/next.md", "a/b.json", "c/d.png"],
    });

    expect(prettier.args.slice(0, 2)).toEqual(["docs/next.md", "a/b.json"]);
    expect(prettier.args).toContain("--list-different");
    expect(prettier.args).toContain("--ignore-path=.eslintignore");
  });

  it("eslint is told the same limit as the gate", () => {
    const steps = pregateSteps({
      changed: ["excalidraw-app/a.tsx", "scripts/b.mjs"],
      allChanged: [],
    });
    const eslint = steps.find((step) => step.name === "eslint");

    expect(eslint.args).toEqual(["--max-warnings=0", "excalidraw-app/a.tsx"]);
  });

  it("the caches are used when a folder is given", () => {
    const steps = pregateSteps({
      changed: ["a.ts"],
      allChanged: [],
      cacheDir: path.join("/tmp", "c"),
    });

    expect(steps.find((step) => step.name === "typecheck").args).toContain(
      "--incremental",
    );
    expect(steps.find((step) => step.name === "eslint").args).toContain(
      "--cache",
    );
  });
});

describe("AC-684 the gate wrapper", () => {
  it("reads what was asked", () => {
    expect(
      parseRunArgs(["close", "--note", "a change", "--fast", "--jobs", "4"]),
    ).toMatchObject({ kind: "close", note: "a change", fast: true, jobs: 4 });
    expect(parseRunArgs(["merge", "v3a-3-gate-speed"])).toMatchObject({
      kind: "merge",
      task: "v3a-3-gate-speed",
      fast: false,
      jobs: null,
    });
  });

  it("refuses what it cannot do, plainly", () => {
    expect(runProblem(parseRunArgs(["close"]))).toBeNull();
    expect(runProblem(parseRunArgs(["merge", "t"]))).toBeNull();
    expect(runProblem(parseRunArgs(["merge"]))).toMatch(/id of the task/);
    expect(runProblem(parseRunArgs(["explode"]))).toMatch(/close or merge/);
    expect(runProblem(parseRunArgs([]))).toMatch(/close or merge/);
  });

  it("gives the kit its own arguments", () => {
    expect(kitArgs(parseRunArgs(["close", "--note", "x"]))).toEqual([
      "close",
      "--note",
      "x",
    ]);
    expect(kitArgs(parseRunArgs(["close"]))).toEqual(["close"]);
    expect(kitArgs(parseRunArgs(["merge", "t1"]))).toEqual(["merge", "t1"]);
  });

  it("puts Node first on the PATH, leaves the workers to the gate, and sets the tier", () => {
    const key = process.platform === "win32" ? "Path" : "PATH";
    const env = buildEnv(
      { [key]: "/usr/bin", GATE_JOBS: "2", KEEP: "yes" },
      { nodeDir: "/nvm/v20.19.6", gitDir: "/git/cmd", fast: false, jobs: null },
    );

    expect(env[key].startsWith("/nvm/v20.19.6")).toBe(true);
    expect(env[key]).toContain("/git/cmd");
    expect(env[key]).toContain("/usr/bin");
    expect(env.GATE_JOBS).toBeUndefined();
    expect(env.GATE_FAST).toBeUndefined();
    expect(env.KEEP).toBe("yes");

    const fast = buildEnv(
      { [key]: "" },
      { nodeDir: null, gitDir: null, fast: true, jobs: 3 },
    );

    expect(fast.GATE_FAST).toBe("1");
    expect(fast.GATE_JOBS).toBe("3");
  });

  it("says nothing when there is memory, and names the biggest users when there is not", () => {
    expect(
      memoryAdvice({ freeMB: 6000, minFreeMB: 4000, users: [] }),
    ).toBeNull();

    const advice = memoryAdvice({
      freeMB: 2400,
      minFreeMB: 4000,
      users: [
        { name: "chrome.exe", memMB: 3400 },
        { name: "vmwp.exe", memMB: 2100 },
      ],
    });

    expect(advice).toContain("only 2.3 GB free");
    expect(advice).toContain("chrome.exe 3.3 GB");
    expect(advice).toContain("close a browser or a virtual machine");
  });

  it("names its log from the task or the folder and the time", () => {
    const at = Date.UTC(2026, 10, 12, 21, 30, 5);

    expect(
      logName({ kind: "merge", task: "v3a-1-tooling", folder: "x", at }),
    ).toBe("v3a-1-tooling-merge-2026-11-12-21-30-05.log");
    expect(
      logName({ kind: "close", task: null, folder: "my folder", at }),
    ).toBe("my_folder-close-2026-11-12-21-30-05.log");
  });
});

describe("AC-692 a change of documents only is checked in seconds", () => {
  it("is told by every changed file being a document", () => {
    expect(isDocsOnly(["SPEC.md", "docs/next.md"])).toBe(true);
    expect(isDocsOnly(["tasks/a.md", "sessions/b.md", "README.md"])).toBe(true);
    expect(isDocsOnly(["docs/media/clip.gif"])).toBe(true);
    expect(isDocsOnly(["docs/next.md", "scripts/ops/pregate.mjs"])).toBe(false);
    expect(isDocsOnly(["SPEC.md", "package.json"])).toBe(false);
    expect(isDocsOnly(["packages/excalidraw/a.ts"])).toBe(false);
  });

  it("is not told when nothing changed", () => {
    expect(isDocsOnly([])).toBe(false);
  });

  it("leaves the typecheck out and keeps the SPEC lint and prettier", () => {
    const steps = pregateSteps({
      changed: [],
      allChanged: ["SPEC.md", "docs/next.md"],
      docsOnly: true,
    });

    expect(steps.map((step) => step.name)).toEqual(["spec lint", "prettier"]);
  });

  it("keeps the typecheck when the change is not only documents", () => {
    const steps = pregateSteps({
      changed: ["scripts/x.mjs"],
      allChanged: ["scripts/x.mjs", "SPEC.md"],
      docsOnly: false,
    });

    expect(steps.map((step) => step.name)).toContain("typecheck");
  });

  it("still runs the test of the handoff file when the handoff file changed, and nothing otherwise", () => {
    expect(docsOnlyTests(["SPEC.md", "docs/next.md"])).toEqual([
      {
        name: "vitest handoff",
        args: ["run", "scripts/public-sync/tests/handoff.test.mjs"],
      },
    ]);
    expect(docsOnlyTests(["SPEC.md"])).toEqual([]);
  });

  it("the pre-gate script uses it, and does not walk the scripts' tests for it", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(
      path.join(here, "..", "pregate.mjs"),
      "utf8",
    );

    expect(source).toMatch(/isDocsOnly\(documents\)/);
    expect(source).toMatch(/docsOnlyTests\(documents\)/);
    expect(source).toMatch(/if \(!docsOnly\) \{\s*walk\(/);
    // the base can be named (PREGATE_BASE), for a checkout whose own changes are not the task's
    expect(source).toMatch(/process\.env\.PREGATE_BASE/);
  });
});
