import { spawn } from "node:child_process";
import { join } from "node:path";

import {
  INPUT_MOD_ALT,
  INPUT_MOD_CTRL,
  isBridgeInputEvent,
} from "../../bridge/src/protocol";

import type {
  BridgeControlRoute,
  BridgeInputEvent,
} from "../../bridge/src/protocol";

/**
 * The **control** of the editor's own window: the canvas's mouse and keyboard,
 * delivered into it (D-323 to D-327).
 *
 * The half that does the delivering is `media/input.ps1`, a PowerShell helper
 * that ships inside the extension - the same reason the capture helper is a
 * PowerShell script: no runtime dependency, and PowerShell is on every Windows
 * machine. This module is the half that **decides**: which events are let
 * through, in what words they are written to the helper, and what the panel is
 * told about the way in.
 *
 * Three rules:
 *
 *  - **nothing goes through unless Control is on**, and it is off again when
 *    the connection that turned it on ends (D-327);
 *  - **what goes through is a closed list**, every number checked, and what
 *    the machine keeps for itself (the Windows key, Alt+Tab, Alt+F4 ...) is
 *    never sent (D-327);
 *  - **the way in is told**: the helper says which route the input takes and
 *    why, and the panel shows it (D-326).
 *
 * This module imports nothing from `vscode`, so it can be driven by a test
 * without an editor.
 */

/** Where the helper lives, relative to the extension's own root. */
export const INPUT_SCRIPT_RELATIVE_PATH = join("media", "input.ps1");

/** How many events a second the control lets through (D-327). */
export const MAX_INPUT_EVENTS_PER_SECOND = 600;

/** The setting that chooses the way the input goes in (D-326). */
export type InputRouteSetting = "auto" | "background" | "focus";

/** The setting, read: anything that is not a route is `auto`. */
export const resolveInputRoute = (value: unknown): InputRouteSetting =>
  value === "background" || value === "focus" ? value : "auto";

/**
 * The routes the teacher can choose from, as the pick list shows them
 * (D-335).
 *
 * The list is where the teacher chooses: the setting is the same one, and the
 * list is the way to reach it without opening the settings page.
 */
export const INPUT_ROUTE_CHOICES: readonly {
  value: InputRouteSetting;
  label: string;
  description: string;
}[] = [
  {
    value: "auto",
    label: "Automatic",
    description:
      "post the input to the editor's window, and take the focus only where the window cannot take it",
  },
  {
    value: "background",
    label: "Background",
    description:
      "post the input to the editor's window - your own focus, keyboard and mouse are never touched",
  },
  {
    value: "focus",
    label: "Focus",
    description:
      "real input: the window is brought to the front for a moment and your keyboard goes with it",
  },
];

/**
 * The Windows virtual-key code of each key the control may send.
 *
 * A key travels as a **name** (`KeyboardEvent.code`'s own) and never as a raw
 * code, so a page cannot ask for a key that is not on this list (D-327). The
 * test checks that every name the protocol allows has a code here.
 */
export const KEY_VK: Readonly<Record<string, number>> = {
  ...Object.fromEntries(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
      .split("")
      .map((letter) => [`Key${letter}`, letter.charCodeAt(0)]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, digit) => [`Digit${digit}`, 0x30 + digit]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, digit) => [`Numpad${digit}`, 0x60 + digit]),
  ),
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, key) => [`F${key + 1}`, 0x70 + key]),
  ),
  Enter: 0x0d,
  NumpadEnter: 0x0d,
  Tab: 0x09,
  Escape: 0x1b,
  Backspace: 0x08,
  Delete: 0x2e,
  Insert: 0x2d,
  Home: 0x24,
  End: 0x23,
  PageUp: 0x21,
  PageDown: 0x22,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  Space: 0x20,
  Minus: 0xbd,
  Equal: 0xbb,
  BracketLeft: 0xdb,
  BracketRight: 0xdd,
  Backslash: 0xdc,
  Semicolon: 0xba,
  Quote: 0xde,
  Backquote: 0xc0,
  Comma: 0xbc,
  Period: 0xbe,
  Slash: 0xbf,
  NumpadAdd: 0x6b,
  NumpadSubtract: 0x6d,
  NumpadMultiply: 0x6a,
  NumpadDivide: 0x6f,
  NumpadDecimal: 0x6e,
};

