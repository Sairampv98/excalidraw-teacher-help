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
 *  - **an installed but DETACHED virtual display is a fact, and the fact names
 *    the click** (D-146). A teacher who has installed a virtual display driver
 *    and left its monitor detached must never be told "there is no virtual
 *    display" - they are one click away from the thing they asked for, and the
 *    reason tells them which click it is.
 *  - **the window is found BY RULE** (the same rule the capture uses, D-112,
 *    D-113): the presenter's window is located by its title, never by a
 *    remembered handle. A window on a virtual display is found exactly like a
 *    window on the desktop - and so is the **editor's own window** (D-147),
 *    whose title carries the workspace name.
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
  /**
   * Is this display **detached** - installed, but not part of the desktop's
   * coordinate space (D-146)?
   *
   * A virtual display driver can be installed and its monitor kept detached:
   * VDD Control holds a monitor detached until the teacher sets its mode to
   * Extend. A detached display has no mode, so it has no size and no place,
   * and **no window can be placed on it**. It is still reported - the driver
   * is installed, that is a fact - and the reason says what to do about it.
   */
  detached: boolean;
  /**
   * The helper's own words about this display - the click that attaches a
   * detached one. Empty when there is nothing to say.
   */
  reason: string;
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
  virtual?: boolean;
  detached?: boolean;
  reason?: string;
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
    const attached = raw.attached !== false;

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
      attached,
      primary: raw.primary === true,
      adapterFlags,
      deviceFlags: asNumber(raw.deviceFlags),
      virtual:
        raw.virtual === true ||
        isVirtualDisplayText(
          raw.adapter,
          raw.adapterId,
          raw.adapterKey,
          raw.name,
          raw.deviceId,
          raw.deviceKey,
        ) ||
        (adapterFlags & DISPLAY_DEVICE_VIRTUAL) !== 0,
      // A display that is not attached to the desktop is detached, whether the
      // helper says so or the OS's own flags say so (D-146).
      detached: raw.detached === true || !attached,
      reason: asText(raw.reason),
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
  /**
   * Is there a virtual display that is **installed but detached** (D-146)?
   *
   * It is never the target - a detached display is not part of the desktop's
   * coordinate space, so there is nothing to place a window on - and the
   * remedy names the click that attaches it.
   */
  detached: boolean;
  /** the sentence the teacher reads. Never empty. */
  reason: string;
  /**
   * The click that attaches a detached virtual display.
   *
   * Empty when there is nothing to do - the display is there, or there is none
   * at all.
   */
  remedy: string;
}

/**
 * The fact: this machine has no virtual display.
 *
 * It is a fact about the MACHINE, so it is kept apart from the sentence that
 * follows it - that sentence says what happens to the window, and the window
 * is not always the presenter's one.
 */
export const NO_VIRTUAL_DISPLAY_FACT =
  "no virtual display was found on this machine";

/**
 * The sentence the teacher reads when the machine has no virtual display.
 *
 * It is a FACT about this machine, and it says what happens instead: the
 * presenter's window opens on the desktop.
 */
export const NO_VIRTUAL_DISPLAY_REASON = `${NO_VIRTUAL_DISPLAY_FACT} - the presenter's window opens on the desktop`;

/**
 * The click that attaches a **detached** virtual display (D-146).
 *
 * VDD Control keeps a monitor detached until the teacher sets its mode to
 * Extend. That is the one click the teacher has to make, so the reason names
 * it - the extension never says "there is no virtual display" to a teacher
 * who has one installed.
 */
export const DETACHED_VIRTUAL_DISPLAY_REMEDY =
  "open VDD Control and set the monitor to Extend";

/**
 * The sentence for a virtual display that is **installed but detached**.
 *
 * It names the click, and it says what happens until the click is made.
 */
export const detachedVirtualDisplayReason = (display: DisplayDevice): string =>
  `the virtual display ${
    display.name || display.adapter || display.device
  } is installed but its monitor is DETACHED - ${DETACHED_VIRTUAL_DISPLAY_REMEDY}, and a window can be placed on it; until then the window opens on the desktop`;

/**
 * Picks the display the presenter's window goes on.
 *
 * The rule: an **attached virtual** display wins, and the first one is taken
 * when there are several. A virtual display that is **detached** is never the
 * target - there is nothing to place a window on - but it is not ignored
 * either: the reason names the click that attaches it (D-146). Without any
 * virtual display, the **primary** display is the target - the desktop - and
 * the reason says so.
 */
