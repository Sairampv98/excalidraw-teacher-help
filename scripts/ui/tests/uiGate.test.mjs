/**
 * AC-545 and AC-546 - the pieces of the UI gate: what it reads from the requirements file,
 * how it judges a scenario, what it refuses and what it tells the owner.
 *
 * AC-646 - the gate and the clips drive a Chromium of Playwright's own and close it (D-543).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { findBrowser } from "../lib/app.mjs";
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

describe("AC-646 the gate and the clips drive a Chromium of Playwright's own", () => {
  const env = { LOCALAPPDATA: path.join("C:", "Users", "someone", "Local") };
  const root = path.join(env.LOCALAPPDATA, "ms-playwright");
  const listing = [
    "ffmpeg-1011",
    "chromium-999",
    "chromium-1243",
    "chromium_headless_shell-1100",
    "chromium_headless_shell-1243",
    "winldd-1007",
  ];
  const pick = (extra = {}) =>
    findBrowser({ env, listDir: () => listing, exists: () => true, ...extra });
  const chromeOfTheComputer = (candidate) =>
    candidate.includes("Google/Chrome/Application");

  it("a run with no window takes the newest headless shell", () => {
    expect(pick()).toBe(
      path.join(
        root,
        "chromium_headless_shell-1243",
        "chrome-headless-shell-win64",
        "chrome-headless-shell.exe",
      ),
    );
  });

  it("a run with a window takes the newest whole Chromium, by its number and not by its spelling", () => {
    expect(pick({ headed: true })).toBe(
      path.join(root, "chromium-1243", "chrome-win64", "chrome.exe"),
    );
  });

  it("Playwright's Chromium comes before the Chrome of the computer, which is the fall-back", () => {
    expect(pick()).not.toContain("Google");
    expect(
      findBrowser({
        env,
        listDir: () => listing,
        exists: chromeOfTheComputer,
      }),
    ).toBe("C:/Program Files/Google/Chrome/Application/chrome.exe");
  });

  it("with no folder of Playwright's builds, the fall-back is used", () => {
    expect(
      findBrowser({
        env,
        listDir: () => {
          throw new Error("no such folder");
        },
        exists: chromeOfTheComputer,
      }),
    ).toBe("C:/Program Files/Google/Chrome/Application/chrome.exe");
  });

  it("the browser the person names wins, and PLAYWRIGHT_BROWSERS_PATH moves the folder looked in", () => {
    expect(pick({ env: { ...env, UI_BROWSER: "X:/mine/browser.exe" } })).toBe(
      "X:/mine/browser.exe",
    );
    expect(
      pick({ env: { PLAYWRIGHT_BROWSERS_PATH: path.join("D:", "pw") } }),
    ).toBe(
      path.join(
        "D:",
        "pw",
        "chromium_headless_shell-1243",
        "chrome-headless-shell-win64",
        "chrome-headless-shell.exe",
      ),
    );
  });

  it("no browser at all is said plainly, with what to do", () => {
    expect(() => pick({ exists: () => false })).toThrow(/UI_BROWSER/);
  });

  it("the UI gate closes its browser whatever a scenario does", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, "..", "run.mjs"), "utf8");

    expect(source).toMatch(/finally\s*\{\s*await app\.close\(\);\s*\}/);
  });
});