/**
 * Is this key a chord the **machine keeps for itself** (D-327)?
 *
 * Alt+F4 would close the teacher's editor, Alt+Tab, Alt+Esc and Ctrl+Esc move
 * the teacher around their own desktop, and Ctrl+Alt+Delete is not a key of
 * any window. They are never sent, whatever the canvas says.
 */
export const isMachineChord = (event: BridgeInputEvent): boolean => {
  if (event.kind !== "key") {
    return false;
  }

  const alt = (event.mods & INPUT_MOD_ALT) !== 0;
  const ctrl = (event.mods & INPUT_MOD_CTRL) !== 0;

  return (
    (alt &&
      (event.code === "F4" ||
        event.code === "Tab" ||
        event.code === "Escape")) ||
    (ctrl && event.code === "Escape") ||
    (ctrl && alt && event.code === "Delete")
  );
};

/** The helper's letter for a button. */
const BUTTON_LETTER = { left: "l", middle: "m", right: "r" } as const;

/** A number the helper reads: plain digits, never an exponent. */
const decimals = (value: number, places: number): string =>
  value.toFixed(places);

/**
 * One event, as the **one line** the helper reads.
 *
 * The fields are separated by single spaces, and none of them can contain one:
 * a place is a number, a key is a code, a text is base64. A text event is the
 * only one that carries what a person typed, and it travels as base64 so that
 * no character in it can be mistaken for the helper's own words.
 *
 * `null` when the event cannot be said (a key that has no code - the protocol
 * already refuses such a key, so this is a guard and not a path).
 */
export const encodeInputLine = (event: BridgeInputEvent): string | null => {
  switch (event.kind) {
    case "pointer":
      return [
        "P",
        event.action,
        decimals(event.x, 6),
        decimals(event.y, 6),
        BUTTON_LETTER[event.button ?? "left"],
        String(event.mods),
      ].join(" ");
    case "wheel":
      return [
        "W",
        decimals(event.x, 6),
        decimals(event.y, 6),
        decimals(event.dx, 3),
        decimals(event.dy, 3),
        String(event.mods),
      ].join(" ");
    case "key": {
      const vk = KEY_VK[event.code];

      if (vk === undefined) {
        return null;
      }

      // The character a key types goes with it; a key held with Ctrl or Alt
      // types nothing, so it carries none (it is a shortcut).
      const typed =
        event.char !== undefined &&
        (event.mods & (INPUT_MOD_CTRL | INPUT_MOD_ALT)) === 0
          ? event.char.codePointAt(0) ?? 0
          : 0;

      return [
        "K",
        event.action,
        String(vk),
        String(typed),
        String(event.mods),
      ].join(" ");
    }
    case "text":
      return `T ${Buffer.from(event.text, "utf8").toString("base64")}`;
    default:
      return null;
  }
};

/** Why the gate did not pass an event. */
export type InputRefusal =
  /** Control is off */
  | "off"
  /** the event is not on the closed list */
  | "refused"
  /** a chord the machine keeps */
  | "machine"
  /** too many events a second */
  | "limited"
  /** the connection that sent it is not the one that turned Control on */
  | "stranger";

export type InputVerdict =
  | { ok: true; line: string }
  | { ok: false; why: InputRefusal };

export interface InputGateOptions {
  /** the clock, in milliseconds. Overridable for the tests. */
  now?: () => number;
  /** how many events a second */
  maxPerSecond?: number;
}

export interface InputGate {
  /** is Control on? */
  readonly enabled: boolean;
  /**
   * Turn Control on or off, for one connection.
   *
   * It answers whether anything **changed**.
   */
  setEnabled: (on: boolean, owner?: unknown) => boolean;
  /**
   * A connection ended: when it was the one that turned Control on, Control is
   * off again (D-327). It answers whether anything changed.
   */
  connectionEnded: (owner: unknown) => boolean;
  /** an event arrived: passed, as a line, or refused, and why */
  accept: (event: unknown, from?: unknown) => InputVerdict;
  /** the events refused for being too many, since the last time it was asked */
  takeDropped: () => number;
}

