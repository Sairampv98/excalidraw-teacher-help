/**
 * The editor's own window: **parked** out of sight, **brought back**, and the
 * proof that **nothing uses a virtual display driver** any more (D-328, D-329,
 * D-147 to D-150).
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createWindowPark,
  isParkedPlace,
  PARK_X,
  PARK_Y,
  parseDisplays,
  parsePlacement,
  parseWindow,
  parseWorkArea,
} from "../extension/src/windowPark";

/** The package root, found by walking up from the working directory. */
const findPackageRoot = (): string => {
  let current = process.cwd();

  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(current, "packages", "vscode-bridge");

    if (existsSync(join(candidate, "extension", "package.json"))) {
      return candidate;
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  throw new Error("the vscode-bridge package was not found");
};

const packageRoot = findPackageRoot();
const repoRoot = join(packageRoot, "..", "..");

const read = (...parts: string[]): string =>
  readFileSync(join(packageRoot, ...parts), "utf8");

/**
 * A file WITHOUT its comments.
 *
 * Some of these tests are about the CODE and not about the prose: the helper
 * explains why it never takes the focus, and the explanation must not be
 * mistaken for the code that does not.
 */
const codeOf = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, "").replace(/\/\/.*$/, ""))
    .join("\n");

/** The REAL helper, run for real: its answer is the answer the extension gets. */
const runTheRealHelper = (
  args: string[],
): Promise<{ code: number | null; output: string }> =>
  new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(packageRoot, "extension", "media", "window.ps1"),
        ...args,
      ],
      { windowsHide: true },
    );

    let output = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });

    child.on("exit", (code) => {
      resolve({ code, output });
    });
  });

/** The window the rule finds: the teacher's editor, on a display. */
const ON_A_DISPLAY = {
  found: true,
  visible: true,
  handle: 4242,
  title: "excalidraw - Visual Studio Code",
  x: 100,
  y: 80,
  width: 1200,
  height: 800,
};

/** The same window, once it is parked. */
const PARKED = { ...ON_A_DISPLAY, x: PARK_X, y: PARK_Y };

/** What the helper says about a move that landed. */
const landed = (rect: Record<string, unknown>, extra = {}) => ({
  placed: true,
  moved: true,
  wasMaximised: false,
  restored: false,
  maximised: false,
  minimised: false,
  measuredX: rect.x,
  measuredY: rect.y,
  measuredWidth: rect.width,
  measuredHeight: rect.height,
  reason: "",
  ...extra,
});

const RULE = {
  titleLike: "excalidraw",
  processName: "Code",
  subject: "your editor's window",
};

/**
 * A helper that answers without a Windows machine behind it.
 *
 * `windows` is what Find says, one answer after the other (the last one
 * repeats); `place` is what a Place says.
 */
const fakeHelper = (options: {
  windows: Record<string, unknown>[];
  place?: (args: string[]) => Record<string, unknown>;
  workArea?: Record<string, unknown>;
  displays?: Record<string, unknown>[];
}) => {
  const calls: string[][] = [];
  let found = 0;

  const run = async (args: string[]): Promise<string> => {
    calls.push(args);

    if (args.includes("Find")) {
      const next =
        options.windows[Math.min(found, options.windows.length - 1)] ?? {};

      found += 1;

      return JSON.stringify(next);
    }

    if (args.includes("Displays")) {
      return JSON.stringify({ displays: options.displays ?? [] });
    }

    if (args.includes("Primary")) {
      return JSON.stringify(
        options.workArea ?? { x: 0, y: 0, width: 1920, height: 1040 },
      );
    }

    const x = Number(args[args.indexOf("-X") + 1]);
    const y = Number(args[args.indexOf("-Y") + 1]);
    const width = Number(args[args.indexOf("-Width") + 1]);
    const height = Number(args[args.indexOf("-Height") + 1]);

    return JSON.stringify(
      options.place?.(args) ?? landed({ x, y, width, height }),
    );
  };

  return { calls, run };
};