export const chooseTargetDisplay = (
  displays: DisplayDevice[],
): DisplayTarget => {
  // the displays that are part of the desktop's coordinate space right now
  const onScreen = displays.filter((display) => !display.detached);
  const virtual = onScreen.find((display) => display.virtual);

  if (virtual) {
    return {
      display: virtual,
      virtual: true,
      detached: false,
      reason: `a window goes on the virtual display ${
        virtual.name || virtual.device
      } (${virtual.width}x${virtual.height} at ${virtual.x},${virtual.y})`,
      remedy: "",
    };
  }

  // A virtual display that is installed but detached: a fact, and a fact with
  // a click in it (D-146).
  const detachedVirtual = displays.find(
    (display) => display.virtual && display.detached,
  );

  if (detachedVirtual) {
    const desktop =
      onScreen.find((display) => display.primary) ?? onScreen[0] ?? null;

    return {
      display: desktop,
      virtual: false,
      detached: true,
      reason: detachedVirtualDisplayReason(detachedVirtual),
      remedy: DETACHED_VIRTUAL_DISPLAY_REMEDY,
    };
  }

  const primary =
    onScreen.find((display) => display.primary) ?? onScreen[0] ?? null;

  if (!primary) {
    return {
      display: null,
      virtual: false,
      detached: false,
      reason: `${NO_VIRTUAL_DISPLAY_REASON} - and no display was found at all`,
      remedy: "",
    };
  }

  return {
    display: primary,
    virtual: false,
    detached: false,
    reason: NO_VIRTUAL_DISPLAY_REASON,
    remedy: "",
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

/** What a placement did - MEASURED, never believed (D-147). */
export interface PlacementOutcome {
  /** is the window where it was asked to be? */
  placed: boolean;
  /** did the move call itself succeed? (the API's own word, not the answer) */
  moved: boolean;
  /** was the window maximised BEFORE the move? */
  wasMaximised: boolean;
  /** was the window un-maximised to make the move possible? */
  restored: boolean;
  /** is the window maximised now? */
  maximised: boolean;
  /** was the window minimised, and therefore left alone? */
  minimised: boolean;
  /** the MEASURED left edge */
  x: number;
  /** the MEASURED top edge */
  y: number;
  /** the MEASURED width */
  width: number;
  /** the MEASURED height */
  height: number;
  /** why it did not land, when it did not */
  reason: string;
}

/**
 * The helper's answer about a placement, read.
 *
 * The rect it reports is the MEASURED one: the helper reads the window back
 * after the move, because `SetWindowPos` returns TRUE on a maximised window
 * and the window does not move (D-147).
 */
export const parsePlacement = (output: string): PlacementOutcome => {
  const nothing: PlacementOutcome = {
    placed: false,
    moved: false,
    wasMaximised: false,
    restored: false,
    maximised: false,
    minimised: false,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    reason: "the helper did not answer",
  };

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;

      return {
        placed: raw.placed === true,
        moved: raw.moved === true,
        wasMaximised: raw.wasMaximised === true,
        restored: raw.restored === true,
        maximised: raw.maximised === true,
        minimised: raw.minimised === true,
        x: asNumber(raw.measuredX),
        y: asNumber(raw.measuredY),
        width: asNumber(raw.measuredWidth),
        height: asNumber(raw.measuredHeight),
        reason: asText(raw.reason),
      };
    } catch {
      continue;
    }
  }

  return nothing;
};

/** What a placement did. */
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

/**
 * The rule that finds a window, and what the panel may say about it.
 *
 * The rule is a **title substring** and the process that owns the window. A
 * handle is never remembered (D-112, D-113).
 */
export interface PlaceWindowOptions {
  /** the title substring that finds the window */
  titleLike: string;
  /** the process that owns the window, when the caller knows it */
  processName?: string;
  /** what the window is called in the sentence the teacher reads */
  subject: string;
  /** what to do when no window is found */
  hint?: string;
}

export interface VirtualDisplayService {
  /** every display on this machine */
  displays: () => Promise<DisplayDevice[]>;
  /** the display the presenter's window goes on, and why */
  target: () => Promise<DisplayTarget>;
  /** the presenter's window, found BY RULE */
  findPresenter: () => Promise<FoundWindow | null>;
  /**
   * A window, found BY RULE (D-112, D-113, D-147).
   *
   * The rule is a **title substring** and, when the caller knows it, the
   * process that owns the window. A handle is never remembered.
   */
  findWindow: (
    titleLike: string,
    processName?: string,
  ) => Promise<FoundWindow | null>;
  /**
   * Put a window on a display, without taking the focus.
   *
   * The answer is MEASURED: the window is read back after the move, and a
   * move that did not happen is never reported as one (D-147).
   */
  place: (
    handle: number,
    display: DisplayDevice,
    options?: { maximise?: boolean },
  ) => Promise<PlacementOutcome>;
  /**
   * Put the presenter's window on the virtual display.
   *
   * With no virtual display it does NOT move the window: the presenter's own
   * window opens on the desktop, and the reason says so.
   */
  placePresenter: () => Promise<PlacementResult>;
  /**
   * Put **a** window on the virtual display, found BY RULE (D-147).
   *
   * The editor's own window goes on the virtual display the same way the
   * presenter's window does - the same rule finds it, and the placement never
   * takes the focus, so the teacher keeps typing while their window moves.
   */
  placeWindow: (options: PlaceWindowOptions) => Promise<PlacementResult>;
  /**
   * Bring a window **BACK** to the display the teacher is working on (D-149).
   *
   * The feature is not a one-way door: the window goes back to the primary
   * display, in the size it had before it moved, and maximised again if it
   * was maximised before it moved.
   */
  bringBack: (options: PlaceWindowOptions) => Promise<PlacementResult>;
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