/**
 * The gate every event passes (D-327).
 *
 * Off is the default. While it is on, an event is let through once, and not
 * more often than the limit a second; what the limit drops is **counted**, so
 * the panel can say it.
 */
export const createInputGate = (options: InputGateOptions = {}): InputGate => {
  const now = options.now ?? Date.now;
  const limit = options.maxPerSecond ?? MAX_INPUT_EVENTS_PER_SECOND;

  let enabled = false;
  let owner: unknown;
  let dropped = 0;

  /** the times of the events of the last second */
  let recent: number[] = [];

  return {
    get enabled() {
      return enabled;
    },

    setEnabled: (on: boolean, from?: unknown): boolean => {
      const changed = enabled !== on || (on && owner !== from);

      enabled = on;
      owner = on ? from : undefined;
      recent = [];

      return changed;
    },

    connectionEnded: (from: unknown): boolean => {
      if (!enabled || owner !== from) {
        return false;
      }

      enabled = false;
      owner = undefined;
      recent = [];

      return true;
    },

    accept: (event: unknown, from?: unknown): InputVerdict => {
      if (!enabled) {
        return { ok: false, why: "off" };
      }

      if (owner !== from) {
        return { ok: false, why: "stranger" };
      }

      if (!isBridgeInputEvent(event)) {
        return { ok: false, why: "refused" };
      }

      if (isMachineChord(event)) {
        return { ok: false, why: "machine" };
      }

      const time = now();

      recent = recent.filter((at) => time - at < 1000);

      if (recent.length >= limit) {
        dropped += 1;

        return { ok: false, why: "limited" };
      }

      const line = encodeInputLine(event);

      if (line === null) {
        return { ok: false, why: "refused" };
      }

      recent.push(time);

      return { ok: true, line };
    },

    takeDropped: (): number => {
      const count = dropped;

      dropped = 0;

      return count;
    },
  };
};

/** What the helper says about the way in (D-326). */
export interface InputHelperState {
  route: BridgeControlRoute;
  /** one sentence. Never empty. */
  reason: string;
}

/**
 * One line of the helper's stdout, read.
 *
 * `ROUTE <route> <reason>` is the way in; `STATUS <text>` is something the
 * teacher should read (a window that would not come to the front);
 * `NEED display` says the way in is real input and the window is not on a
 * display, so the extension can bring it back (D-336). Anything else is not
 * said to the panel.
 */
export const parseHelperLine = (
  line: string,
):
  | { kind: "route"; state: InputHelperState }
  | { kind: "status"; text: string }
  | { kind: "need"; what: "display" }
  | null => {
  const trimmed = line.trim();
  const route = /^ROUTE\s+(background|focus|none)\s+(.+)$/.exec(trimmed);

  if (route) {
    return {
      kind: "route",
      state: { route: route[1] as BridgeControlRoute, reason: route[2] },
    };
  }

  if (/^NEED\s+display$/.test(trimmed)) {
    return { kind: "need", what: "display" };
  }

  const status = /^STATUS\s+(.+)$/.exec(trimmed);

  if (status) {
    return { kind: "status", text: status[1] };
  }

  return null;
};

/** The arguments the helper is run with. */
export const inputArgs = (options: {
  scriptPath: string;
  processName: string;
  titleLike: string;
  route: InputRouteSetting;
}): string[] => [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  options.scriptPath,
  "-ProcessName",
  options.processName,
  "-TitleLike",
  options.titleLike,
  "-Route",
  options.route,
];

/** The part of `child_process.ChildProcess` the helper uses. */
export interface InputProcess {
  stdin: { write: (line: string) => unknown; end?: () => unknown } | null;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: "error", listener: (error: Error) => void): this;
  on(
    event: "exit",
    listener: (code: number | null, signal: string | null) => void,
  ): this;
  kill(signal?: string | number): boolean;
}

export type InputSpawn = (
  command: string,
  args: string[],
  options: { windowsHide?: boolean },
) => InputProcess;

const defaultSpawn: InputSpawn = (command, args, options) =>
  spawn(command, args, {
    windowsHide: options.windowsHide,
    stdio: ["pipe", "pipe", "pipe"],
  }) as unknown as InputProcess;