const placeCalls = (calls: string[][]) =>
  calls.filter((args) => args.includes("Place"));

describe("the editor's window is parked and brought back", () => {
  it("AC-373 the window is parked far off every display", async () => {
    const helper = fakeHelper({ windows: [ON_A_DISPLAY] });
    const park = createWindowPark({
      scriptPath: "window.ps1",
      run: helper.run,
    });

    const result = await park.park(RULE);

    expect(result.ok).toBe(true);

    const [place] = placeCalls(helper.calls);

    // far off every display, in the size the window had
    expect(place).toContain(String(PARK_X));
    expect(place).toContain(String(PARK_Y));
    expect(place[place.indexOf("-Width") + 1]).toBe("1200");
    expect(place[place.indexOf("-Height") + 1]).toBe("800");
    expect(place[place.indexOf("-Handle") + 1]).toBe("4242");

    // a parked place is a place that is off every display, and a window on a
    // display is not parked
    expect(isParkedPlace(PARK_X, PARK_Y)).toBe(true);
    expect(isParkedPlace(0, 0)).toBe(false);
    expect(isParkedPlace(-1920, 0)).toBe(false);
  });

  it("AC-373 a park that did not happen is not reported as one", async () => {
    const helper = fakeHelper({
      windows: [ON_A_DISPLAY],
      // the call went through and the window stayed where it was: the MEASURED
      // rect is what the helper reports, and it is not where it was asked to be
      place: () =>
        landed(ON_A_DISPLAY, {
          placed: false,
          reason:
            "the window stayed where it was (1200x800 at 100,80) instead of 1200x800 at -30000,-30000",
        }),
    });
    const park = createWindowPark({
      scriptPath: "window.ps1",
      run: helper.run,
    });

    const result = await park.park(RULE);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("was not parked");
    expect(result.reason).toContain("stayed where it was");

    // and nothing is remembered about a move that did not happen: a bring back
    // finds a window on a display and leaves it alone
    const back = await park.bringBack(RULE);

    expect(back.ok).toBe(true);
    expect(back.reason).toContain("already on a display");
    expect(placeCalls(helper.calls)).toHaveLength(1);

    // the reading of the helper's own words
    expect(
      parsePlacement(
        JSON.stringify({ placed: false, moved: true, reason: "no" }),
      ),
    ).toMatchObject({ placed: false, moved: true, reason: "no" });
    expect(parsePlacement("not json")).toMatchObject({
      placed: false,
      reason: "the helper did not answer",
    });
  });

  it("AC-373 a maximised window comes back maximised", async () => {
    const maximised = {
      ...ON_A_DISPLAY,
      x: -8,
      y: -8,
      width: 1936,
      height: 1056,
    };
    const helper = fakeHelper({
      // the window is on the display, then parked, then found parked
      windows: [maximised, { ...maximised, x: PARK_X, y: PARK_Y }],
      place: (args) =>
        args.includes("-Maximise")
          ? landed(
              { x: -8, y: -8, width: 1936, height: 1056 },
              { maximised: true },
            )
          : landed(
              { x: PARK_X, y: PARK_Y, width: 1936, height: 1056 },
              { wasMaximised: true, restored: true },
            ),
    });
    const park = createWindowPark({
      scriptPath: "window.ps1",
      run: helper.run,
    });

    expect((await park.park(RULE)).ok).toBe(true);

    const back = await park.bringBack(RULE);

    expect(back.ok).toBe(true);
    expect(back.reason).toContain("maximised as it was");

    const [, second] = placeCalls(helper.calls);

    // back to where it was, and maximised again
    expect(second).toContain("-Maximise");
    expect(second[second.indexOf("-X") + 1]).toBe("-8");
    expect(second[second.indexOf("-Y") + 1]).toBe("-8");
  });

  it("AC-373 with nothing kept the window comes back on the primary display", async () => {
    // a window that is parked, and a service that has never parked anything:
    // the extension was restarted while the window was out of sight
    const helper = fakeHelper({
      windows: [PARKED],
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    });
    const park = createWindowPark({
      scriptPath: "window.ps1",
      run: helper.run,
    });

    const back = await park.bringBack(RULE);

    expect(back.ok).toBe(true);
    expect(helper.calls.some((args) => args.includes("Primary"))).toBe(true);

    const [place] = placeCalls(helper.calls);
    const x = Number(place[place.indexOf("-X") + 1]);
    const y = Number(place[place.indexOf("-Y") + 1]);
    const width = Number(place[place.indexOf("-Width") + 1]);
    const height = Number(place[place.indexOf("-Height") + 1]);

    // inside the primary display's work area, centred
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(1920);
    expect(y + height).toBeLessThanOrEqual(1040);
    expect(isParkedPlace(x, y)).toBe(false);

    // a work area that is nothing is no display, and it is said
    expect(
      parseWorkArea(JSON.stringify({ x: 0, y: 0, width: 0, height: 0 })),
    ).toBe(null);
    expect(
      parseWorkArea(JSON.stringify({ x: 0, y: 0, width: 1920, height: 1040 })),
    ).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
  });

  it("AC-373 nothing parks by itself and a minimised window is left alone", async () => {
    const helper = fakeHelper({
      windows: [ON_A_DISPLAY],
      place: () =>
        landed(ON_A_DISPLAY, {
          placed: false,
          minimised: true,
          reason:
            "the window is minimised, so it was left where it was - restore it and try again",
        }),
    });
    const park = createWindowPark({
      scriptPath: "window.ps1",
      run: helper.run,
    });

    // making the service and reading from it moves nothing
    expect(await park.isParked(RULE)).toBe(false);
    expect(placeCalls(helper.calls)).toHaveLength(0);

    // a minimised window is left alone, and the teacher is told
    const result = await park.park(RULE);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("minimised");

    // the extension asks for a park in ONE place - the teacher's own command or
    // button - and nowhere else
    const source = codeOf(read("extension", "src", "extension.ts"));

    expect(source.match(/windowPark\.park\(/g)).toHaveLength(1);
    expect(source).toMatch(/const parkEditor = async[\s\S]*windowPark\.park\(/);
  });

  it("AC-373 a parked window is brought back when the extension ends", () => {
    const source = codeOf(read("extension", "src", "extension.ts"));

    // the shutdown reads whether the window is parked and brings it back, and
    // `deactivate` returns it so the editor waits for it
    expect(source).toMatch(
      /shutdownWindow = async \(\) => \{[\s\S]*isParked\(editorRule\)[\s\S]*bringBack\(editorRule\)/,
    );
    expect(source).toMatch(
      /export function deactivate\(\)[^{]*\{[\s\S]*shutdownWindow\?\.\(\)[\s\S]*return shutdown/,
    );
  });

  it("AC-183 the editor's window is moved without taking the focus", async () => {
    // found BY RULE: the process and the title, and never a handle
    const helper = fakeHelper({ windows: [ON_A_DISPLAY] });
    const park = createWindowPark({
      scriptPath: "window.ps1",
      run: helper.run,
    });

    await park.park(RULE);

    const [find] = helper.calls;

    expect(find).toContain("Find");
    expect(find[find.indexOf("-TitleLike") + 1]).toBe("excalidraw");
    expect(find[find.indexOf("-ProcessName") + 1]).toBe("Code");
    expect(find).not.toContain("-Handle");

    // the helper's CODE (not its prose) moves a window with SWP_NOACTIVATE and
    // never activates, focuses or raises one
    const helperCode = codeOf(read("extension", "media", "window.ps1"));

    expect(helperCode).toContain("SWP_NOACTIVATE");
    expect(helperCode).toMatch(
      /SetWindowPos\(hwnd, IntPtr\.Zero, x, y, width, height, flags\)/,
    );
    expect(helperCode).toMatch(
      /uint flags = SWP_NOACTIVATE \| SWP_NOZORDER \| SWP_SHOWWINDOW;/,
    );
    expect(helperCode).not.toMatch(
      /SetForegroundWindow|SetFocus|SetActiveWindow|BringWindowToTop|AttachThreadInput/,
    );
    // a minimised window is never restored: that would activate it
    expect(helperCode).toMatch(/if \(IsIconic\(hwnd\)\)/);
    expect(helperCode).toMatch(/UnMaximise[\s\S]*SW_RESTORE/);
  });

  it("AC-183 a window that was moved can be brought back, and a move that did not happen is not reported as one", async () => {
    const helper = fakeHelper({
      // the handle is a different one when the window is found again
      windows: [ON_A_DISPLAY, { ...PARKED, handle: 9999 }],
    });
    const park = createWindowPark({
      scriptPath: "window.ps1",
      run: helper.run,
    });

    expect((await park.park(RULE)).ok).toBe(true);

    const back = await park.bringBack(RULE);

    expect(back.ok).toBe(true);

    const [, second] = placeCalls(helper.calls);

    // back where it was, in the size it had - and to the window that the RULE
    // found now, not to the one that was remembered
    expect(second[second.indexOf("-X") + 1]).toBe("100");
    expect(second[second.indexOf("-Y") + 1]).toBe("80");
    expect(second[second.indexOf("-Width") + 1]).toBe("1200");
    expect(second[second.indexOf("-Handle") + 1]).toBe("9999");

    // a window that was not found is said, and nothing is placed
    const nowhere = fakeHelper({ windows: [{ found: false }] });
    const lost = createWindowPark({
      scriptPath: "window.ps1",
      run: nowhere.run,
    });

    expect((await lost.park(RULE)).ok).toBe(false);
    expect((await lost.park(RULE)).reason).toContain("no window was found");
    expect(placeCalls(nowhere.calls)).toHaveLength(0);

    expect(parseWindow("")).toBe(null);
  });

  it.skipIf(process.platform !== "win32")(
    "AC-373 the real helper answers: a window that is not there, and the primary display",
    async () => {
      const missing = await runTheRealHelper([
        "-Mode",
        "Find",
        "-TitleLike",
        "no window is called this - 9f3c1d",
        "-ProcessName",
        "Code",
      ]);

      expect(parseWindow(missing.output)).toMatchObject({ found: false });

      const primary = await runTheRealHelper(["-Mode", "Primary"]);
      const area = parseWorkArea(primary.output);

      expect(area).not.toBe(null);
      expect(area?.width).toBeGreaterThan(0);
      expect(area?.height).toBeGreaterThan(0);
    },
    60_000,
  );
});

/** The displays of a desktop with one real screen and one virtual one. */
const REAL_DISPLAY = {
  device: "DISPLAY1",
  adapter: "Intel(R) UHD Graphics",
  virtual: false,
  primary: true,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
};

const VIRTUAL_DISPLAY = {
  device: "DISPLAY4",
  adapter: "an indirect display adapter",
  virtual: true,
  primary: false,
  x: 1920,
  y: 0,
  width: 1920,
  height: 1080,
};

describe("the focus route puts the editor's window on a virtual display", () => {
  it("AC-408 the helper's list of displays is read, and what is not a display is left out", () => {
    const list = parseDisplays(
      JSON.stringify({
        displays: [
          REAL_DISPLAY,
          VIRTUAL_DISPLAY,
          { width: 0, height: 0 },
          null,
        ],
      }),
    );

    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ primary: true, virtual: false });
    expect(list[1]).toMatchObject({
      virtual: true,
      primary: false,
      x: 1920,
      width: 1920,
    });
    expect(parseDisplays("not json")).toEqual([]);
    expect(parseDisplays(JSON.stringify({ displays: "no" }))).toEqual([]);
  });

  it("AC-408 the window is put on the virtual display, filling it, and comes back where it was", async () => {
    const helper = fakeHelper({
      // on a display, then found on the virtual display for the way back
      windows: [
        ON_A_DISPLAY,
        { ...ON_A_DISPLAY, x: 1920, y: 0, width: 1920, height: 1080 },
      ],
      displays: [REAL_DISPLAY, VIRTUAL_DISPLAY],
    });
    const park = createWindowPark({
      scriptPath: "window.ps1",
      run: helper.run,
    });

    const result = await park.moveToVirtualDisplay(RULE);

    expect(result).toMatchObject({ ok: true, moved: true });

    const [place] = placeCalls(helper.calls);

    expect(place[place.indexOf("-X") + 1]).toBe("1920");
    expect(place[place.indexOf("-Y") + 1]).toBe("0");
    expect(place[place.indexOf("-Width") + 1]).toBe("1920");
    expect(place[place.indexOf("-Height") + 1]).toBe("1080");

    // the way back is the way of a parked window: where it was, as big as it was
    const back = await park.bringBack(RULE);

    expect(back.ok).toBe(true);

    const [, second] = placeCalls(helper.calls);

    expect(second[second.indexOf("-X") + 1]).toBe("100");
    expect(second[second.indexOf("-Y") + 1]).toBe("80");
    expect(second[second.indexOf("-Width") + 1]).toBe("1200");
    expect(second[second.indexOf("-Height") + 1]).toBe("800");
  });

  it("AC-408 a window already there is not moved, and no virtual display moves nothing", async () => {
    const there = fakeHelper({
      windows: [{ ...ON_A_DISPLAY, x: 2000, y: 100, width: 800, height: 600 }],
      displays: [REAL_DISPLAY, VIRTUAL_DISPLAY],
    });
    const parkThere = createWindowPark({
      scriptPath: "window.ps1",
      run: there.run,
    });

    expect(await parkThere.moveToVirtualDisplay(RULE)).toMatchObject({
      ok: true,
      moved: false,
    });
    expect(placeCalls(there.calls)).toHaveLength(0);

    // only the teacher's own screen: nothing is moved, and the reason says so
    const none = fakeHelper({
      windows: [ON_A_DISPLAY],
      displays: [REAL_DISPLAY],
    });
    const parkNone = createWindowPark({
      scriptPath: "window.ps1",
      run: none.run,
    });
    const result = await parkNone.moveToVirtualDisplay(RULE);

    expect(result.ok).toBe(false);
    expect(result.moved).toBe(false);
    expect(result.reason).toContain("no virtual display");
    expect(placeCalls(none.calls)).toHaveLength(0);

    // a window that is not found is not moved
    const lost = fakeHelper({
      windows: [{ found: false }],
      displays: [VIRTUAL_DISPLAY],
    });
    const parkLost = createWindowPark({
      scriptPath: "window.ps1",
      run: lost.run,
    });

    expect((await parkLost.moveToVirtualDisplay(RULE)).ok).toBe(false);
    expect(placeCalls(lost.calls)).toHaveLength(0);
  });

  it("AC-409 the extension moves the window for the focus route, and puts it back", () => {
    const source = codeOf(read("extension", "src", "extension.ts"));

    // the move is tried when the route is the focus route and Control is on, and
    // when the window is needed in front
    expect(source).toMatch(
      /state\.route === "focus"[\s\S]*inputGate\.enabled[\s\S]*moveToVirtual\(\)/,
    );
    expect(source).toMatch(/onNeed:[\s\S]*moveToVirtual\(\)[\s\S]*bringBack/);

    // Control ending, the bridge going away and the extension ending put it back
    expect(source).toMatch(
      /windowInput\?\.stop\(\);[\s\S]*leaveVirtualDisplay\(\)/,
    );
    expect(source).toMatch(
      /shutdownWindow = async \(\) => \{[\s\S]*onVirtualDisplay[\s\S]*bringBack\(editorRule\)/,
    );

    // and the helper lists displays and says which are virtual
    const helperSource = read("extension", "media", "window.ps1");

    expect(helperSource).toContain("'Displays'");
    expect(helperSource).toContain("EnumDisplayMonitors");
    expect(helperSource).toContain("EnumDisplayDevices");
  });

  it.skipIf(process.platform !== "win32")(
    "AC-409 the real helper lists the displays of this machine",
    async () => {
      const answer = await runTheRealHelper(["-Mode", "Displays"]);
      const list = parseDisplays(answer.output);

      expect(list.length).toBeGreaterThan(0);
      expect(list.filter((display) => display.primary)).toHaveLength(1);

      for (const display of list) {
        expect(display.width).toBeGreaterThan(0);
        expect(display.height).toBeGreaterThan(0);
      }
    },
    60_000,
  );
});

describe("nothing uses or ships the virtual display driver", () => {
  // the extension may USE a virtual display that is there (D-350); it never
  // names, installs or drives the driver itself (D-329)
  const driverWords = /virtual.?display|\bVDD\b|VirtualDisplayDriver/i;
  const extensionWords = /\bVDD\b|MttVDD|VirtualDisplayDriver|virtual-display/i;

  it("AC-374 the extension has no virtual display code or command", () => {
    // the files that were the virtual display are gone
    for (const gone of [
      join("extension", "src", "virtualDisplay.ts"),
      join("extension", "media", "virtual-display.ps1"),
      join("tests", "virtualDisplay.test.ts"),
    ]) {
      expect(existsSync(join(packageRoot, gone)), gone).toBe(false);
    }

    // and no CODE of the extension names it (the comments may say what it
    // replaced; the code does not use it)
    for (const file of [
      join("extension", "src", "extension.ts"),
      join("extension", "src", "inputPanel.ts"),
      join("extension", "src", "windowPark.ts"),
      join("extension", "src", "windowInput.ts"),
      join("extension", "src", "captureState.ts"),
      join("scripts", "build-vsix.mjs"),
    ]) {
      expect(codeOf(read(file)), file).not.toMatch(extensionWords);
    }

    // the manifest has the parking commands and no command that names a display
    const manifest = JSON.parse(read("extension", "package.json")) as {
      contributes: { commands: { command: string }[] };
    };
    const commands = manifest.contributes.commands.map(
      (command) => command.command,
    );

    expect(commands).toContain("excalidraw-bridge.parkEditorWindow");
    expect(commands).toContain("excalidraw-bridge.bringBackEditorWindow");
    expect(commands.filter((command) => /display/i.test(command))).toEqual([]);
  });

  it("AC-374 the installer neither carries nor installs the driver", () => {
    for (const file of [
      join("installer", "offline", "build-payload.mjs"),
      join("installer", "offline", "OfflineSetup.cs"),
    ]) {
      const path = join(repoRoot, file);

      if (existsSync(path)) {
        expect(codeOf(readFileSync(path, "utf8")), file).not.toMatch(
          driverWords,
        );
      }
    }
  });

  it("AC-374 the install report does not check the driver", () => {
    const path = join(repoRoot, "installer", "verify-install.ps1");

    if (existsSync(path)) {
      expect(codeOf(readFileSync(path, "utf8"))).not.toMatch(driverWords);
    }
  });
});

describe("the teacher's own button for the virtual display (D-351)", () => {
  it("AC-411 the state says whether there is a virtual display and whether the window is on it", async () => {
    // a virtual display, and the window on the teacher's own
    const away = createWindowPark({
      scriptPath: "window.ps1",
      run: fakeHelper({
        windows: [ON_A_DISPLAY],
        displays: [REAL_DISPLAY, VIRTUAL_DISPLAY],
      }).run,
    });

    expect(await away.virtualState(RULE)).toEqual({
      available: true,
      on: false,
    });

    // the window on it
    const there = createWindowPark({
      scriptPath: "window.ps1",
      run: fakeHelper({
        windows: [
          { ...ON_A_DISPLAY, x: 2000, y: 100, width: 800, height: 600 },
        ],
        displays: [REAL_DISPLAY, VIRTUAL_DISPLAY],
      }).run,
    });

    expect(await there.virtualState(RULE)).toEqual({
      available: true,
      on: true,
    });

    // and a machine without one says so, and moves nothing
    const none = fakeHelper({
      windows: [ON_A_DISPLAY],
      displays: [REAL_DISPLAY],
    });
    const without = createWindowPark({
      scriptPath: "window.ps1",
      run: none.run,
    });

    expect(await without.virtualState(RULE)).toEqual({
      available: false,
      on: false,
    });
    expect(placeCalls(none.calls)).toHaveLength(0);
  });

  it("AC-411 the extension routes the panel's actions, and a window the teacher chose stays", () => {
    const source = codeOf(read("extension", "src", "extension.ts"));

    // the panel's actions: park, the virtual display, and back
    expect(source).toMatch(
      /case "editor:window":[\s\S]*parkEditor\(\)[\s\S]*moveToVirtualByChoice\(\)[\s\S]*bringBackByChoice\(\)/,
    );

    // the window's state is published with the descriptor
    expect(source).toMatch(
      /captureState\.setVirtual\(await windowPark\.virtualState\(editorRule\)\)/,
    );

    // Control ending does not take a chosen window back, and the focus route
    // does not put a window back that the teacher brought to the main display
    expect(source).toMatch(/if \(!onVirtualDisplay \|\| chosenVirtual\)/);
    expect(source).toMatch(/!declinedVirtual/);

    // the command is in the manifest and registered
    const manifest = JSON.parse(read("extension", "package.json")) as {
      contributes: { commands: { command: string }[] };
    };

    expect(manifest.contributes.commands.map((each) => each.command)).toContain(
      "excalidraw-bridge.moveEditorWindowToVirtualScreen",
    );
    expect(source).toContain(
      "excalidraw-bridge.moveEditorWindowToVirtualScreen",
    );
  });
});

describe("a window on the virtual display cannot be lost (D-356)", () => {
  it("AC-416 a window on the virtual display with no facts kept comes back to the primary display", async () => {
    const helper = fakeHelper({
      windows: [{ ...ON_A_DISPLAY, x: 2000, y: 100, width: 800, height: 600 }],
      displays: [REAL_DISPLAY, VIRTUAL_DISPLAY],
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    });
    const park = createWindowPark({
      scriptPath: "window.ps1",
      run: helper.run,
    });

    const back = await park.bringBack(RULE);

    expect(back.ok).toBe(true);

    const [place] = placeCalls(helper.calls);
    const x = Number(place[place.indexOf("-X") + 1]);
    const y = Number(place[place.indexOf("-Y") + 1]);
    const width = Number(place[place.indexOf("-Width") + 1]);
    const height = Number(place[place.indexOf("-Height") + 1]);

    // inside the primary display, and not on the virtual one
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(1920);
    expect(y + height).toBeLessThanOrEqual(1040);

    // a window on a real display with no facts is left where it is
    const real = fakeHelper({
      windows: [ON_A_DISPLAY],
      displays: [REAL_DISPLAY, VIRTUAL_DISPLAY],
    });
    const stays = createWindowPark({
      scriptPath: "window.ps1",
      run: real.run,
    });
    const answer = await stays.bringBack(RULE);

    expect(answer.reason).toContain("already on a display");
    expect(placeCalls(real.calls)).toHaveLength(0);
  });

  it("AC-416 the extension brings a window the editor started on the virtual display to the main display", () => {
    const source = codeOf(read("extension", "src", "extension.ts"));

    expect(source).toMatch(
      /\(await windowPark\.virtualState\(editorRule\)\)\.on[\s\S]*await windowPark\.bringBack\(editorRule\)[\s\S]*await refreshWindowState\(\)/,
    );
  });
});