  const findWindow = async (
    rule: string,
    processName?: string,
  ): Promise<FoundWindow | null> => {
    const output = await run(
      helperArgs([
        "-Mode",
        "Find",
        "-TitleLike",
        rule,
        ...(processName ? ["-ProcessName", processName] : []),
      ]),
    );
    return parseWindow(output);
  };

  const findPresenter = async (): Promise<FoundWindow | null> =>
    findWindow(titleLike);

  const place = async (
    handle: number,
    display: DisplayDevice,
    placeOptions: { maximise?: boolean } = {},
  ): Promise<PlacementOutcome> => {
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
        ...(placeOptions.maximise ? ["-Maximise"] : []),
      ]),
    );

    return parsePlacement(output);
  };

  /**
   * What it remembers about a window it moved.
   *
   * Not the handle - never the handle (D-112, D-113) - but the FACTS the
   * round trip needs: was the window maximised, and how big was it? The
   * window is found by its rule again, and these two facts put it back the
   * way the teacher had it (D-149).
   */
  const moved = new Map<
    string,
    { maximised: boolean; width: number; height: number }
  >();

  const ruleKey = (rule: PlaceWindowOptions): string =>
    `${rule.titleLike}|${rule.processName ?? ""}`;

  const placeWindow = async (
    options: PlaceWindowOptions,
  ): Promise<PlacementResult> => {
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
      // There is no virtual display to place the window on: the window stays
      // where it is, and the teacher is told that in plain words. When the
      // display IS there and only DETACHED, the reason is the one that names
      // the click that attaches it (D-146).
      return {
        placed: false,
        reason: chosen.detached
          ? chosen.reason
          : `${NO_VIRTUAL_DISPLAY_FACT} - ${options.subject} opens on the desktop`,
        display: chosen.display,
        handle: 0,
      };
    }

    const window = await findWindow(options.titleLike, options.processName);

    if (!window?.found) {
      return {
        placed: false,
        reason: `no window was found to move - ${
          options.hint ?? `${options.subject} is not open`
        }`,
        display: chosen.display,
        handle: 0,
      };
    }

    const outcome = await place(window.handle, chosen.display);

    if (outcome.placed) {
      // The facts the round trip needs - was it maximised, and how big was
      // it? (D-149). The handle is NOT kept: the window is found by its rule
      // again.
      moved.set(ruleKey(options), {
        maximised: outcome.wasMaximised,
        width: window.width,
        height: window.height,
      });
    } else {
      moved.delete(ruleKey(options));
    }

    return {
      placed: outcome.placed,
      reason: outcome.placed
        ? `${options.subject} was moved to the virtual display ${
            chosen.display.name || chosen.display.device
          } (${outcome.width}x${outcome.height} at ${outcome.x},${outcome.y})`
        : `${options.subject} was not moved - ${outcome.reason}`,
      display: chosen.display,
      handle: window.handle,
    };
  };

  const placePresenter = async (): Promise<PlacementResult> =>
    placeWindow({
      titleLike,
      subject: "the presenter's window",
      hint: "open the presenter view first",
    });

  /**
   * Bring a window BACK to the display the teacher is working on (D-149).
   *
   * The window goes back to the primary display, in the size it had before
   * it moved, and maximised again if it was maximised before it moved. The
   * feature is not a one-way door.
   */
  const bringBack = async (
    options: PlaceWindowOptions,
  ): Promise<PlacementResult> => {
    const found = await displays();
    const onScreen = found.filter((display) => !display.detached);
    const desktop =
      onScreen.find((display) => display.primary && !display.virtual) ??
      onScreen.find((display) => !display.virtual) ??
      null;

    if (!desktop) {
      return {
        placed: false,
        reason: `${NO_VIRTUAL_DISPLAY_FACT} - and no display was found at all`,
        display: null,
        handle: 0,
      };
    }

    const window = await findWindow(options.titleLike, options.processName);

    if (!window?.found) {
      return {
        placed: false,
        reason: `no window was found to bring back - ${
          options.hint ?? `${options.subject} is not open`
        }`,
        display: desktop,
        handle: 0,
      };
    }

    const was = moved.get(ruleKey(options));
    const wasMaximised = was?.maximised === true;
    const outcome = await place(
      window.handle,
      {
        ...desktop,
        // the window goes back in the size it had before it moved
        width: was?.width || desktop.width,
        height: was?.height || desktop.height,
      },
      { maximise: wasMaximised },
    );

    if (outcome.placed) {
      moved.delete(ruleKey(options));
    }

    return {
      placed: outcome.placed,
      reason: outcome.placed
        ? `${options.subject} is back on ${desktop.name || desktop.device}${
            wasMaximised ? ", maximised as it was" : ""
          }`
        : `${options.subject} was not brought back - ${outcome.reason}`,
      display: desktop,
      handle: window.handle,
    };
  };

  return {
    displays,
    target,
    findPresenter,
    findWindow,
    place,
    placePresenter,
    placeWindow,
    bringBack,
  };
};