export interface WindowInputOptions {
  /** the helper's path */
  scriptPath: string;
  /** the OS process name of the editor: "Code", "VSCodium" */
  processName: string;
  /** the workspace folder's name, as it appears in the window's title */
  titleLike: string;
  /** the route the setting asks for */
  route: InputRouteSetting;
  /** the helper said how its input goes in */
  onState: (state: InputHelperState) => void;
  /** the helper said something the teacher should read */
  onStatus?: (text: string) => void;
  /**
   * The helper needs the window on a display (D-336): real input goes to the
   * window in front, and a parked window is not on a display. The extension
   * brings it back and says `R` to the helper, which looks again.
   */
  onNeed?: (what: "display") => void;
  /** overridable for the tests */
  spawn?: InputSpawn;
  /** how long a dead helper waits before it is started again */
  restartAfterMs?: number;
  /** overridable for the tests */
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface WindowInput {
  /** the helper is wanted: it is started, and started again when it dies */
  start: () => void;
  /** the helper is not wanted any more */
  stop: () => void;
  /** one line for the helper. `false` when there is no helper to take it. */
  send: (line: string) => boolean;
  /** is a helper running? */
  readonly running: boolean;
}

/**
 * The helper, kept running for as long as Control is on (D-323).
 *
 * It is **one** process for the whole time - a process per event would spawn
 * for every mouse move - and a helper that **dies** is started again, so one
 * dead helper is not a dead control for the rest of the lesson (D-112). When
 * nothing wants it, there is no process at all.
 */
export const createWindowInput = (options: WindowInputOptions): WindowInput => {
  const spawnHelper = options.spawn ?? defaultSpawn;
  const setTimer =
    options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ??
    ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const restartAfterMs = options.restartAfterMs ?? 1000;

  let child: InputProcess | null = null;
  let wanted = false;
  let restart: unknown = null;

  const readLines = (stream: NodeJS.ReadableStream | null) => {
    let buffer = "";

    stream?.on("data", (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

      for (;;) {
        const newline = buffer.indexOf("\n");

        if (newline === -1) {
          return;
        }

        const line = buffer.slice(0, newline);

        buffer = buffer.slice(newline + 1);

        const said = parseHelperLine(line);

        if (said?.kind === "route") {
          options.onState(said.state);
        } else if (said?.kind === "status") {
          options.onStatus?.(said.text);
        } else if (said?.kind === "need") {
          options.onNeed?.(said.what);
        }
      }
    });
  };

  const launch = () => {
    if (child || !wanted) {
      return;
    }

    let started: InputProcess;

    try {
      started = spawnHelper(
        "powershell.exe",
        inputArgs({
          scriptPath: options.scriptPath,
          processName: options.processName,
          titleLike: options.titleLike,
          route: options.route,
        }),
        { windowsHide: true },
      );
    } catch (error) {
      options.onState({
        route: "none",
        reason: `the input helper could not be started: ${
          (error as Error).message
        }`,
      });

      return;
    }

    child = started;
    readLines(started.stdout);

    // a helper that has something to say on stderr is not silent: it is a
    // fact for the log, and the route stays what the helper last said
    started.stderr?.on("data", () => undefined);

    started.on("error", (error: Error) => {
      if (child === started) {
        child = null;
      }

      options.onState({
        route: "none",
        reason: `the input helper could not be run: ${error.message}`,
      });
    });

    started.on("exit", () => {
      if (child === started) {
        child = null;
      }

      if (wanted && restart === null) {
        // started again - one dead helper must not be dead for the lesson
        restart = setTimer(() => {
          restart = null;
          launch();
        }, restartAfterMs);
      }
    });
  };

  return {
    start: () => {
      wanted = true;
      launch();
    },

    stop: () => {
      wanted = false;

      if (restart !== null) {
        clearTimer(restart);
        restart = null;
      }

      const running = child;

      child = null;

      try {
        running?.stdin?.end?.();
      } catch {
        // the helper may be gone already
      }

      running?.kill();
    },

    send: (line: string): boolean => {
      if (!child?.stdin) {
        return false;
      }

      try {
        child.stdin.write(`${line}\n`);
      } catch {
        return false;
      }

      return true;
    },

    get running() {
      return child !== null;
    },
  };
};
