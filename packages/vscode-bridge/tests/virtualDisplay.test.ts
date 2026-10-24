/**
 * The **virtual display** when its driver is installed but **detached**, and
 * the **editor's own window** moving onto it and coming back (D-146, D-147,
 * D-148, D-149).
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  createBridgeServer,
  type BridgeServer,
  type BridgeServerOptions,
} from "../extension/src/bridge";
import { createInputPanel } from "../extension/src/inputPanel";
import {
  DETACHED_VIRTUAL_DISPLAY_REMEDY,
  chooseTargetDisplay,
  createVirtualDisplay,
  parseDisplays,
} from "../extension/src/virtualDisplay";

// A fixture, not a credential: the name says so, and the kit's secret scan
// recognises a `test-` prefixed value as the placeholder it is.
const TOKEN = "test-per-session-token-that-must-never-leak";

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

/** The helper, the way it ships inside the extension. */
const virtualDisplayScriptPath = (): string =>
  join(findPackageRoot(), "extension", "media", "virtual-display.ps1");

/** The extension's own source, the way it ships. */
const extensionSourcePath = (): string =>
  join(findPackageRoot(), "extension", "src", "extension.ts");

/**
 * The script WITHOUT its comments.
 *
 * The test is about the CODE, and not about the prose: the helper explains
 * why a detached display is reported, and that explanation must not be
 * mistaken for the reporting of it.
 */
const codeOf = (script: string): string =>
  script
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").replace(/\/\/.*$/, ""))
    .join("\n");

/**
 * The REAL helper, run for real.
 *
 * It is the helper that ships, and its answer is the answer the extension
 * gets.
 */
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
        virtualDisplayScriptPath(),
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

/** Runs a PowerShell snippet and gives back what it wrote. */
const runTheRealHelperOutput = (script: string): Promise<string> =>
  new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
    );

    let output = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });

    child.on("exit", () => {
      resolve(output);
    });
  });

/**
 * The virtual display drivers on this machine, by name.
 *
 * It is the question the teacher answered when they installed one, and it is
 * asked of Windows itself and not of the helper - so the helper cannot be
 * graded against its own answer. A machine that cannot answer has no driver
 * to report, and the test says nothing about it.
 */
