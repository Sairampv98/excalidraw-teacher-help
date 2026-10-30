/**
 * The **control** of the editor's own window: the gate every event passes, the
 * words the helper is told in, and the way in (D-323, D-325, D-326, D-327).
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  BRIDGE_KEY_CODES,
  type BridgeInputEvent,
} from "../bridge/src/protocol";
import {
  createInputGate,
  createWindowInput,
  encodeInputLine,
  INPUT_ROUTE_CHOICES,
  inputArgs,
  isMachineChord,
  KEY_VK,
  MAX_INPUT_EVENTS_PER_SECOND,
  parseHelperLine,
  resolveInputRoute,
  type InputProcess,
} from "../extension/src/windowInput";

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

const inputScriptPath = join(packageRoot, "extension", "media", "input.ps1");

/** A file WITHOUT its comments: some tests are about the code and not the prose. */
const codeOf = (source: string): string =>
  source
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, "").replace(/\/\/.*$/, ""))
    .join("\n");

const CLICK: BridgeInputEvent = {
  kind: "pointer",
  action: "down",
  x: 0.5,
  y: 0.25,
  button: "left",
  mods: 0,
};

const key = (
  code: string,
  mods = 0,
  extra: { char?: string; action?: "down" | "up" } = {},
): BridgeInputEvent => ({
  kind: "key",
  action: extra.action ?? "down",
  code,
  mods,
  ...(extra.char === undefined ? {} : { char: extra.char }),
});

const ALT = 4;
const CTRL = 1;
const SHIFT = 2;

describe("the gate every event passes", () => {
  const OWNER = { id: "the panel that turned Control on" };

  it("AC-370 nothing goes through while Control is off", () => {
    const gate = createInputGate();

    expect(gate.enabled).toBe(false);

    // every kind of event, with a legal shape: none of them passes
    for (const event of [
      CLICK,
      { kind: "wheel", x: 0.5, y: 0.5, dx: 0, dy: 1, mods: 0 },
      key("KeyA", 0, { char: "a" }),
      { kind: "text", text: "hello" },
    ] as BridgeInputEvent[]) {
      expect(gate.accept(event, OWNER)).toEqual({ ok: false, why: "off" });
    }

    // turned on, the same event passes - so the refusal above is the switch
    gate.setEnabled(true, OWNER);
    expect(gate.accept(CLICK, OWNER).ok).toBe(true);

    // and turned off again, it stops
    gate.setEnabled(false, OWNER);
    expect(gate.accept(CLICK, OWNER)).toEqual({ ok: false, why: "off" });
  });

  it("AC-370 Control turns itself off when the connection ends", () => {
    const gate = createInputGate();
    const other = { id: "another page" };

    expect(gate.setEnabled(true, OWNER)).toBe(true);
    expect(gate.accept(CLICK, OWNER).ok).toBe(true);

    // a page that did not turn Control on is a stranger: nothing of it passes
    expect(gate.accept(CLICK, other)).toEqual({ ok: false, why: "stranger" });

    // another connection ending changes nothing
    expect(gate.connectionEnded(other)).toBe(false);
    expect(gate.enabled).toBe(true);

    // the connection that turned Control on ending turns it off
    expect(gate.connectionEnded(OWNER)).toBe(true);
    expect(gate.enabled).toBe(false);
    expect(gate.accept(CLICK, OWNER)).toEqual({ ok: false, why: "off" });

    // and it does not turn itself on again by itself
    expect(gate.connectionEnded(OWNER)).toBe(false);

    // another page that turns Control on is the one that is heard from then on
    gate.setEnabled(true, other);
    expect(gate.accept(CLICK, other).ok).toBe(true);
    expect(gate.accept(CLICK, OWNER)).toEqual({ ok: false, why: "stranger" });
  });

  it("AC-370 events above the limit are dropped and counted", () => {
    let clock = 1_000_000;
    const gate = createInputGate({ now: () => clock, maxPerSecond: 5 });

    gate.setEnabled(true, OWNER);

    const verdicts = Array.from({ length: 8 }, () => gate.accept(CLICK, OWNER));

    expect(verdicts.filter((verdict) => verdict.ok)).toHaveLength(5);
    expect(
      verdicts.filter((verdict) => !verdict.ok && verdict.why === "limited"),
    ).toHaveLength(3);

    // the drops are COUNTED, so the panel can say it - and the count is taken
    expect(gate.takeDropped()).toBe(3);
    expect(gate.takeDropped()).toBe(0);

    // a second later the way is free again
    clock += 1001;
    expect(gate.accept(CLICK, OWNER).ok).toBe(true);

    // and the limit that ships is the one the rows say
    expect(MAX_INPUT_EVENTS_PER_SECOND).toBe(600);
  });

  it("AC-370 the keys the machine keeps never reach the helper", () => {
    const gate = createInputGate();

    gate.setEnabled(true, OWNER);

    // Alt+F4 would close the editor; Alt+Tab, Alt+Esc and Ctrl+Esc move the
    // teacher around their own desktop; Ctrl+Alt+Delete is not a window's key
    for (const chord of [
      key("F4", ALT),
      key("F4", ALT | SHIFT),
      key("Tab", ALT),
      key("Escape", ALT),
      key("Escape", CTRL),
      key("Escape", CTRL | SHIFT),
      key("Delete", CTRL | ALT),
      key("F4", ALT, { action: "up" }),
    ]) {
      expect(isMachineChord(chord), JSON.stringify(chord)).toBe(true);
      expect(gate.accept(chord, OWNER), JSON.stringify(chord)).toEqual({
        ok: false,
        why: "machine",
      });
    }

    // the same keys without the chord are the editor's own
    for (const own of [
      key("F4", 0),
      key("Tab", 0),
      key("Tab", CTRL),
      key("Escape", 0),
      key("Escape", SHIFT),
      key("Delete", 0),
      key("Delete", CTRL),
      key("KeyF", ALT),
      key("KeyS", CTRL, { char: "s" }),
    ]) {
      expect(gate.accept(own, OWNER).ok, JSON.stringify(own)).toBe(true);
    }

    // an event the protocol does not know is refused before it can be a line
    expect(gate.accept({ kind: "exec", command: "calc" }, OWNER)).toEqual({
      ok: false,
      why: "refused",
    });
    expect(
      gate.accept({ ...CLICK, x: 2 } as unknown as BridgeInputEvent, OWNER),
    ).toEqual({ ok: false, why: "refused" });
    expect(gate.accept(key("MetaLeft"), OWNER)).toEqual({
      ok: false,
      why: "refused",
    });
  });
});

