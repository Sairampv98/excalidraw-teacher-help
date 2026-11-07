/**
 * AC-545 and AC-546 - the pieces of the UI gate: what it reads from the requirements file,
 * how it judges a scenario, what it refuses and what it tells the owner.
 */

import path from "node:path";

import { describe, expect, it } from "vitest";

import { isLocalUrl, outsideByHost } from "../lib/guard.mjs";
import { replayCommand, reproCard } from "../lib/report.mjs";
import { defineScenario, runScenario } from "../lib/scenario.mjs";
import { parseSpecRows } from "../lib/specRows.mjs";
import { resolveInside } from "../lib/staticServer.mjs";

const run = (def) => runScenario(def, (ui) => ui, {});

describe("AC-545 the gate judges a scenario", () => {
  it("a scenario whose checks hold passes", async () => {
    const result = await run(
      defineScenario({
        id: "ok",
        rows: ["AC-1"],
        run: async (ui) => {
          await ui.step("a", async () =>
            ui.expect(true, { expected: "x", observed: "y" }),
          );
        },
      }),
    );

    expect(result.status).toBe("pass");
  });

  it("a check that fails is a discrepancy that names the step", async () => {
    const result = await run(
      defineScenario({
        id: "bad",
        rows: ["AC-1"],
        run: async (ui) => {
          await ui.step("first", async () => {});
          await ui.step("second", async () =>
            ui.expect(false, { expected: "2/3", observed: "3/3" }),
          );
        },
      }),
    );

    expect(result.status).toBe("discrepancy");
    expect(result.steps.map((s) => s.ok)).toEqual([true, false]);
  });

  it("a scenario with no rows or no run is refused", () => {
    expect(() => defineScenario({ id: "x" })).toThrow();
  });

  it("the repro card carries the replay command and the question", async () => {
    const result = await run(
      defineScenario({
        id: "card",
        rows: ["AC-9"],
        run: async (ui) => {
          await ui.step("s", async () =>
            ui.expect(false, { expected: "e", observed: "o" }),
          );
        },
      }),
    );
    const card = reproCard(
      result,
      new Map([["AC-9", { id: "AC-9", name: "n", text: "t" }]]),
    );

    expect(card).toContain(replayCommand("card"));
    expect(card).toContain("Your answer");
  });
});

describe("AC-546 the gate stays on this computer and in its folder", () => {
  it("reads rows and tells local from outside addresses", () => {
    const rows = parseSpecRows(
      "| AC-7 | name | `a/b.test.ts` | text |\n| D-3 | n | locked | t |",
    );

    expect(rows.map((r) => r.id)).toEqual(["AC-7", "D-3"]);
    expect(isLocalUrl("http://127.0.0.1:5000/x")).toBe(true);
    expect(isLocalUrl("https://cdn.example.com/f.woff2")).toBe(false);
    expect(outsideByHost(["https://a.com/1", "https://a.com/2"])).toEqual([
      { host: "a.com", count: 2 },
    ]);
  });

  it("the static server does not leave its folder", () => {
    const root = path.resolve("some-root");

    expect(resolveInside(root, "/../secret").startsWith(root + path.sep)).toBe(
      true,
    );
    expect(
      resolveInside(root, "/..%2f..%2fsecret").startsWith(root + path.sep),
    ).toBe(true);
    expect(resolveInside(root, "/a.js")).toBe(path.join(root, "a.js"));
  });
});