const virtualDisplayDrivers = async (): Promise<string[]> => {
  if (process.platform !== "win32") {
    return [];
  }

  const output = await runTheRealHelperOutput(
    "Get-CimInstance -ClassName Win32_VideoController | " +
      "Where-Object { $_.Name -match 'virtual|indirect' } | " +
      "ForEach-Object { $_.Name }",
  );

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

describe("the virtual display and the editor's own window", () => {
  /** The real display on this kind of machine. */
  const REAL_DISPLAY = {
    device: "\\\\.\\DISPLAY1",
    name: "Generic PnP Monitor",
    adapter: "AMD Radeon(TM) Graphics",
    adapterId: "PCI\\VEN_1002&DEV_1638",
    adapterKey:
      "\\Registry\\Machine\\System\\CurrentControlSet\\Control\\Video\\{DDC0}\\0000",
    deviceId: "MONITOR\\LEN9059\\{4d36e96e}\\0001",
    deviceKey:
      "\\Registry\\Machine\\System\\CurrentControlSet\\Control\\Class\\{4d36e96e}\\0001",
    width: 1920,
    height: 1080,
    x: 0,
    y: 0,
    attached: true,
    primary: true,
    virtual: false,
    detached: false,
    reason: "",
    adapterFlags: 524293,
    deviceFlags: 3,
  };

  /**
   * The virtual display a driver installs and the teacher leaves **detached**.
   *
   * The monitor is not part of the desktop's coordinate space, so it has no
   * mode at all: no size, no place, and no window can be placed on it yet.
   */
  const DETACHED_VIRTUAL_DISPLAY = {
    device: "\\\\.\\DISPLAY4",
    name: "",
    adapter: "Virtual Display Driver",
    adapterId: "Root\\MttVDD",
    adapterKey:
      "\\Registry\\Machine\\System\\CurrentControlSet\\Control\\Video\\{3FBA}\\0000",
    deviceId: "",
    deviceKey: "",
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    attached: false,
    primary: false,
    virtual: true,
    detached: true,
    reason:
      "the virtual display is installed but its monitor is DETACHED - open VDD Control and set the monitor to Extend, and it joins the desktop",
    adapterFlags: 0,
    deviceFlags: 0,
  };

  /** The virtual display, once the teacher has set it to Extend. */
  const ATTACHED_VIRTUAL_DISPLAY = {
    ...REAL_DISPLAY,
    device: "\\\\.\\DISPLAY7",
    name: "Generic Monitor (VDD by MTT)",
    adapter: "Virtual Display Driver",
    adapterId: "Root\\MttVDD",
    width: 1920,
    height: 1080,
    x: 1920,
    y: 0,
    primary: false,
    virtual: true,
    detached: false,
  };

  /** The helper's output: one json object per line. */
  const helperOutput = (displays: unknown[]) =>
    displays.map((display) => JSON.stringify(display)).join("\n");

  /** The window the rule finds: the teacher's editor. */
  const FOUND_WINDOW = {
    found: true,
    visible: true,
    handle: 4242,
    title: "excalidraw - Visual Studio Code",
    x: 100,
    y: 100,
    width: 1200,
    height: 800,
  };

  /**
   * A helper that answers without a Windows machine behind it.
   *
   * The placement it reports is the MEASURED one, the way the helper reports
   * it: the window is read back after the move.
   */
  const fakeHelper = (
    displays: unknown[],
    placement: Record<string, unknown> = {},
  ) => {
    const calls: string[][] = [];

    const run = async (args: string[]) => {
      calls.push(args);

      if (args.includes("Enumerate")) {
        return helperOutput(displays);
      }

      if (args.includes("Find")) {
        return JSON.stringify(FOUND_WINDOW);
      }

      return JSON.stringify({
        placed: true,
        moved: true,
        wasMaximised: true,
        restored: true,
        maximised: false,
        minimised: false,
        handle: 4242,
        measuredX: 1920,
        measuredY: 0,
        measuredWidth: 1920,
        measuredHeight: 1080,
        reason: "",
        ...placement,
      });
    };

    return { calls, run };
  };

  const servers: BridgeServer[] = [];

  const startServer = async (
    options: Partial<BridgeServerOptions> = {},
  ): Promise<BridgeServer> => {
    const server = createBridgeServer({
      port: 0,
      token: TOKEN,
      workspace: "excalidraw",
      version: "0.1.0",
      ...options,
    });

    servers.push(server);
    await server.listen();

    return server;
  };

  afterAll(async () => {
    for (const server of servers) {
      await server.close();
    }
  });

  /** A plain http request against the bridge's own loopback server. */
  const fetchFrom = async (
    port: number,
    options: { method?: string; path: string; body?: string },
  ) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: options.path,
          method: options.method ?? "GET",
          headers: options.body
            ? { "content-type": "application/json" }
            : undefined,
        },
        (res) => {
          let body = "";

          res.on("data", (chunk: Buffer) => {
            body += chunk.toString("utf8");
          });
          res.on("end", () => {
            resolve({ status: res.statusCode ?? 0, body });
          });
        },
      );

      req.on("error", reject);

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });

  it("AC-183 an installed but detached virtual display is reported with the click that attaches it", async () => {
    const helper = fakeHelper([REAL_DISPLAY, DETACHED_VIRTUAL_DISPLAY]);
    const service = createVirtualDisplay({
      scriptPath: "virtual-display.ps1",
      run: helper.run,
    });

    // a driver that is installed but DETACHED is a FACT, and it is reported
    const displays = await service.displays();

    expect(displays).toHaveLength(2);

    const detached = displays.find(
      (display) => display.device === DETACHED_VIRTUAL_DISPLAY.device,
    );

    expect(detached).toMatchObject({
      virtual: true,
      attached: false,
      detached: true,
    });

    // and the fact names the click the teacher has to make
    expect(detached?.reason).toContain("VDD Control");
    expect(detached?.reason).toContain("Extend");

    // a DETACHED display is never the target: there is nothing to place a
    // window on, so nothing is placed on it
    const target = await service.target();

    expect(target.detached).toBe(true);
    expect(target.virtual).toBe(false);
    expect(target.display?.device).not.toBe(DETACHED_VIRTUAL_DISPLAY.device);
    expect(target.reason).toContain("VDD Control");
    expect(target.reason).toContain("Extend");
    expect(target.remedy).toBe(DETACHED_VIRTUAL_DISPLAY_REMEDY);

    // the rule itself, without the helper in the way
    expect(
      chooseTargetDisplay(
        parseDisplays(helperOutput([REAL_DISPLAY, DETACHED_VIRTUAL_DISPLAY])),
      ).detached,
    ).toBe(true);

    // and NOTHING was moved onto it
    const placement = await service.placePresenter();

    expect(placement.placed).toBe(false);
    expect(placement.reason).toContain("VDD Control");
    expect(helper.calls.some((args) => args.includes("Place"))).toBe(false);

    // the panel shows the remedy - the click - and not only the reason
    const panel = createInputPanel({
      port: () => 47511,
      onCommand: () => undefined,
      state: () => ({
        display: null,
        virtual: false,
        reason: target.reason,
        remedy: target.remedy,
      }),
    });
    const capability = panel.createCapability();
    const server = await startServer({ inputPanel: panel });

    const state = await fetchFrom(server.port, {
      path: `/panel/${capability}/state`,
    });

    expect(state.status).toBe(200);
    expect(JSON.parse(state.body).remedy).toContain("VDD Control");
    expect(JSON.parse(state.body).remedy).toContain("Extend");

    const page = await fetchFrom(server.port, {
      path: `/panel/${capability}/index.html`,
    });

    expect(page.body).toContain('id="remedy"');

    // the helper that SHIPS says it too: the code reports a detached virtual
    // display, and it names the click
    const code = codeOf(readFileSync(virtualDisplayScriptPath(), "utf8"));

    expect(code).toContain("detached");
    expect(code).toContain("VDD Control");
    expect(code).toContain("Extend");

    // FOR REAL, on a machine that HAS a virtual display driver: the helper
    // reports it, and a detached one carries the remedy with it. The driver
    // is looked up in Windows itself, so the helper is never graded against
    // its own answer.
    const drivers = await virtualDisplayDrivers();

    if (drivers.length > 0) {
      const run = await runTheRealHelper(["-Mode", "Enumerate"]);
      const reported = parseDisplays(run.output);

      expect(reported.length).toBeGreaterThan(0);
      expect(reported.some((display) => display.virtual)).toBe(true);

      for (const display of reported.filter((one) => one.detached)) {
        expect(display.reason).toContain("VDD Control");
        expect(display.reason).toContain("Extend");
      }
    }
  });

  it("AC-183 the editor's window is moved onto the virtual display without taking the focus", async () => {
    const helper = fakeHelper([REAL_DISPLAY, ATTACHED_VIRTUAL_DISPLAY]);
    const service = createVirtualDisplay({
      scriptPath: "virtual-display.ps1",
      run: helper.run,
    });

    const result = await service.placeWindow({
      // the workspace folder's name is in the editor's window title - the same
      // rule the capture uses (D-112, D-113)
      titleLike: "excalidraw",
      // the OS process name is not the editor's name: VS Code runs as `Code`
      processName: "Code",
      subject: "your editor's window",
    });

    expect(result.placed).toBe(true);
    expect(result.reason).toContain(
      "your editor's window was moved to the virtual display",
    );

    // the reason carries the MEASURED rect, not the one that was asked for
    expect(result.reason).toContain("1920x1080 at 1920,0");

    // the window was found BY RULE: a title substring and the process that
    // owns it - never a remembered handle
    const findCall = helper.calls.find((args) => args.includes("Find"));

    expect(findCall?.join(" ")).toContain("-TitleLike excalidraw");
    expect(findCall?.join(" ")).toContain("-ProcessName Code");

    // and the window that was FOUND is the one that was moved, onto the
    // virtual display's own rectangle
    const placeCall = helper.calls.find((args) => args.includes("Place"));

    expect(placeCall?.join(" ")).toContain("-Handle 4242");
    expect(placeCall?.join(" ")).toContain("-X 1920");
    expect(placeCall?.join(" ")).toContain("-Y 0");
    expect(placeCall?.join(" ")).toContain("-Width 1920");
    expect(placeCall?.join(" ")).toContain("-Height 1080");

    // the move never takes the FOCUS: the helper's placement is
    // SWP_NOACTIVATE, and the helper never brings a window to the front
    const code = codeOf(readFileSync(virtualDisplayScriptPath(), "utf8"));

    expect(code).toContain("SWP_NOACTIVATE");
    expect(code).toMatch(
      /SWP_NOACTIVATE\s*\|\s*SWP_NOZORDER\s*\|\s*SWP_SHOWWINDOW/,
    );
    expect(code).not.toContain("SetForegroundWindow");
    expect(code).not.toContain("BringWindowToTop");

    // the panel offers the move, and the extension is the one that does it
    const actions: string[] = [];
    const panel = createInputPanel({
      port: () => 47511,
      onCommand: () => undefined,
      onAction: (action) => {
        actions.push(action);
      },
    });
    const capability = panel.createCapability();
    const server = await startServer({ inputPanel: panel });

    const page = await fetchFrom(server.port, {
      path: `/panel/${capability}/index.html`,
    });

    expect(page.body).toContain('data-action="move-editor-window"');

    const answer = await fetchFrom(server.port, {
      method: "POST",
      path: `/panel/${capability}/control`,
      body: JSON.stringify({ action: "move-editor-window" }),
    });

    expect(answer.status).toBe(200);
    expect(actions).toEqual(["move-editor-window"]);

    // and an action that is not on the list is refused: the panel can never
    // make the extension do anything it does not already do
    const refused = await fetchFrom(server.port, {
      method: "POST",
      path: `/panel/${capability}/control`,
      body: JSON.stringify({ action: "run:anything" }),
    });

    expect(refused.status).toBe(400);
    expect(actions).toHaveLength(1);

    // and the command is in the extension's own manifest, so the teacher can
    // reach it from the command palette
    const manifest = JSON.parse(
      readFileSync(
        join(findPackageRoot(), "extension", "package.json"),
        "utf8",
      ),
    ) as { contributes: { commands: { command: string }[] } };

    expect(
      manifest.contributes.commands.map((command) => command.command),
    ).toContain("excalidraw-bridge.placeEditorOnVirtualDisplay");

    // the editor's window is the TEACHER'S to move (D-148): the extension
    // moves it from ONE place only - the panel's action - so nothing moves
    // unless the teacher asked for it
    const source = readFileSync(extensionSourcePath(), "utf8");

    expect(source.match(/placeEditor\(\)/g)).toHaveLength(1);
  });

  it("AC-183 a window that was moved can be brought back, and a move that did not happen is reported as one", async () => {
    const helper = fakeHelper([REAL_DISPLAY, ATTACHED_VIRTUAL_DISPLAY]);
    const service = createVirtualDisplay({
      scriptPath: "virtual-display.ps1",
      run: helper.run,
    });

    const rule = {
      titleLike: "excalidraw",
      processName: "Code",
      subject: "your editor's window",
    };

    // the window goes onto the virtual display
    await service.placeWindow(rule);

    // and it comes BACK (D-149): onto the display the teacher is working on,
    // in the size it had before it moved, and maximised again if it was
    // maximised before it moved
    const back = await service.bringBack(rule);

    expect(back.placed).toBe(true);
    expect(back.reason).toContain("your editor's window is back on");

    const placeCall = helper.calls
      .filter((args) => args.includes("Place"))
      .pop();

    expect(placeCall?.join(" ")).toContain("-X 0");
    expect(placeCall?.join(" ")).toContain("-Y 0");
    // the size it had before it moved
    expect(placeCall?.join(" ")).toContain("-Width 1200");
    expect(placeCall?.join(" ")).toContain("-Height 800");
    // and maximised again, because it was maximised before it moved
    expect(placeCall?.join(" ")).toContain("-Maximise");

    // a move that did NOT happen is never reported as one (D-147): the
    // helper's own return value says the move worked, and the MEASURED rect
    // says it did not - so the extension believes the measurement
    const lying = fakeHelper([REAL_DISPLAY, ATTACHED_VIRTUAL_DISPLAY], {
      placed: false,
      moved: true,
      measuredX: 1273,
      measuredY: -7,
      measuredWidth: 1295,
      measuredHeight: 703,
      reason:
        "it stayed where it was (1295x703 at 1273,-7) instead of 1920x1080 at 1920,0",
    });
    const honest = createVirtualDisplay({
      scriptPath: "virtual-display.ps1",
      run: lying.run,
    });

    const result = await honest.placeWindow(rule);

    expect(result.placed).toBe(false);
    expect(result.reason).toContain("your editor's window was not moved");
    expect(result.reason).toContain("stayed where it was");

    // and the presenter's window is treated the same way: it is maximised in
    // the normal case, so it has the same trap
    const presenter = await honest.placePresenter();

    expect(presenter.placed).toBe(false);
    expect(presenter.reason).toContain("the presenter's window was not moved");

    // the helper that SHIPS measures the move: a maximised window is
    // restored first, the rect is read back, and the answer is the measured
    // one - the API's return value is not the answer
    const code = codeOf(readFileSync(virtualDisplayScriptPath(), "utf8"));

    expect(code).toContain("WS_MAXIMIZE");
    expect(code).toContain("SW_RESTORE");
    expect(code).toContain("measuredX");
    expect(code).toContain("PLACE_TOLERANCE");

    // and the maximised state is put back when the window comes back
    expect(code).toContain("SW_MAXIMIZE");
  });
});
