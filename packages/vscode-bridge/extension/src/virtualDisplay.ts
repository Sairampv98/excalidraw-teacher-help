import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * The **virtual display** - the screen the students see (D-145).
 *
 * The owner approved this in one line: *"yes work on the virtual display+input
 * panel"*. The idea is that **the screen the students see and the controls the
 * teacher uses are different surfaces**: today the presenter view takes over
 * the teacher's own desktop, so they cannot keep their notes or their IDE in
 * front of them while presenting.
 *
 * This module is the extension's half of that:
 *
 *  - it **enumerates the display devices** on the machine and says which one
 *    is a **virtual** monitor - on Windows, an indirect display driver, the
 *    kind tools like "Virtual Display Driver" install;
 *  - it **places the presenter's window** on that display;
 *  - and when there is **no** virtual display, it says so plainly and falls
 *    back to the presenter's own window on the normal desktop.
 *
 * The rules this module keeps:
 *
 *  - **no driver is required and none is installed**. The feature works on a
 *    machine that has never heard of an indirect display driver, and it says
 *    what it found instead of failing quietly.
 *  - **the window is found BY RULE** (the same rule the capture uses, D-112,
 *    D-113): the presenter's window is located by its title, never by a
 *    remembered handle. A window on a virtual display is found exactly like a
 *    window on the desktop.
 *  - **the placement never takes the focus**. The teacher is typing in their
 *    editor while the presenter's window moves, and a window that grabs the
 *    focus while it moves takes their keystrokes away.
 *
 * This module imports nothing from `vscode`, so it can be driven by a test
 * without an editor - the same reason `config.ts` and `windowCapture.ts` keep
 * their rules out of the editor's API.
 */

/** Where the helper lives, relative to the extension's own root. */
export const VIRTUAL_DISPLAY_SCRIPT_RELATIVE_PATH = join(
  "media",
  "virtual-display.ps1",
);

/**
 * The title rule that finds the **presenter's window**.
 *
 * The presenter names its own window "Excalidraw - Presenter view", so the
 * rule is a substring of that title. The rule is a RULE and not a handle: the
 * browser recreates its window, and a remembered handle is a dead one.
 */
export const PRESENTER_WINDOW_TITLE = "Presenter view";

/** One display on this machine, as the OS reports it. */
export interface DisplayDevice {
  /** the device's name, e.g. "\\.\DISPLAY1" */
  device: string;
  /** the monitor's own name, e.g. "Generic PnP Monitor" */
  name: string;
  /** the adapter that carries it, e.g. "AMD Radeon(TM) Graphics" */
  adapter: string;
  /** the adapter's device id, e.g. "PCI\\VEN_1002&DEV_1638" */
  adapterId: string;
  /** the display device's id, e.g. "MONITOR\\LEN9059\\{...}" */
  deviceId: string;
  /** the display device's key in the registry */
  deviceKey: string;
  /** the adapter's key in the registry */
  adapterKey: string;
  /** the display's width, in pixels */
  width: number;
  /** the display's height, in pixels */
  height: number;
  /** where the display's top-left corner sits, in virtual-desktop pixels */
  x: number;
  /** where the display's top-left corner sits, in virtual-desktop pixels */
  y: number;
  /** is this display attached to the desktop right now? */
  attached: boolean;
  /** is this the primary display? */
  primary: boolean;
  /** the adapter's own state flags */
  adapterFlags: number;
  /** the display device's own state flags */
  deviceFlags: number;
  /**
   * Is this a **virtual** display - an indirect display driver?
   *
   * It is decided by {@link isVirtualDisplayText}, and it is reported here so
   * that the reason can be shown and not guessed at.
   */
  virtual: boolean;
}

/**
 * The rule that tells a **virtual** display from a real one.
 *
 * An indirect display driver names itself in what the OS reports for the
 * display: the adapter's description ("Virtual Display Driver"), the device's
 * id, or the driver's own key in the registry. The adapter's own
 * `DISPLAY_DEVICE_VIRTUAL` flag (0x10) is the other signal, and it is used as
 * one - the strings are what a driver actually says, and a driver that says
 * nothing is still reported as a display that is not virtual.
 */
export const VIRTUAL_DISPLAY_PATTERN = /virtual|indirect|\bidd\b/i;

/**
 * Whether any of these strings says "this display is a virtual one".
 *
 * The strings are the ones the OS reports for the display: the adapter's
 * description, the adapter's id, the monitor's name, the monitor's id and the
 * two registry keys.
 */
export const isVirtualDisplayText = (
  ...parts: (string | undefined | null)[]
): boolean =>
  parts.some((part) => !!part && VIRTUAL_DISPLAY_PATTERN.test(part));

/**
 * The adapter's `DISPLAY_DEVICE_VIRTUAL` flag.
 *
 * It is 0x10, and it is the OS's own word for "this adapter is a virtual
 * one". It is one signal among several, never the only one.
 */
