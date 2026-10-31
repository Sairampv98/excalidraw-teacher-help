/**
 * The **rescue file**: a way to bring the editor's window back to the main
 * display that needs neither the editor, the whiteboard nor the extension
 * (D-360).
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const findRepoRoot = (): string => {
  let current = process.cwd();

  for (let depth = 0; depth < 8; depth++) {
    if (
      existsSync(
        join(
          current,
          "packages",
          "vscode-bridge",
          "scripts",
          "rescue-editor-window.ps1",
        ),
      )
    ) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  throw new Error("the rescue file was not found");
};

const root = findRepoRoot();
const script = join(
  root,
  "packages",
  "vscode-bridge",
  "scripts",
  "rescue-editor-window.ps1",
);

const runScript = (...args: string[]) =>
  spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
    { encoding: "utf8", windowsHide: true },
  );

describe("the rescue file for a window that is out of reach (D-360)", () => {
  it("AC-421 it moves only a window that is on no real display, and never a minimised one", () => {
    const source = readFileSync(script, "utf8");

    // the lost windows: not on a real display, and not minimised
    expect(source).toContain(
      "Where-Object { (-not $_.OnRealDisplay) -and (-not $_.Minimised) }",
    );

    // a virtual display is not a real one: its adapter names itself virtual
    expect(source).toContain("virtual|indirect|");

    // the window goes to the main display's work area, centred and no bigger
    // than 90 percent of it
    expect(source).toContain("SystemParametersInfo(0x0030");
    expect(source).toContain("aw * 0.9");

    // the launcher runs it with no setting of the machine changed
    const launcher = readFileSync(
      join(
        root,
        "packages",
        "vscode-bridge",
        "scripts",
        "rescue-editor-window.cmd",
      ),
      "utf8",
    );

    expect(launcher).toContain("-ExecutionPolicy Bypass");
    expect(launcher).toContain('-File "%~dp0rescue-editor-window.ps1"');
    expect(launcher).toContain("pause");
  });

  it.skipIf(process.platform !== "win32")(
    "AC-421 the real file compiles and lists the editor's windows without moving one",
    () => {
      expect(runScript("-SelfTest").stdout.trim()).toBe("OK");

      const listed = runScript("-List", "-ProcessName", "NoSuchProgramHere");

      // no such program: an empty list, and nothing moved
      expect(JSON.parse(listed.stdout.trim() || "[]")).toEqual([]);

      // the editor's own windows, if there are any: each says where it is
      const own = JSON.parse(runScript("-List").stdout.trim() || "[]") as {
        onRealDisplay: boolean;
        minimised: boolean;
        wouldMove: boolean;
      }[];

      for (const window of own) {
        expect(typeof window.onRealDisplay).toBe("boolean");
        expect(window.wouldMove).toBe(
          !window.onRealDisplay && !window.minimised,
        );
      }
    },
    60_000,
  );
});