describe("an event becomes the helper's line", () => {
  it("AC-371 a pointer event is one line", () => {
    expect(encodeInputLine(CLICK)).toBe("P down 0.500000 0.250000 l 0");
    expect(
      encodeInputLine({
        kind: "pointer",
        action: "up",
        x: 1,
        y: 0,
        button: "right",
        mods: CTRL | SHIFT,
      }),
    ).toBe("P up 1.000000 0.000000 r 3");
    expect(
      encodeInputLine({
        kind: "pointer",
        action: "move",
        x: 0.1,
        y: 0.9,
        mods: 0,
      }),
    ).toBe("P move 0.100000 0.900000 l 0");
    expect(
      encodeInputLine({
        kind: "pointer",
        action: "down",
        x: 0.1,
        y: 0.9,
        button: "middle",
        mods: 0,
      }),
    ).toBe("P down 0.100000 0.900000 m 0");

    // the wheel: the place and the notches, down is positive
    expect(
      encodeInputLine({ kind: "wheel", x: 0.5, y: 0.5, dx: 0, dy: 3, mods: 0 }),
    ).toBe("W 0.500000 0.500000 0.000 3.000 0");

    // a line is one line: no event can put a line feed or a second record in it
    for (const event of [CLICK, key("KeyA", 0, { char: "a" })]) {
      expect(encodeInputLine(event)).not.toMatch(/[\r\n]/);
    }
  });

  it("AC-371 a printed character is a character and Enter is a key", () => {
    // the key's code from the table, the character it types, the modifiers
    expect(encodeInputLine(key("KeyA", 0, { char: "a" }))).toBe(
      "K down 65 97 0",
    );
    expect(encodeInputLine(key("KeyA", SHIFT, { char: "A" }))).toBe(
      "K down 65 65 2",
    );
    expect(encodeInputLine(key("KeyA", 0, { char: "a", action: "up" }))).toBe(
      "K up 65 97 0",
    );
    expect(encodeInputLine(key("Space", 0, { char: " " }))).toBe(
      "K down 32 32 0",
    );

    // Enter, Tab and Backspace are KEYS: they carry no character
    expect(encodeInputLine(key("Enter"))).toBe("K down 13 0 0");
    expect(encodeInputLine(key("Tab"))).toBe("K down 9 0 0");
    expect(encodeInputLine(key("Backspace"))).toBe("K down 8 0 0");
    expect(encodeInputLine(key("ArrowLeft"))).toBe("K down 37 0 0");
    expect(encodeInputLine(key("F5"))).toBe("K down 116 0 0");

    // a character that is not in the plane that fits a code unit goes as its
    // code point: the helper posts both halves
    expect(encodeInputLine(key("KeyA", 0, { char: "😀" }))).toBe(
      "K down 65 128512 0",
    );

    // The helper posts a key that types a character as the CHARACTER and
    // nothing else: the window's own message loop turns a posted key into a
    // character as well, so a key posted beside its character types it twice -
    // which a real run found, and a fake could not.
    const helper = codeOf(readFileSync(inputScriptPath, "utf8"));
    const keyBackground = helper.slice(
      helper.indexOf("static void KeyBackground"),
      helper.indexOf("static void TextBackground"),
    );

    expect(keyBackground).toMatch(
      /if \(ch != 0 && \(mods & \(MOD_CTRL \| MOD_ALT\)\) == 0\) \{\s*if \(down\) \{\s*foreach[^\n]*WM_CHAR[^\n]*\s*\}\s*return;\s*\}/,
    );
    // ... and the key's own messages come after that, so a key with a
    // character never reaches them
    expect(keyBackground.indexOf("WM_KEYDOWN")).toBeGreaterThan(
      keyBackground.indexOf("return;"),
    );
    expect(keyBackground.match(/WM_CHAR/g)).toHaveLength(1);
  });

  it("AC-371 a modifier is a mask", () => {
    // Ctrl+S is the S key with the Ctrl bit - and it types no character
    expect(encodeInputLine(key("KeyS", CTRL, { char: "s" }))).toBe(
      "K down 83 0 1",
    );
    expect(encodeInputLine(key("KeyS", CTRL | ALT, { char: "s" }))).toBe(
      "K down 83 0 5",
    );
    // Shift does not stop a key from typing
    expect(encodeInputLine(key("Digit1", SHIFT, { char: "!" }))).toBe(
      "K down 49 33 2",
    );

    // there is no key of a modifier's own on the list: a modifier is never a
    // line by itself
    for (const code of [
      "ControlLeft",
      "ControlRight",
      "ShiftLeft",
      "ShiftRight",
      "AltLeft",
      "AltRight",
      "MetaLeft",
      "MetaRight",
      "OSLeft",
    ]) {
      expect(BRIDGE_KEY_CODES, code).not.toContain(code);
      expect(KEY_VK[code], code).toBeUndefined();
    }

    // every key the protocol allows has a virtual-key code, and the codes are
    // the ones Windows has
    for (const code of BRIDGE_KEY_CODES) {
      expect(KEY_VK[code], code).toBeGreaterThan(0);
    }

    expect(KEY_VK.KeyZ).toBe(0x5a);
    expect(KEY_VK.Digit0).toBe(0x30);
    expect(KEY_VK.Numpad5).toBe(0x65);
    expect(KEY_VK.F12).toBe(0x7b);
    expect(KEY_VK.Escape).toBe(0x1b);
    expect(KEY_VK.Delete).toBe(0x2e);
  });

  it("AC-371 a text goes as base64 and a line feed as Enter", () => {
    const line = encodeInputLine({ kind: "text", text: "héllo wörld\n😀 ok" });

    expect(line).toMatch(/^T [A-Za-z0-9+/=]+$/);

    // it round-trips, and nothing in it is a space or a line feed
    expect(
      Buffer.from((line as string).slice(2), "base64").toString("utf8"),
    ).toBe("héllo wörld\n😀 ok");
    expect((line as string).slice(2)).not.toMatch(/[\s]/);

    // the helper types a line feed as the Enter KEY, and a tab as the Tab key
    // (a carriage return posted as a character is ignored by the window)
    const helper = codeOf(readFileSync(inputScriptPath, "utf8"));

    expect(helper).toMatch(
      /c == '\\r' \|\| c == '\\n'[\s\S]{0,200}KeyBackground\(true, 0x0D, 0, 0\)/,
    );
    expect(helper).toMatch(
      /c == '\\t'[\s\S]{0,80}KeyBackground\(true, 0x09, 0, 0\)/,
    );

    // Enter, Tab and Backspace become their character inside the window, at
    // the end of its queue: without a settle after them, what is posted right
    // behind is typed first and the text comes out in the wrong order (a real
    // run found it)
    expect(helper).toMatch(
      /if \(vk == 0x0D \|\| vk == 0x09 \|\| vk == 0x08\) Thread\.Sleep\(\d+\);/,
    );
  });

  it("AC-371 the helper is run with the rule and the route", () => {
    expect(
      inputArgs({
        scriptPath: "C:\\ext\\media\\input.ps1",
        processName: "Code",
        titleLike: "excalidraw",
        route: "auto",
      }),
    ).toEqual([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\ext\\media\\input.ps1",
      "-ProcessName",
      "Code",
      "-TitleLike",
      "excalidraw",
      "-Route",
      "auto",
    ]);

    // the window is found by the RULE and never by a handle
    expect(
      inputArgs({
        scriptPath: "x",
        processName: "Code",
        titleLike: "y",
        route: "focus",
      }),
    ).not.toContain("-Handle");
  });

  it.skipIf(process.platform !== "win32")(
    "AC-371 the real helper compiles",
    async () => {
      const output = await new Promise<string>((resolve) => {
        const child = spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            inputScriptPath,
            "-SelfTest",
          ],
          { windowsHide: true },
        );

        let text = "";

        child.stdout?.on("data", (chunk: Buffer) => {
          text += chunk.toString("utf8");
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          text += chunk.toString("utf8");
        });
        child.on("exit", () => resolve(text.trim()));
      });

      expect(output).toBe("OK");
    },
    90_000,
  );
});