export const DISPLAY_DEVICE_VIRTUAL = 0x10;

/** The raw record the helper writes, before the rule has judged it. */
interface RawDisplay {
  device?: string;
  name?: string;
  adapter?: string;
  adapterId?: string;
  adapterKey?: string;
  deviceId?: string;
  deviceKey?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  attached?: boolean;
  primary?: boolean;
  adapterFlags?: number;
  deviceFlags?: number;
}

/** The number the helper reports, or 0 when it reported nothing. */
const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** The string the helper reports, or the empty string. */
const asText = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * The helper's output, read.
 *
 * Every line is ONE json object, so a record is never half-read: a line that
 * is not json is skipped, and a record that is not a display is skipped too.
 */
export const parseDisplays = (output: string): DisplayDevice[] => {
  const displays: DisplayDevice[] = [];

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("{")) {
      continue;
    }

    let raw: RawDisplay;

    try {
      raw = JSON.parse(trimmed) as RawDisplay;
    } catch {
      continue;
    }

    if (!raw || typeof raw !== "object" || !asText(raw.device)) {
      continue;
    }

    const adapterFlags = asNumber(raw.adapterFlags);

    displays.push({
      device: asText(raw.device),
      name: asText(raw.name),
      adapter: asText(raw.adapter),
      adapterId: asText(raw.adapterId),
      deviceId: asText(raw.deviceId),
      deviceKey: asText(raw.deviceKey),
      adapterKey: asText(raw.adapterKey),
      width: asNumber(raw.width),
      height: asNumber(raw.height),
      x: asNumber(raw.x),
      y: asNumber(raw.y),
      attached: raw.attached !== false,
      primary: raw.primary === true,
      adapterFlags,
      deviceFlags: asNumber(raw.deviceFlags),
      virtual:
        isVirtualDisplayText(
          raw.adapter,
          raw.adapterId,
          raw.adapterKey,
          raw.name,
          raw.deviceId,
          raw.deviceKey,
        ) || (adapterFlags & DISPLAY_DEVICE_VIRTUAL) !== 0,
    });
  }

  return displays;
};

/**
 * The display the presenter's window goes on, and **why**.
 *
 * A virtual display wins when there is one. When there is not, the primary
 * display is the target and the reason says so plainly: the presenter's
 * window opens on the desktop, and the teacher is told that it does - never
 * a silent failure and never a crash.
 */
export interface DisplayTarget {
  /** the display the window goes on. Never null when there is a display. */
  display: DisplayDevice | null;
  /** is that display a virtual one? */
  virtual: boolean;
  /** the sentence the teacher reads. Never empty. */
  reason: string;
}

/**
 * The sentence the teacher reads when the machine has no virtual display.
 *
 * It is a FACT about this machine, and it says what happens instead: the
 * presenter's window opens on the desktop.
 */
export const NO_VIRTUAL_DISPLAY_REASON =
  "no virtual display was found on this machine - the presenter's window opens on the desktop";

/**
 * Picks the display the presenter's window goes on.
 *
 * The rule: a **virtual** display wins, and the first one is taken when there
 * are several. Without one, the **primary** display is the target - the
 * desktop - and the reason says so.
 */
export const chooseTargetDisplay = (
  displays: DisplayDevice[],
): DisplayTarget => {
  const virtual = displays.find((display) => display.virtual);

  if (virtual) {
    return {
      display: virtual,
      virtual: true,
      reason: `the presenter's window is on the virtual display ${
        virtual.name || virtual.device
      } (${virtual.width}x${virtual.height} at ${virtual.x},${virtual.y})`,
    };
  }

  const primary =
    displays.find((display) => display.primary) ?? displays[0] ?? null;

  if (!primary) {
    return {
      display: null,
      virtual: false,
      reason: `${NO_VIRTUAL_DISPLAY_REASON} - and no display was found at all`,
    };
  }

  return {
    display: primary,
    virtual: false,
    reason: NO_VIRTUAL_DISPLAY_REASON,
  };
};

/** A window the rule found. */
export interface FoundWindow {
  /** was a window found at all? */
  found: boolean;
  /** is it on screen right now? */
  visible: boolean;
  /** the window's handle */
  handle: number;
  /** the window's title */
  title: string;
  /** where the window sits */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The window the helper found, read. */
export const parseWindow = (output: string): FoundWindow | null => {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("{")) {
      continue;
    }

    let raw: Record<string, unknown>;

    try {
      raw = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (!raw || typeof raw !== "object") {
      continue;
    }

    if (raw.found !== true) {
      return {
        found: false,
        visible: false,
        handle: 0,
        title: "",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      };
    }

    return {
      found: true,
      visible: raw.visible === true,
      handle: asNumber(raw.handle),
      title: asText(raw.title),
      x: asNumber(raw.x),
      y: asNumber(raw.y),
      width: asNumber(raw.width),
      height: asNumber(raw.height),
    };
  }

  return null;
};

