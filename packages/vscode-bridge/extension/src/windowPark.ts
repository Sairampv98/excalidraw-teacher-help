import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * **Parking** the editor's own window (D-328).
 *
 * The teacher wants their editor out of the way - their screen is for the
 * canvas, the notes and the class - and still **seen and driven from the
 * canvas**. A window that is moved far off every display does exactly that:
 * measured on this machine, a VS Code window at -30000,-30000 kept drawing its
 * frames to `PrintWindow`, took every kind of input and saved its file. So
 * nothing has to be installed for it (D-329): no driver, no second screen, no
 * reboot.
 *
 * The rules this module keeps are the ones the window's moves have always had:
 *
 *  - **the window is found BY RULE** (D-112, D-113): the editor's process and
 *    the workspace folder's name in its title - never a remembered handle, which
 *    is a dead one the moment the editor recreates its window;
 *  - **a move never takes the focus** (D-147): the teacher keeps typing while
 *    their window goes;
 *  - **nothing moves unless the teacher asked** (D-148);
 *  - **the window comes BACK** (D-149), the way the teacher had it: its place
 *    and size and whether it was maximised are kept as **facts** - never as a
 *    handle - and with no facts (the extension was restarted while the window
 *    was parked) it comes back on the primary display;
 *  - **a move is MEASURED, not believed** (D-150): the rect is read back, and a
 *    move that did not happen is never reported as one.
 *
 * This module imports nothing from `vscode`, so it can be driven by a test
 * without an editor - the same reason `windowCapture.ts` keeps its rules out of
 * the editor's API.
 */

/** Where the helper lives, relative to the extension's own root. */
export const WINDOW_SCRIPT_RELATIVE_PATH = join("media", "window.ps1");

/**
 * Where a window is parked: the top-left corner, far off every display.
 *
 * It is far enough to be off any arrangement of displays and near enough that
 * the places inside the window still fit the 16 bits a mouse message carries
 * (a wheel message names its place on the screen).
 */
export const PARK_X = -30000;
export const PARK_Y = -30000;

/** Is a window at this place parked? */
export const isParkedPlace = (x: number, y: number): boolean =>
  x <= PARK_X / 2 && y <= PARK_Y / 2;

/** The number the helper reports, or 0 when it reported nothing. */
const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** The string the helper reports, or the empty string. */
const asText = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** The first json object the helper wrote, or null. */
const firstRecord = (output: string): Record<string, unknown> | null => {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("{")) {
      continue;
    }

    try {
      const raw = JSON.parse(trimmed) as unknown;

      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return raw as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }

  return null;
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
  const raw = firstRecord(output);

  if (!raw) {
    return null;
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
};

/** What a placement did - MEASURED, never believed (D-150). */
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
 * after the move, because `SetWindowPos` returns TRUE on a maximised window and
 * the window does not move (D-150).
 */