/** A helper process that answers without a Windows machine behind it. */
const fakeProcess = () => {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const written: string[] = [];
  const process_ = {
    stdin: {
      write: (line: string) => {
        written.push(line);
      },
      end: vi.fn(),
    },
    stdout,
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
    on(event: string, listener: (...args: unknown[]) => void) {
      emitter.on(event, listener);

      return process_;
    },
  };

  return {
    process: process_ as unknown as InputProcess,
    emit: (event: string, ...args: unknown[]) => emitter.emit(event, ...args),
    say: (text: string) => stdout.write(text),
    written,
    kill: process_.kill,
  };
};

describe("the way in is chosen, and the panel is told", () => {
  it("AC-372 auto chooses by what the window can take", () => {
    // the helper says what it found; the module reads it
    expect(
      parseHelperLine(
        "ROUTE background input goes to the editor's window without taking the focus",
      ),
    ).toEqual({
      kind: "route",
      state: {
        route: "background",
        reason: "input goes to the editor's window without taking the focus",
      },
    });
    expect(
      parseHelperLine(
        "ROUTE focus this window has no page to post input to, so the input goes with the focus",
      ),
    ).toMatchObject({ kind: "route", state: { route: "focus" } });

    // anything that is not a route the module knows is not one
    expect(parseHelperLine("ROUTE teleport somewhere")).toBeNull();
    expect(parseHelperLine("ROUTE background")).toBeNull();
    expect(parseHelperLine("hello")).toBeNull();
    expect(
      parseHelperLine("STATUS the editor's window would not come to the front"),
    ).toEqual({
      kind: "status",
      text: "the editor's window would not come to the front",
    });

    // and the CODE of the helper decides by the page: a window with a render
    // widget gets the background route, one without it gets the focus route
    const helper = codeOf(readFileSync(inputScriptPath, "utf8"));

    expect(helper).toContain('"Chrome_RenderWidgetHostHWND"');
    expect(helper).toMatch(
      /routeSetting == "auto" && render == IntPtr\.Zero\)\) \{[\s\S]*?Announce\("focus"/,
    );
    expect(helper).toMatch(/Announce\("background"/);
  });

  it("AC-372 a setting forces the route", async () => {
    expect(resolveInputRoute("background")).toBe("background");
    expect(resolveInputRoute("focus")).toBe("focus");
    expect(resolveInputRoute("auto")).toBe("auto");
    expect(resolveInputRoute("teleport")).toBe("auto");
    expect(resolveInputRoute(undefined)).toBe("auto");

    const argsSeen: string[][] = [];
    const input = createWindowInput({
      scriptPath: "input.ps1",
      processName: "Code",
      titleLike: "excalidraw",
      route: "focus",
      onState: () => undefined,
      spawn: (_command, args) => {
        argsSeen.push(args);

        return fakeProcess().process;
      },
    });

    input.start();

    expect(argsSeen).toHaveLength(1);
    expect(argsSeen[0][argsSeen[0].indexOf("-Route") + 1]).toBe("focus");

    // the forced route is in the helper's code: a forced focus route does not
    // look for a page at all, and a forced background route never falls back
    const helper = codeOf(readFileSync(inputScriptPath, "utf8"));

    expect(helper).toMatch(/routeSetting == "focus" \|\|/);
    expect(helper).toMatch(
      /if \(render == IntPtr\.Zero\) \{\s*Announce\("none"/,
    );
  });

  it("AC-372 the descriptor says the route and why", () => {
    const fake = fakeProcess();
    const states: { route: string; reason: string }[] = [];
    const input = createWindowInput({
      scriptPath: "input.ps1",
      processName: "Code",
      titleLike: "",
      route: "auto",
      onState: (state) => states.push(state),
      spawn: () => fake.process,
    });

    input.start();

    // the helper says it in pieces, the way a pipe delivers it
    fake.say("ROUTE background input goes to the editor's");
    expect(states).toEqual([]);
    fake.say(" window without taking the focus\nSTATUS ");
    fake.say("something to read\nROUTE focus real input was chosen\n");

    expect(states).toEqual([
      {
        route: "background",
        reason: "input goes to the editor's window without taking the focus",
      },
      { route: "focus", reason: "real input was chosen" },
    ]);

    // what the extension publishes is that state and nothing else: the route
    // and the reason go into the capture's descriptor
    const source = codeOf(
      readFileSync(
        join(packageRoot, "extension", "src", "extension.ts"),
        "utf8",
      ),
    );

    expect(source).toMatch(
      /captureState\.setControl\(\{[\s\S]*?route: inputGate\.enabled \? helperState\.route : "none"[\s\S]*?\}\)/,
    );
  });

  it("AC-372 no window is said and the helper stays", () => {
    const fake = fakeProcess();
    const states: { route: string; reason: string }[] = [];
    const statuses: string[] = [];
    const input = createWindowInput({
      scriptPath: "input.ps1",
      processName: "Code",
      titleLike: "excalidraw",
      route: "auto",
      onState: (state) => states.push(state),
      onStatus: (text) => statuses.push(text),
      spawn: () => fake.process,
    });

    input.start();
    fake.say("ROUTE none no editor window was found to control\n");
    fake.say("STATUS the editor's window would not come to the front\n");

    expect(states).toEqual([
      { route: "none", reason: "no editor window was found to control" },
    ]);
    expect(statuses).toEqual([
      "the editor's window would not come to the front",
    ]);

    // the helper is not stopped for it: it waits, and finds the window when it
    // comes back
    expect(input.running).toBe(true);
    expect(fake.kill).not.toHaveBeenCalled();

    // a line goes to it, one line at a time
    expect(input.send("P move 0.5 0.5 l 0")).toBe(true);
    expect(fake.written).toEqual(["P move 0.5 0.5 l 0\n"]);

    // and a helper that cannot be started is said, not thrown
    const broken = createWindowInput({
      scriptPath: "input.ps1",
      processName: "Code",
      titleLike: "",
      route: "auto",
      onState: (state) => states.push(state),
      spawn: () => {
        throw new Error("no powershell");
      },
    });

    broken.start();

    expect(states.at(-1)).toEqual({
      route: "none",
      reason: "the input helper could not be started: no powershell",
    });
    expect(broken.send("T aGk=")).toBe(false);
  });

  it("AC-372 a dead helper is started again", () => {
    const processes: ReturnType<typeof fakeProcess>[] = [];
    const timers: { callback: () => void; ms: number }[] = [];
    const input = createWindowInput({
      scriptPath: "input.ps1",
      processName: "Code",
      titleLike: "",
      route: "auto",
      onState: () => undefined,
      restartAfterMs: 750,
      setTimer: (callback, ms) => {
        timers.push({ callback, ms });

        return timers.length;
      },
      clearTimer: () => undefined,
      spawn: () => {
        const next = fakeProcess();

        processes.push(next);

        return next.process;
      },
    });

    input.start();
    expect(processes).toHaveLength(1);

    // the helper dies: it is started again after a moment, and not before
    processes[0].emit("exit", 1, null);
    expect(input.running).toBe(false);
    expect(processes).toHaveLength(1);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(750);

    timers[0].callback();
    expect(processes).toHaveLength(2);
    expect(input.running).toBe(true);

    // stopped on purpose, it is not started again: the helper runs only while
    // Control is on
    input.stop();
    expect(processes[1].kill).toHaveBeenCalled();
    expect(input.running).toBe(false);

    processes[1].emit("exit", 0, null);
    expect(timers).toHaveLength(1);
    expect(processes).toHaveLength(2);
    expect(input.send("T aGk=")).toBe(false);
  });
});

/** the extension's own source, without its comments */
const extensionCode = (): string =>
  readFileSync(join(packageRoot, "extension", "src", "extension.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

describe("the way in is chosen from the notification (D-335)", () => {
  it("AC-381 the pick list has the three routes", () => {
    // in the order the setting has them, each said in a sentence
    expect(INPUT_ROUTE_CHOICES.map((choice) => choice.value)).toEqual([
      "auto",
      "background",
      "focus",
    ]);

    for (const choice of INPUT_ROUTE_CHOICES) {
      expect(choice.label.length).toBeGreaterThan(0);
      expect(choice.description.length).toBeGreaterThan(20);
      // every line of the list is a value the setting reads as itself
      expect(resolveInputRoute(choice.value)).toBe(choice.value);
    }

    // the setting the manifest has says the same three
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "extension", "package.json"), "utf8"),
    ) as {
      contributes: {
        commands: { command: string }[];
        configuration: {
          properties: Record<string, { enum?: string[]; default?: string }>;
        };
      };
    };
    const setting =
      manifest.contributes.configuration.properties[
        "excalidraw-bridge.inputRoute"
      ];

    expect(setting.enum).toEqual(INPUT_ROUTE_CHOICES.map((c) => c.value));
    expect(setting.default).toBe("auto");
    expect(
      manifest.contributes.commands.map((command) => command.command),
    ).toContain("excalidraw-bridge.chooseInputRoute");
  });

  it("AC-381 the notification opens the pick list and the choice applies at once", () => {
    const code = extensionCode();

    // the notification that shows the token has a second button for it
    expect(code).toMatch(
      /showInformationMessage\([\s\S]{0,400}"Copy token",\s*"Input route\.\.\.",?\s*\)/,
    );
    expect(code).toMatch(
      /if \(choice === "Input route\.\.\."\) \{\s*await chooseInputRoute\(\);/,
    );

    // the list is a pick list with the current route ticked, and the choice is
    // written to the user's own setting
    expect(code).toContain("vscode.window.showQuickPick(");
    expect(code).toContain('"$(check) "');
    expect(code).toMatch(
      /\.update\("inputRoute", picked\.value, vscode\.ConfigurationTarget\.Global\)/,
    );

    // and it applies at once: the setting is read again each time the helper
    // is made, and a change of it while Control is on makes the helper again
    expect(code).toMatch(
      /const makeWindowInput = \(\): WindowInput =>[\s\S]{0,400}getConfiguration\(CONFIG_SECTION\)\s*\.get<string>\("inputRoute"\)/,
    );
    expect(code).toMatch(
      /onDidChangeConfiguration\(\(event\) => \{[\s\S]{0,300}affectsConfiguration\(`\$\{CONFIG_SECTION\}\.inputRoute`\)[\s\S]{0,300}windowInput\.stop\(\);\s*windowInput = makeWindowInput\(\);/,
    );
  });
});

describe("the focus route needs the window on a display (D-336)", () => {
  it("AC-382 the helper asks for a display once and looks again when told", () => {
    // the module reads the request
    expect(parseHelperLine("NEED display")).toEqual({
      kind: "need",
      what: "display",
    });
    expect(parseHelperLine("NEED the moon")).toBeNull();

    const fake = fakeProcess();
    const needs: string[] = [];
    const input = createWindowInput({
      scriptPath: "input.ps1",
      processName: "Code",
      titleLike: "",
      route: "focus",
      onState: () => undefined,
      onNeed: (what) => needs.push(what),
      spawn: () => fake.process,
    });

    input.start();
    fake.say("ROUTE none real input needs the editor's window on a display\n");
    fake.say("NEED display\n");

    expect(needs).toEqual(["display"]);

    // the helper's own code: it asks when the route changes to "none" for want
    // of a display, and not again until something changes; and it looks again
    // when it is told to
    const helper = codeOf(readFileSync(inputScriptPath, "utf8"));

    expect(helper).toMatch(
      /if \(Announce\("none", "real input needs the editor's window on a display[^"]*"\)\) \{\s*Say\("NEED display"\);\s*\}/,
    );
    expect(helper).toMatch(
      /if \(f\[0\] == "R"\) \{\s*Resolve\(true\);\s*return;\s*\}/,
    );
    expect(helper).toMatch(/static bool Announce\(/);
  });

  it("AC-382 the extension brings the window back and the helper looks again", () => {
    const code = extensionCode();

    // on the request: the window is brought back, the state is read again, the
    // reason says it was done, and the helper is told to look - but only when
    // the window really came back
    expect(code).toMatch(
      /onNeed: \(\) => \{[\s\S]{0,200}await windowPark\.bringBack\(editorRule\);\s*await refreshWindowState\(\);/,
    );
    expect(code).toContain(
      "real input needs the editor's window on a display, so it was brought back",
    );
    expect(code).toMatch(/if \(result\.ok\) \{\s*windowInput\?\.send\("R"\);/);
  });
});

describe("the focus route stays out of the teacher's way", () => {
  it("AC-390 a hover does not take the pointer, and the window stays in front through a pause", () => {
    const helper = codeOf(readFileSync(inputScriptPath, "utf8"));

    // a move with no button down is a hover: it is dropped BEFORE the window
    // is brought forward and before the real pointer is moved
    const hover = helper.indexOf(
      'if (action == "move" && !focusPressed) return;',
    );
    const burst = helper.indexOf("if (!BeginBurst()) return;", hover);
    const moved = helper.indexOf("MoveTo(ScreenPixel(x, y));", hover);

    expect(hover).toBeGreaterThan(0);
    expect(burst).toBeGreaterThan(hover);
    expect(moved).toBeGreaterThan(burst);

    // a press makes the moves that follow it a drag, and the release ends it
    expect(helper).toContain("focusPressed = down;");
    expect(helper).toContain("focusPressed = false;");

    // the window stays in front through a pause in the typing, and the
    // pointer is given back after a longer one
    expect(helper).toContain("if (burst && quiet > 1500) EndBurst();");
  });
});