/** What the placement did. */
export interface PlacementResult {
  /** was the window moved? */
  placed: boolean;
  /** the sentence the teacher reads. Never empty. */
  reason: string;
  /** the display the window went on, when it went on one */
  display: DisplayDevice | null;
  /** the window's handle */
  handle: number;
}

/** Runs the helper and gives back its output. */
export type VirtualDisplayRunner = (args: string[]) => Promise<string>;

/**
 * The helper, run for real.
 *
 * It is a PowerShell script that ships inside the extension, so there is
 * nothing to install and no dependency to add - the same reason the capture
 * helper is a PowerShell script.
 */
const defaultRunner: VirtualDisplayRunner = (args) =>
  new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    try {
      const child = spawn("powershell.exe", args, { windowsHide: true });

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("error", (error: Error) => {
        reject(
          new Error(
            `the virtual display helper could not be run: ${error.message}`,
          ),
        );
      });

      child.on("close", (code: number | null) => {
        if (code !== 0 && !stdout.trim()) {
          reject(
            new Error(
              `the virtual display helper exited with code ${
                code ?? "unknown"
              }${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
            ),
          );
          return;
        }

        resolve(stdout);
      });
    } catch (error) {
      reject(
        new Error(
          `the virtual display helper could not be started: ${
            (error as Error).message
          }`,
        ),
      );
    }
  });

export interface VirtualDisplayOptions {
  /** the helper's path */
  scriptPath: string;
  /** the title rule that finds the presenter's window */
  titleLike?: string;
  /** overridable for the tests */
  run?: VirtualDisplayRunner;
}

export interface VirtualDisplayService {
  /** every display on this machine */
  displays: () => Promise<DisplayDevice[]>;
  /** the display the presenter's window goes on, and why */
  target: () => Promise<DisplayTarget>;
  /** the presenter's window, found BY RULE */
  findPresenter: () => Promise<FoundWindow | null>;
  /** put a window on a display, without taking the focus */
  place: (handle: number, display: DisplayDevice) => Promise<boolean>;
  /**
   * Put the presenter's window on the virtual display.
   *
   * With no virtual display it does NOT move the window: the presenter's own
   * window opens on the desktop, and the reason says so.
   */
  placePresenter: () => Promise<PlacementResult>;
}

/**
 * The virtual display service.
 *
 * Every answer is a **fact**: the displays it found, the display it chose,
 * the window it found and what it did with it. Nothing here is silent.
 */
export const createVirtualDisplay = (
  options: VirtualDisplayOptions,
): VirtualDisplayService => {
  const run = options.run ?? defaultRunner;
  const titleLike = options.titleLike ?? PRESENTER_WINDOW_TITLE;

  const helperArgs = (rest: string[]) => [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    options.scriptPath,
    ...rest,
  ];

  const displays = async (): Promise<DisplayDevice[]> => {
    const output = await run(helperArgs(["-Mode", "Enumerate"]));
    return parseDisplays(output);
  };

  const target = async (): Promise<DisplayTarget> =>
    chooseTargetDisplay(await displays());

  const findPresenter = async (): Promise<FoundWindow | null> => {
    const output = await run(
      helperArgs(["-Mode", "Find", "-TitleLike", titleLike]),
    );
    return parseWindow(output);
  };

  const place = async (
    handle: number,
    display: DisplayDevice,
  ): Promise<boolean> => {
    const output = await run(
      helperArgs([
        "-Mode",
        "Place",
        "-Handle",
        String(handle),
        "-X",
        String(display.x),
        "-Y",
        String(display.y),
        "-Width",
        String(display.width),
        "-Height",
        String(display.height),
      ]),
    );

    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();

      if (!trimmed.startsWith("{")) {
        continue;
      }

      try {
        const raw = JSON.parse(trimmed) as Record<string, unknown>;
        return raw.placed === true;
      } catch {
        continue;
      }
    }

    return false;
  };

  const placePresenter = async (): Promise<PlacementResult> => {
    const chosen = await target();

    if (!chosen.display) {
      return {
        placed: false,
        reason: chosen.reason,
        display: null,
        handle: 0,
      };
    }

    if (!chosen.virtual) {
      // No virtual display: the presenter's own window opens on the desktop,
      // and nothing is moved. The teacher is told that in plain words.
      return {
        placed: false,
        reason: chosen.reason,
        display: chosen.display,
        handle: 0,
      };
    }

    const window = await findPresenter();

    if (!window?.found) {
      return {
        placed: false,
        reason:
          "no presenter window was found to move - open the presenter view first",
        display: chosen.display,
        handle: 0,
      };
    }

    const placed = await place(window.handle, chosen.display);

    return {
      placed,
      reason: placed
        ? `the presenter's window was moved to the virtual display ${
            chosen.display.name || chosen.display.device
          }`
        : "the presenter's window could not be moved to the virtual display",
      display: chosen.display,
      handle: window.handle,
    };
  };

  return { displays, target, findPresenter, place, placePresenter };
};