export const parsePlacement = (output: string): PlacementOutcome => {
  const raw = firstRecord(output);

  if (!raw) {
    return {
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
  }

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
};

/** The work area of the primary display. */
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The primary display's work area, read. `null` when the helper had none. */
export const parseWorkArea = (output: string): WorkArea | null => {
  const raw = firstRecord(output);

  if (!raw || asNumber(raw.width) <= 0 || asNumber(raw.height) <= 0) {
    return null;
  }

  return {
    x: asNumber(raw.x),
    y: asNumber(raw.y),
    width: asNumber(raw.width),
    height: asNumber(raw.height),
  };
};

/** One display of the desktop, as the helper reports it (D-350). */
export interface DisplayInfo {
  /** the display's device name, e.g. "\\.\DISPLAY4" */
  device: string;
  /** what the adapter says about itself: its description, id and key */
  adapter: string;
  /** whether the adapter says it is a virtual one (an indirect display driver) */
  virtual: boolean;
  /** whether it is the primary display */
  primary: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The displays the helper listed. Nothing that is not a display is one. */
export const parseDisplays = (output: string): DisplayInfo[] => {
  const raw = firstRecord(output);
  const list = raw && Array.isArray(raw.displays) ? raw.displays : [];

  const displays: DisplayInfo[] = [];

  for (const item of list as Array<Record<string, unknown>>) {
    const width = asNumber(item?.width);
    const height = asNumber(item?.height);

    if (width <= 0 || height <= 0) {
      continue;
    }

    displays.push({
      device: typeof item.device === "string" ? item.device : "",
      adapter: typeof item.adapter === "string" ? item.adapter : "",
      virtual: item.virtual === true,
      primary: item.primary === true,
      x: asNumber(item.x),
      y: asNumber(item.y),
      width,
      height,
    });
  }

  return displays;
};

/** Whether the middle of a window is on a display (D-350, D-351). */
const isOnDisplay = (
  window: { x: number; y: number; width: number; height: number } | null,
  display: DisplayInfo,
): boolean => {
  if (!window) {
    return false;
  }

  const middleX = window.x + window.width / 2;
  const middleY = window.y + window.height / 2;

  return (
    middleX >= display.x &&
    middleX < display.x + display.width &&
    middleY >= display.y &&
    middleY < display.y + display.height
  );
};

/** What a park or a bring back did. */
export interface ParkResult {
  /** is the window where the teacher asked it to be? */
  ok: boolean;
  /** the sentence the teacher reads. Never empty. */
  reason: string;
  /** the window's handle, when one was found */
  handle: number;
}

/** Runs the helper and gives back its output. */
export type WindowRunner = (args: string[]) => Promise<string>;

/**
 * The helper, run for real.
 *
 * It is a PowerShell script that ships inside the extension, so there is
 * nothing to install and no dependency to add - the same reason the capture
 * helper is a PowerShell script.
 */
const defaultRunner: WindowRunner = (args) =>
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
          new Error(`the window helper could not be run: ${error.message}`),
        );
      });

      child.on("close", (code: number | null) => {
        if (code !== 0 && !stdout.trim()) {
          reject(
            new Error(
              `the window helper exited with code ${code ?? "unknown"}${
                stderr.trim() ? `: ${stderr.trim()}` : ""
              }`,
            ),
          );
          return;
        }

        resolve(stdout);
      });
    } catch (error) {
      reject(
        new Error(
          `the window helper could not be started: ${(error as Error).message}`,
        ),
      );
    }
  });

export interface WindowParkOptions {
  /** the helper's path */
  scriptPath: string;
  /** overridable for the tests */
  run?: WindowRunner;
}

/**
 * The rule that finds a window.
 *
 * The rule is a **title substring** and the process that owns the window. A
 * handle is never remembered (D-112, D-113).
 */
export interface WindowRule {
  /** the title substring that finds the window */
  titleLike: string;
  /** the process that owns the window */
  processName?: string;
  /** what the window is called in the sentence the teacher reads */
  subject: string;
}

export interface WindowPark {
  /** a window, found BY RULE */
  find: (rule: WindowRule) => Promise<FoundWindow | null>;
  /**
   * Put a window on a rectangle, without taking the focus.
   *
   * The answer is MEASURED: the window is read back after the move, and a move
   * that did not happen is never reported as one (D-150).
   */
  place: (
    handle: number,
    rect: { x: number; y: number; width: number; height: number },
    options?: { maximise?: boolean },
  ) => Promise<PlacementOutcome>;
  /** the primary display's work area */
  workArea: () => Promise<WorkArea | null>;
  /** every display of the desktop, and which of them are virtual (D-350) */
  displays: () => Promise<DisplayInfo[]>;
  /**
   * Whether the machine has a virtual display, and whether the window is on it
   * now (D-351). It moves nothing.
   */
  virtualState: (rule: WindowRule) => Promise<{
    available: boolean;
    on: boolean;
  }>;
  /**
   * Put the window on the **virtual display**, filling it, without taking the
   * focus (D-350). `moved` says whether the window was moved now - a window that
   * is there already is not moved again. The way back is the same as a parked
   * window's.
   */
  moveToVirtualDisplay: (
    rule: WindowRule,
  ) => Promise<ParkResult & { moved: boolean }>;
  /** park the window: far off every display, out of sight and still working */
  park: (rule: WindowRule) => Promise<ParkResult>;
  /** bring the window BACK, the way the teacher had it (D-149) */
  bringBack: (rule: WindowRule) => Promise<ParkResult>;
  /** is the window parked right now? Read from the window itself. */
  isParked: (rule: WindowRule) => Promise<boolean>;
}

