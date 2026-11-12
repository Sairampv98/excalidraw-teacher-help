/**
 * AC-678 to AC-682 - the plan of the gate (D-581 to D-585): the timing tests are
 * measured alone, a static failure stops the tests, the fast tier runs what a
 * change can reach, the static checks keep a cache, and each gate leaves a record.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  TEST_FILE,
  buildResult,
  cacheArgs,
  changedSources,
  excludeArgs,
  fastPlans,
  gateCacheDir,
  keepsGoing,
  parseFailures,
  resultFile,
  selectTier,
  shouldRunTests,
} from "../lib/gatePlan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const gateSource = fs.readFileSync(
  path.join(here, "..", "..", "tins-gate.mjs"),
  "utf8",
);

describe("AC-678 the timing tests are measured alone and left out of the big run", () => {
  it("each timing test becomes one --exclude", () => {
    expect(excludeArgs(["a/x.test.tsx", "b/y.test.ts"])).toEqual([
      "--exclude",
      "a/x.test.tsx",
      "--exclude",
      "b/y.test.ts",
    ]);
    expect(excludeArgs([])).toEqual([]);
  });

  it("the gate leaves them out of the main run and runs them alone", () => {
    expect(gateSource).toMatch(/\.\.\.excludeArgs\(timingTests\)/);
    // the lone run still names the files itself, with one worker
    expect(gateSource).toMatch(/\.\.\.timingTests,\s*"--maxWorkers=1"/);
  });
});

describe("AC-679 a static failure stops the tests", () => {
  it("the tests do not run after a failed typecheck, lint or format check", () => {
    expect(shouldRunTests({ staticFailed: true, env: {} })).toBe(false);
    expect(shouldRunTests({ staticFailed: false, env: {} })).toBe(true);
  });

  it("GATE_KEEP_GOING runs them anyway", () => {
    expect(keepsGoing({ GATE_KEEP_GOING: "1" })).toBe(true);
    expect(keepsGoing({ GATE_KEEP_GOING: "true" })).toBe(true);
    expect(keepsGoing({ GATE_KEEP_GOING: "0" })).toBe(false);
    expect(keepsGoing({})).toBe(false);
    expect(
      shouldRunTests({ staticFailed: true, env: { GATE_KEEP_GOING: "1" } }),
    ).toBe(true);
  });

  it("the gate asks before it runs vitest", () => {
    expect(gateSource).toMatch(/shouldRunTests\(\{/);
  });
});

describe("AC-680 the fast tier runs what a change can reach", () => {
  it("the tier is full unless GATE_FAST is set", () => {
    expect(selectTier({})).toBe("full");
    expect(selectTier({ GATE_FAST: "1" })).toBe("fast");
    expect(selectTier({ GATE_FAST: "true" })).toBe("fast");
    expect(selectTier({ GATE_FAST: "0" })).toBe("full");
  });

  it("changed files are kept to what can reach a test, once, with slashes", () => {
    expect(
      changedSources(
        "packages\\excalidraw\\scene\\a.ts\nREADME.md\nscripts/ui/run.mjs\n",
        "packages/excalidraw/scene/a.ts\nscripts/ops/new.mjs\ndocs/next.md\n",
      ),
    ).toEqual([
      "packages/excalidraw/scene/a.ts",
      "scripts/ui/run.mjs",
      "scripts/ops/new.mjs",
    ]);
  });

  it("it runs the related tests and always the tests of the scripts", () => {
    const plans = fastPlans({
      changed: ["packages/excalidraw/scene/a.ts"],
      scriptsTests: ["scripts/ui/tests/uiGate.test.mjs"],
    });

    expect(plans.map((plan) => plan.name)).toEqual([
      "vitest related",
      "vitest scripts",
    ]);
    expect(plans[0].args).toEqual([
      "related",
      "packages/excalidraw/scene/a.ts",
      "--run",
      "--passWithNoTests",
    ]);
    expect(plans[1].args).toEqual(["run", "scripts/ui/tests/uiGate.test.mjs"]);
  });

  it("the tests of the scripts, which are .mjs files, are test files", () => {
    for (const name of [
      "a.test.mjs",
      "a.test.ts",
      "a.test.tsx",
      "a.spec.js",
      "a_test.cjs",
    ]) {
      expect(TEST_FILE.test(name)).toBe(true);
    }

    expect(TEST_FILE.test("a.mjs")).toBe(false);
    expect(TEST_FILE.test("test.mjs")).toBe(false);
  });

  it("with nothing changed only the scripts' tests run, and with no scripts' tests nothing", () => {
    expect(
      fastPlans({ changed: [], scriptsTests: ["scripts/x/tests/a.test.mjs"] }),
    ).toHaveLength(1);
    expect(fastPlans({ changed: [], scriptsTests: [] })).toEqual([]);
  });

  it("the merge is never fast unless it is asked: the gate reads the tier from the environment only", () => {
    expect(gateSource).toMatch(/selectTier\(process\.env\)/);
  });
});

describe("AC-681 the static checks keep a cache outside the repository", () => {
  it("each of the three has its cache flags, comparing contents", () => {
    const flags = cacheArgs("/c/cache");

    expect(Object.keys(flags).sort()).toEqual([
      "eslint",
      "prettier",
      "typecheck",
    ]);
    expect(flags.typecheck).toContain("--incremental");
    expect(flags.eslint).toEqual(
      expect.arrayContaining(["--cache", "--cache-strategy", "content"]),
    );
    expect(flags.prettier).toEqual(
      expect.arrayContaining(["--cache", "--cache-strategy", "content"]),
    );

    for (const list of Object.values(flags)) {
      expect(list.join(" ")).toContain(path.join("/c/cache", ""));
    }
  });

  it("the cache folder is one for each checkout, in the temp folder", () => {
    const one = gateCacheDir("C:/repo/a", "/tmp");
    const two = gateCacheDir("C:/repo/b", "/tmp");

    expect(one).not.toBe(two);
    expect(gateCacheDir("C:/repo/a", "/tmp")).toBe(one);
    expect(one.startsWith(path.join("/tmp", "excalidraw-gate-cache"))).toBe(
      true,
    );
  });

  it("the gate uses them and GATE_NO_CACHE turns them off", () => {
    expect(gateSource).toMatch(/GATE_NO_CACHE/);
    expect(gateSource).toMatch(/cacheArgs\(gateCacheDir\(root, tmpdir\(\)\)\)/);
  });
});

describe("AC-682 each gate leaves a record", () => {
  const OUTPUT = [
    "[31m FAIL [39m packages/excalidraw/tests/a.test.tsx > AC-1 builds > AC-1 each one",
    "    | FAIL packages/excalidraw/tests/a.test.tsx > AC-1 builds > AC-1 each one",
    "FAIL scripts/x/tests/b.test.mjs > AC-2 reads",
    "not a failure line",
  ].join("\n");

  it("failing tests are read out of vitest's output, once each, colours stripped", () => {
    expect(parseFailures(OUTPUT)).toEqual([
      {
        file: "packages/excalidraw/tests/a.test.tsx",
        test: "AC-1 builds > AC-1 each one",
      },
      { file: "scripts/x/tests/b.test.mjs", test: "AC-2 reads" },
    ]);
    expect(parseFailures("")).toEqual([]);
    expect(parseFailures(undefined)).toEqual([]);
  });

  it("the record has the tier, the workers, the minutes, every step and the failures", () => {
    const record = buildResult({
      tier: "full",
      steps: [
        { name: "typecheck", ok: true, secs: 41.26, output: "" },
        { name: "vitest", ok: false, secs: 300.04, output: OUTPUT },
      ],
      workers: 6,
      freeMB: 8223,
      startedAt: 1_000_000,
      endedAt: 1_000_000 + 8.1 * 60000,
      timingTests: ["packages/excalidraw/tests/flowLargePresets.test.tsx"],
      skipped: [],
    });

    expect(record.ok).toBe(false);
    expect(record.tier).toBe("full");
    expect(record.workers).toBe(6);
    expect(record.minutes).toBe(8.1);
    expect(record.steps.map((step) => step.name)).toEqual([
      "typecheck",
      "vitest",
    ]);
    expect(record.steps[0].failures).toEqual([]);
    expect(record.steps[1].failures).toHaveLength(2);
    expect(record.steps[1].seconds).toBe(300);
    expect(record.timingTests).toHaveLength(1);
  });

  it("a gate in which every step passed says ok", () => {
    expect(
      buildResult({
        tier: "fast",
        steps: [{ name: "vitest related", ok: true, secs: 3, output: "" }],
        workers: 2,
        freeMB: 5000,
        startedAt: 0,
        endedAt: 60000,
      }).ok,
    ).toBe(true);
  });

  it("the record of a checkout is one file in the shared folder, outside the repository", () => {
    const one = resultFile("/tmp", "C:/repo/a");
    const two = resultFile("/tmp", "C:/repo/b");

    expect(one).not.toBe(two);
    expect(resultFile("/tmp", "C:/repo/a")).toBe(one);
    expect(
      one.startsWith(path.join("/tmp", "excalidraw-ops", "gate-results")),
    ).toBe(true);
    expect(one.endsWith(".json")).toBe(true);
    expect(
      buildResult({
        root: "C:/repo/a",
        tier: "full",
        steps: [],
        workers: 1,
        freeMB: 1,
        startedAt: 0,
        endedAt: 1,
      }).root,
    ).toBe("C:/repo/a");
  });

  it("the gate writes it there, and not inside the checkout where a commit would take it", () => {
    expect(gateSource).toMatch(/resultFile\(tmpdir\(\), root\)/);
    expect(gateSource).not.toMatch(/join\(stateDir, "state-gate-result/);
  });
});