/**
 * The parking service.
 *
 * Every answer is a **fact**: the window it found, what it did with it and
 * where the window ended up. Nothing here is silent.
 */
export const createWindowPark = (options: WindowParkOptions): WindowPark => {
  const run = options.run ?? defaultRunner;

  const helperArgs = (rest: string[]) => [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    options.scriptPath,
    ...rest,
  ];

  const find = async (rule: WindowRule): Promise<FoundWindow | null> =>
    parseWindow(
      await run(
        helperArgs([
          "-Mode",
          "Find",
          "-TitleLike",
          rule.titleLike,
          ...(rule.processName ? ["-ProcessName", rule.processName] : []),
        ]),
      ),
    );

  const place = async (
    handle: number,
    rect: { x: number; y: number; width: number; height: number },
    placeOptions: { maximise?: boolean } = {},
  ): Promise<PlacementOutcome> =>
    parsePlacement(
      await run(
        helperArgs([
          "-Mode",
          "Place",
          "-Handle",
          String(handle),
          "-X",
          String(rect.x),
          "-Y",
          String(rect.y),
          "-Width",
          String(rect.width),
          "-Height",
          String(rect.height),
          ...(placeOptions.maximise ? ["-Maximise"] : []),
        ]),
      ),
    );

  const workArea = async (): Promise<WorkArea | null> =>
    parseWorkArea(await run(helperArgs(["-Mode", "Primary"])));

  const displays = async (): Promise<DisplayInfo[]> =>
    parseDisplays(await run(helperArgs(["-Mode", "Displays"])));

  /**
   * What it remembers about a window it parked.
   *
   * Not the handle - never the handle (D-112, D-113) - but the FACTS the way
   * back needs: where the window was, how big it was and whether it was
   * maximised (D-149).
   */
  const parked = new Map<
    string,
    { x: number; y: number; width: number; height: number; maximised: boolean }
  >();

  const ruleKey = (rule: WindowRule): string =>
    `${rule.titleLike}|${rule.processName ?? ""}`;

  const park = async (rule: WindowRule): Promise<ParkResult> => {
    const window = await find(rule);

    if (!window?.found) {
      return {
        ok: false,
        reason: `no window was found to park - ${rule.subject} is not open`,
        handle: 0,
      };
    }

    if (isParkedPlace(window.x, window.y)) {
      return {
        ok: true,
        reason: `${rule.subject} is already parked`,
        handle: window.handle,
      };
    }

    const outcome = await place(window.handle, {
      x: PARK_X,
      y: PARK_Y,
      width: window.width,
      height: window.height,
    });

    if (!outcome.placed) {
      parked.delete(ruleKey(rule));

      return {
        ok: false,
        reason: `${rule.subject} was not parked - ${outcome.reason}`,
        handle: window.handle,
      };
    }

    // The facts the way back needs (D-149). The handle is NOT kept: the window
    // is found by its rule again.
    parked.set(ruleKey(rule), {
      x: window.x,
      y: window.y,
      width: window.width,
      height: window.height,
      maximised: outcome.wasMaximised,
    });

    return {
      ok: true,
      reason: `${rule.subject} was parked - it keeps working, out of sight`,
      handle: window.handle,
    };
  };

  const bringBack = async (rule: WindowRule): Promise<ParkResult> => {
    const window = await find(rule);

    if (!window?.found) {
      return {
        ok: false,
        reason: `no window was found to bring back - ${rule.subject} is not open`,
        handle: 0,
      };
    }

    const was = parked.get(ruleKey(rule));

    // A window on the virtual display with no facts kept - the extension was
    // restarted while it was there, or the editor started there because it
    // remembers where it was closed - is lost to the teacher, so it comes back
    // to the primary display as well (D-356).
    const onVirtual =
      !was &&
      !isParkedPlace(window.x, window.y) &&
      (await displays()).some(
        (display) => display.virtual && isOnDisplay(window, display),
      );

    if (!was && !onVirtual && !isParkedPlace(window.x, window.y)) {
      // nothing was parked, and the window is where a window is
      return {
        ok: true,
        reason: `${rule.subject} is already on a display`,
        handle: window.handle,
      };
    }

    let target = was;

    if (!target) {
      // With no facts - the extension was restarted while the window was
      // parked - the window comes back on the primary display (D-149).
      const area = await workArea();

      if (!area) {
        return {
          ok: false,
          reason: `${rule.subject} was not brought back - no display was found`,
          handle: window.handle,
        };
      }

      const width = Math.min(window.width, Math.round(area.width * 0.9));
      const height = Math.min(window.height, Math.round(area.height * 0.9));

      target = {
        x: area.x + Math.round((area.width - width) / 2),
        y: area.y + Math.round((area.height - height) / 2),
        width,
        height,
        maximised: false,
      };
    }

    const outcome = await place(window.handle, target, {
      maximise: target.maximised,
    });

    if (!outcome.placed) {
      return {
        ok: false,
        reason: `${rule.subject} was not brought back - ${outcome.reason}`,
        handle: window.handle,
      };
    }

    parked.delete(ruleKey(rule));

    return {
      ok: true,
      reason: `${rule.subject} is back${
        target.maximised ? ", maximised as it was" : ""
      }`,
      handle: window.handle,
    };
  };

  const moveToVirtualDisplay = async (
    rule: WindowRule,
  ): Promise<ParkResult & { moved: boolean }> => {
    const window = await find(rule);

    if (!window?.found) {
      return {
        ok: false,
        moved: false,
        reason: `no window was found to move - ${rule.subject} is not open`,
        handle: 0,
      };
    }

    const virtual = (await displays()).find((display) => display.virtual);

    if (!virtual) {
      return {
        ok: false,
        moved: false,
        reason: "there is no virtual display on this machine",
        handle: window.handle,
      };
    }

    if (isOnDisplay(window, virtual)) {
      return {
        ok: true,
        moved: false,
        reason: `${rule.subject} is on the virtual display`,
        handle: window.handle,
      };
    }

    const outcome = await place(window.handle, {
      x: virtual.x,
      y: virtual.y,
      width: virtual.width,
      height: virtual.height,
    });

    if (!outcome.placed) {
      return {
        ok: false,
        moved: false,
        reason: `${rule.subject} was not moved to the virtual display - ${outcome.reason}`,
        handle: window.handle,
      };
    }

    // the way back is the same as a parked window's (D-149): the facts, and
    // never the handle - and a window that was parked first keeps the place it
    // had before it was
    if (!parked.has(ruleKey(rule))) {
      parked.set(ruleKey(rule), {
        x: window.x,
        y: window.y,
        width: window.width,
        height: window.height,
        maximised: outcome.wasMaximised,
      });
    }

    return {
      ok: true,
      moved: true,
      reason: `${rule.subject} is on the virtual display`,
      handle: window.handle,
    };
  };

  const virtualState = async (
    rule: WindowRule,
  ): Promise<{ available: boolean; on: boolean }> => {
    const virtual = (await displays()).find((display) => display.virtual);

    if (!virtual) {
      return { available: false, on: false };
    }

    const window = await find(rule);

    return {
      available: true,
      on: Boolean(window?.found) && isOnDisplay(window, virtual),
    };
  };

  const isParked = async (rule: WindowRule): Promise<boolean> => {
    const window = await find(rule);

    return Boolean(window?.found && isParkedPlace(window.x, window.y));
  };

  return {
    find,
    place,
    workArea,
    displays,
    virtualState,
    moveToVirtualDisplay,
    park,
    bringBack,
    isParked,
  };
};
