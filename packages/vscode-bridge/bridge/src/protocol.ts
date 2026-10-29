import type { FileId, PanelCaptionCue } from "@excalidraw/element/types";

import { isOcrEngineName, isOcrLine, isOcrModel, isOcrRegion } from "./ocr";

import type { OcrEngineName, OcrLine, OcrModel, OcrRegion } from "./ocr";

/**
 * The bridge protocol - the ONE definition of the message types.
 *
 * Both sides import this module: the extension through a relative import
 * (`../../bridge/src/protocol`), the Excalidraw app through a path alias. There
 * is no second copy of these types anywhere in the repository.
 *
 * The rules this file encodes (D-50, D-67):
 *
 *  - the bridge listens on 127.0.0.1 only, on a FIXED port, and the port
 *    travels to the app as a build-time `VITE_APP_*` variable - never as a
 *    random free port and never as a port scan;
 *  - the per-session token is negotiated IN BAND, in the FIRST websocket frame
 *    (`bridge:auth`). It is never in a URL and never on a command line;
 *  - the server rejects a connection that does not present the token, and a
 *    connection whose origin is not localhost.
 */

/** The protocol version every message carries. */
export const BRIDGE_PROTOCOL_VERSION = 1;

/** The loopback host the bridge listens on. Never `0.0.0.0`. */
export const DEFAULT_BRIDGE_HOST = "127.0.0.1";

/**
 * The fixed port the bridge listens on when nothing overrides it.
 *
 * It is a constant and not a random free port, so the app knows where to
 * connect before the extension has ever run (D-67).
 */
export const DEFAULT_BRIDGE_PORT = 47511;

/**
 * The build-time variable that carries the bridge URL into the app - the same
 * shape as `VITE_APP_WS_SERVER_URL`, which is how the collaboration server is
 * found today.
 */
export const BRIDGE_URL_ENV_VAR = "VITE_APP_BRIDGE_URL";

/**
 * The websocket close code the extension answers a wrong token with.
 *
 * The page reads it: a token that was REFUSED is a different fact from an
 * extension that is not there, and retrying a refused token is pointless
 * (D-333).
 */
export const BRIDGE_CLOSE_UNAUTHORIZED = 1008;

/** The task type the extension contributes, so a run can be owned by the extension. */
export const BRIDGE_TASK_TYPE = "excalidraw-bridge.run";

/** Every message type in the protocol. Used by the round-trip test (AC-62). */
export const BRIDGE_MESSAGE_TYPES = [
  "bridge:auth",
  "bridge:hello",
  "editor:content",
  "editor:capture",
  "editor:mirror",
  "editor:control",
  "editor:input",
  "editor:window",
  "run:started",
  "run:output",
  "run:exit",
  "run:start",
  "run:stop",
  "code:run",
  "run:notice",
  "run:runtimes",
  "ocr:request",
  "ocr:result",
  "ocr:error",
  "ocr:state",
  "captions:request",
  "captions:result",
  "captions:none",
  "present:command",
  "ping",
  "pong",
] as const;

export type BridgeMessageType = typeof BRIDGE_MESSAGE_TYPES[number];

/**
 * What the hello says when the teacher has **no folder open** (D-122).
 *
 * The workspace's name was sent as the empty string when there was no folder,
 * and the panel then said *"Connected to Visual Studio Code ()"* - an empty pair
 * of brackets, which says nothing. So the name is **never blank**: the bridge
 * says this instead, and the teacher knows the difference between "no folder" and
 * "a folder called nothing".
 */
export const NO_WORKSPACE_NAME = "no folder open";

/**
 * The workspace's name for the hello: the name when there is one, and
 * {@link NO_WORKSPACE_NAME} when there is not (D-122).
 *
 * One place, so the bridge and the panel cannot disagree about what a blank
 * workspace means.
 */
export const workspaceName = (workspace: string | undefined | null): string => {
  const name = (workspace ?? "").trim();

  return name === "" ? NO_WORKSPACE_NAME : name;
};

/** The selection the teacher's editor has, as offsets into the text. */
export interface BridgeSelection {
  start: number;
  end: number;
}

/**
 * The part of the editor's window that is **mirrored** (D-143).
 *
 * What is mirrored is a **choice**, and a choice can be changed as often as the
 * teacher changes their mind - so the choice travels over the bridge, and the
 * teacher can make another one whenever they want.
 *
 * The region is measured in **fractions of the whole window**: 0 to 1 on each
 * axis. A region in fractions is the same region whatever size the window is,
 * so a window that is resized - or a window on another screen - does not move
 * the region out from under the teacher.
 *
 * **No region at all** means the **whole window**: that is the default, and it
 * is what a panel with no region set mirrors.
 */
export interface BridgeMirrorRegion {
  /** the region's left edge, as a fraction of the window's width */
  x: number;
  /** the region's top edge, as a fraction of the window's height */
  y: number;
  /** the region's width, as a fraction of the window's width */
  width: number;
  /** the region's height, as a fraction of the window's height */
  height: number;
}

/**
 * The region of the **whole** window: what is mirrored when the teacher has
 * chosen nothing (D-143).
 */
export const WHOLE_WINDOW: BridgeMirrorRegion = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

/**
 * Whether a value is a mirror region (D-143).
 *
 * The guard is the same one every other part of the protocol uses: the types
 * are erased at run time, and this function is what decides.
 */
export const isBridgeMirrorRegion = (
  value: unknown,
): value is BridgeMirrorRegion =>
  isRecord(value) &&
  typeof value.x === "number" &&
  typeof value.y === "number" &&
  typeof value.width === "number" &&
  typeof value.height === "number";

/**
 * The region as it will be used: inside the window, and with an area.
 *
 * A region that reaches outside the window, or that has no area, is not a
 * region - so it is clamped, and a region with no area becomes **no region**:
 * the whole window, which is the default (D-143).
 */
export const normalizeBridgeMirrorRegion = (
  value: unknown,
): BridgeMirrorRegion | null => {
  if (!isBridgeMirrorRegion(value)) {
    return null;
  }

  const width = Math.min(Math.max(value.width, 0), 1);
  const height = Math.min(Math.max(value.height, 0), 1);

  if (width <= 0 || height <= 0) {
    return null;
  }

  const x = Math.min(Math.max(value.x, 0), 1 - width);
  const y = Math.min(Math.max(value.y, 0), 1 - height);

  return { x, y, width, height };
};

/**
 * Are two regions the same region?
 *
 * The region is compared by its four numbers, so a region that is set again
 * with the same numbers is not a change - and the teacher who picks the same
 * crop twice does not make the panel redraw for nothing (D-143).
 */
export const isSameBridgeMirrorRegion = (
  a: BridgeMirrorRegion | null | undefined,
  b: BridgeMirrorRegion | null | undefined,
): boolean => {
  if (!a || !b) {
    return !a && !b;
  }

  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
};

/**
 * The **control** of the mirrored window (D-323, D-327).
 *
 * The canvas can send the mouse and the keyboard into the editor's window, and
 * the events that travel are a **closed list**: a pointer event, a wheel
 * event, a key event and a text event. Every number is bounded, every key is
 * a name from a table (never a raw code), and a text is short and has no
 * control characters - so what arrives is never more than what a keyboard and
 * a mouse can do in that one window.
 */

/** The modifiers of an input event, as a mask. The Windows key is never one. */
export const INPUT_MOD_CTRL = 1;
export const INPUT_MOD_SHIFT = 2;
export const INPUT_MOD_ALT = 4;
/** Every bit a mask may carry. */
export const INPUT_MOD_MASK = INPUT_MOD_CTRL | INPUT_MOD_SHIFT | INPUT_MOD_ALT;

/** The most a text event may carry, in UTF-16 units (D-327). */
export const INPUT_TEXT_MAX = 256;

/** The most a wheel event may turn, in notches, either way (D-327). */
export const INPUT_WHEEL_MAX = 20;

/** The pointer buttons an event may name. */
export type BridgeInputButton = "left" | "middle" | "right";

/** The keys an event may name: `KeyboardEvent.code`'s own names (D-327). */
export const BRIDGE_KEY_CODES: readonly string[] = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `Key${letter}`),
  ...Array.from({ length: 10 }, (_, digit) => `Digit${digit}`),
  ...Array.from({ length: 10 }, (_, digit) => `Numpad${digit}`),
  ...Array.from({ length: 12 }, (_, key) => `F${key + 1}`),
  "Enter",
  "NumpadEnter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Semicolon",
  "Quote",
  "Backquote",
  "Comma",
  "Period",
  "Slash",
  "NumpadAdd",
  "NumpadSubtract",
  "NumpadMultiply",
  "NumpadDivide",
  "NumpadDecimal",
];

/** What the teacher's canvas sends into the editor's window (D-323). */
export type BridgeInputEvent =
  | {
      kind: "pointer";
      /**
       * A double click is two presses: the extension recognises it the way
       * Windows does (same button, near, quick), so there is no event for it.
       */
      action: "move" | "down" | "up";
      /** a place in the WHOLE window, as a fraction of it (D-324) */
      x: number;
      y: number;
      button?: BridgeInputButton;
      mods: number;
    }
  | {
      kind: "wheel";
      x: number;
      y: number;
      /** notches: positive is down and to the right, like the browser's */
      dx: number;
      dy: number;
      mods: number;
    }
  | {
      kind: "key";
      action: "down" | "up";
      /** a name from {@link BRIDGE_KEY_CODES} */
      code: string;
      /** the character the key types, when it types one */
      char?: string;
      mods: number;
    }
  | { kind: "text"; text: string };

/** Whether a value is a fraction of the window: 0 to 1. */
const isFraction = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

/** Whether a value is a modifier mask. */
const isModMask = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 0 &&
  (value & ~INPUT_MOD_MASK) === 0;

/** Whether a value is a number of notches the wheel may turn. */
const isNotches = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= INPUT_WHEEL_MAX;

/** Whether a text is short and made of characters a person types (D-327). */
export const isInputText = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= INPUT_TEXT_MAX &&
  // a line feed and a tab are typed (as Enter and Tab); nothing else below a
  // space is, and neither is DEL
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

/**
 * Whether a value is an input event the control accepts (D-327).
 *
 * The list is closed: a kind that is not here, a number out of its range, a
 * key that is not in the table and a text that is too long are all refused.
 */
export const isBridgeInputEvent = (
  value: unknown,
): value is BridgeInputEvent => {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.kind) {
    case "pointer":
      return (
        (value.action === "move" ||
          value.action === "down" ||
          value.action === "up") &&
        isFraction(value.x) &&
        isFraction(value.y) &&
        (value.button === undefined ||
          value.button === "left" ||
          value.button === "middle" ||
          value.button === "right") &&
        isModMask(value.mods)
      );
    case "wheel":
      return (
        isFraction(value.x) &&
        isFraction(value.y) &&
        isNotches(value.dx) &&
        isNotches(value.dy) &&
        isModMask(value.mods)
      );
    case "key":
      return (
        (value.action === "down" || value.action === "up") &&
        typeof value.code === "string" &&
        BRIDGE_KEY_CODES.includes(value.code) &&
        (value.char === undefined ||
          (typeof value.char === "string" &&
            // one printed character (a surrogate pair is one) and no control
            [...value.char].length === 1 &&
            isInputText(value.char))) &&
        isModMask(value.mods)
      );
    case "text":
      return isInputText(value.text);
    default:
      return false;
  }
};

/**
 * How the control gets its input into the editor's window (D-325, D-326).
 *
 * `background` posts messages to the window's own page and never takes the
 * focus; `focus` brings the window to the front for a burst and uses real
 * input; `none` is said when there is nothing to send to.
 */
export type BridgeControlRoute = "background" | "focus" | "none";

/** What the capture's descriptor says about the control (D-323, D-326). */
export interface BridgeControlState {
  /** is Control on? */
  enabled: boolean;
  /** the way the input goes in */
  route: BridgeControlRoute;
  /** one sentence: why this route, or why there is none. Never empty. */
  reason: string;
}

/** Whether a value is the control's state. */
export const isBridgeControlState = (
  value: unknown,
): value is BridgeControlState =>
  isRecord(value) &&
  typeof value.enabled === "boolean" &&
  (value.route === "background" ||
    value.route === "focus" ||
    value.route === "none") &&
  typeof value.reason === "string" &&
  value.reason.length > 0;

/** What the panel asks of the editor's window itself (D-328). */
export type BridgeWindowAction = "park" | "bring-back";

/** Every action on the window the panel may ask for. The list is closed. */
export const BRIDGE_WINDOW_ACTIONS: readonly BridgeWindowAction[] = [
  "park",
  "bring-back",
];

/** Whether a value is one of the window's actions. */
export const isBridgeWindowAction = (
  value: unknown,
): value is BridgeWindowAction =>
  typeof value === "string" &&
  (BRIDGE_WINDOW_ACTIONS as readonly string[]).includes(value);

/**
 * The presenter's **controls**, as they travel over the bridge (D-145).
 *
 * They are the same controls the presenter's own window carries - previous
 * page, next page, zoom in, zoom out, present, stop - and they are the ONLY
 * thing the input panel may ask for: the panel is a page on the teacher's own
 * screen, and it must not become a way to run anything on their machine that
 * the bridge does not already allow.
 *
 * The list is closed on purpose. A command that is not on it is refused, and
 * the panel is told so.
 */
export type PresenterCommand =
  | "previous-page"
  | "next-page"
  | "zoom-in"
  | "zoom-out"
  | "present"
  | "stop";

/** Every command the input panel may send, in the order the panel shows them. */
export const PRESENTER_COMMANDS: readonly PresenterCommand[] = [
  "previous-page",
  "next-page",
  "zoom-in",
  "zoom-out",
  "present",
  "stop",
];

/** Whether a value is one of the presenter's commands (D-145). */
export const isPresenterCommand = (value: unknown): value is PresenterCommand =>
  typeof value === "string" &&
  (PRESENTER_COMMANDS as readonly string[]).includes(value);

/**
 * The **caption tier** that answered (D-129).
 *
 * The captions are the fragile half of the YouTube path, so they degrade in
 * tiers and the panel says which tier it is:
 *
 *  - `"api"` - the official **Data API v3**, with the teacher's own key. A
 *    versioned API, and for the teacher's own channel the captions are
 *    authorised by the owner, so this tier really works;
 *  - `"public"` - the public **`timedtext`** endpoint. Best effort, and often
 *    empty for auto-generated captions;
 *  - `"none"` - there are no captions, and the answer says why.
 *
 * The tier travels **with the answer**, so the teacher is never left guessing
 * why a video has no text.
 */
export type CaptionTier = "api" | "public" | "none";

/**
 * A caption track as it travels over the bridge.
 *
 * The shape is the one the **local** path already produces, and it does not
 * change: the panel does not know where the cues came from, it only knows the
 * cues.
 */
export type BridgeCaptionTrack = {
  /** the track's language, e.g. "en" */
  language: string;
  /** the track's label, e.g. "English (auto-generated)" */
  label: string;
  /** the cues of the track */
  cues: PanelCaptionCue[];
};

/**
 * A message on the wire.
 *
 * Direction is a convention, not a type-level distinction: the panel sends the
 * `run:*`/`ocr:*` commands, the extension sends the content and the output.
 */
export type BridgeMessage =
  /** panel -> extension. The FIRST frame of every connection. */
  | { v: 1; type: "bridge:auth"; token: string }
  /** extension -> panel. Sent once, right after a successful auth. */
  | {
      v: 1;
      type: "bridge:hello";
      version: string;
      workspace: string;
      /**
       * Which editor this is: "Visual Studio Code", "VSCodium", ...
       *
       * The port is **fixed** (D-67), so with two editors running only one of
       * them holds it - and the app reaches that one, not necessarily the one
       * the teacher has their file open in. The name is what makes the
       * mismatch visible (D-76).
       *
       * Optional, so an extension that predates the field still connects; it
       * simply does not say which editor it is.
       */
      appName?: string;
      /**
       * The **MJPEG stream's** URL - the live view of the editor's own window
       * (D-85).
       *
       * The picture itself never travels over the websocket: the extension
       * serves it from the HTTP server it already has, and the panel plays it
       * in a plain `<img>`. So the app does no per-frame work at all.
       *
       * The URL carries the **connection's capability** in its path, and the
       * session TOKEN is never in a URL (D-50, D-86). The capability is
       * single-purpose and per connection: it dies with the connection.
       *
       * Optional, so an extension that predates the field still connects; the
       * panel then falls back to the mirrored text and says why.
       */
      streamUrl?: string;
    }
  /** extension -> panel. The active editor's text. */
  | {
      v: 1;
      type: "editor:content";
      uri: string;
      language: string;
      text: string;
      selection?: BridgeSelection;
      version: number;
    }
  /**
   * extension -> panel. The state of the capture of the editor's own window
   * (D-82, D-85).
   *
   * **The picture is NOT in this message.** The frames are served as an MJPEG
   * stream from the extension's own HTTP server, and the panel plays that
   * stream in a plain `<img>` - so a frame never travels over the websocket
   * and never reaches the app's data at all.
   *
   * What travels is the **state**: "live" (the capture is running) or
   * "unavailable" (it cannot run, and this is why). The state is a message,
   * not a silence: the panel has to be able to say why there is no live view
   * (D-75).
   *
   * The state is published when it **changes**, not per frame: the panel
   * re-renders when the state changes, and the app does no per-frame work.
   */
  | {
      v: 1;
      type: "editor:capture";
      /**
       * "live" - the capture is running. "unavailable" - the capture cannot
       * run.
       */
      state: "live" | "unavailable";
      /**
       * Why the capture is not running. Never empty when the state is
       * "unavailable", and never set when it is "live".
       */
      reason?: string;
      /** the frame's number when the state was published: 1, 2, 3 ... */
      seq: number;
      /**
       * The part of the editor's window that is **mirrored** (D-143).
       *
       * It is absent when the **whole** window is mirrored, which is the
       * default: a panel with no region set mirrors the whole window.
       */
      region?: BridgeMirrorRegion;
      /**
       * Whether the mirrored region **follows the pointer** inside the panel
       * (D-143).
       *
       * It is a mode, and it is off unless the teacher turns it on.
       */
      follow?: boolean;
      /**
       * The picture's own size, in its own pixels.
       *
       * The crop is measured in fractions of the picture, so the picture's own
       * size is what turns a fraction into the shape the teacher sees.
       */
      width?: number;
      height?: number;
      /**
       * The **control** of the window: whether it is on, the route its input
       * takes and why (D-323, D-326). Absent from an extension that predates
       * the control, and the panel then offers none.
       */
      control?: BridgeControlState;
      /**
       * Whether the editor's window is **parked** off every display (D-328).
       * Absent means it is not.
       */
      parked?: boolean;
    }
  /**
   * panel -> extension. Control on or off (D-323).
   *
   * Control is **off** until a panel says otherwise, and it is off again when
   * the connection ends (D-327).
   */
  | { v: 1; type: "editor:control"; enabled: boolean }
  /**
   * panel -> extension. One input event for the editor's window (D-323).
   *
   * It is accepted only while Control is on, and only when it is one of the
   * closed list of events (D-327).
   */
  | { v: 1; type: "editor:input"; event: BridgeInputEvent }
  /**
   * panel -> extension. Park the editor's window off every display, or bring
   * it back (D-328). The list is closed.
   */
  | { v: 1; type: "editor:window"; action: BridgeWindowAction }
  /**
   * panel -> extension. What is mirrored, and whether it follows the pointer
   * (D-143).
   *
   * What is mirrored is a **choice**, and a choice can be changed as often as
   * the teacher changes their mind - so this message can be sent as often as
   * the teacher likes, and the last one wins.
   */
  | {
      v: 1;
      type: "editor:mirror";
      /**
       * The region of the editor's window to mirror, in fractions of the whole
       * window. **Absent** means the whole window - the default (D-143).
       */
      region?: BridgeMirrorRegion;
      /**
       * Whether the region follows the pointer inside the panel.
       *
       * It is a **mode**, and it is **off** unless the teacher turns it on.
       */
      follow: boolean;
    }
  /** extension -> panel. The program started. */
  | { v: 1; type: "run:started"; runId: string; command: string; cwd: string }
  /** extension -> panel. One line of the program's output. */
  | {
      v: 1;
      type: "run:output";
      runId: string;
      stream: "stdout" | "stderr";
      text: string;
    }
  /** extension -> panel. The program ended. `code` is null when it was killed. */
  | { v: 1; type: "run:exit"; runId: string; code: number | null }
  /** panel -> extension. Run the program. */
  | { v: 1; type: "run:start"; command: string; args: string[]; cwd?: string }
  /** panel -> extension. Stop the run. */
  | { v: 1; type: "run:stop"; runId: string }
  /**
   * panel -> extension. Run the **draft** (D-124).
   *
   * The panel's Run control sends the teacher's own text and the language it
   * is in; the extension writes it to a temporary file in the teacher's
   * workspace, runs it with that language's runtime, and returns the output.
   */
  | {
      v: 1;
      type: "code:run";
      /**
       * The request's id.
       *
       * It is the **run's** id when the run happens, so every message about
       * that run carries it - and when the run does NOT happen (there is no
       * runtime for the language), the notice carries it too, and the panel
       * never claims a run happened (D-124).
       */
      id: string;
      /** the language, as the grammar registry names it */
      language: string;
      /** the teacher's own text */
      text: string;
    }
  /**
   * extension -> panel. A **fact** about a run (D-124).
   *
   * The facts are the ones the teacher must not be left guessing about: the
   * run was killed at the timeout, the output was longer than the bound, or
   * the language's runtime is not on this machine.
   */
  | {
      v: 1;
      type: "run:notice";
      runId: string;
      /**
       * - "timed-out" - the program ran and was killed at the timeout
       * - "truncated" - the output was longer than the bound
       * - "missing-runtime" - the language's runtime is not on this machine,
       *   and **nothing ran**
       */
      kind: "timed-out" | "truncated" | "missing-runtime";
      /** the sentence the panel shows. Never empty. */
      text: string;
    }
  /**
   * extension -> panel. The runtimes that are **actually** on this machine
   * (D-124).
   *
   * The panel's language picker offers only these, so it never offers a
   * language that cannot run here.
   */
  | {
      v: 1;
      type: "run:runtimes";
      /** the language ids that can be run here */
      languages: string[];
    }
  /** panel -> extension. Read the text out of an image. */
  | {
      v: 1;
      type: "ocr:request";
      id: string;
      /** the file the image came from, when it came from one */
      fileId?: FileId;
      imageBase64: string;
      /**
       * The region of interest, in the image's **own pixels**.
       *
       * The crop is the one OCR lever that costs nothing and buys the most, so
       * it travels with the request (D-55, D-59).
       */
      region?: OcrRegion;
      language?: string;
      /**
       * The engine the caller wants (D-90).
       *
       * It is **optional**: when it is absent the extension falls back to its
       * own setting, and an extension that predates the field still reads.
       */
      engine?: OcrEngineName;
    }
  /** extension -> panel. The text that was read out of an image. */
  | {
      v: 1;
      type: "ocr:result";
      id: string;
      /** the file the image came from, when it came from one */
      fileId?: FileId;
      text: string;
      /** the per-line boxes, so the text can be placed as individual elements */
      lines?: OcrLine[];
      confidence?: number;
      /** which engine actually read it (D-90) */
      engine?: OcrEngineName;
      /** how long the read took, in milliseconds (D-90) */
      durationMs?: number;
      /**
       * How the engine's model was built (D-106).
       *
       * It says whether the engine ran **without** oneDNN, so the panel can
       * tell the teacher why a read was slow (D-91).
       */
      model?: OcrModel;
    }
  /**
   * extension -> panel. The state of the OCR engine (D-90, D-91).
   *
   * It is a **state**, not a silence: the panel has to be able to say which
   * engine is in use, and - when the engine is not there - **why** it is not
   * there and what to install (D-75, D-91).
   *
   * A ready state carries the engine's name; an unavailable one carries the
   * reason and nothing else.
   */
  | {
      v: 1;
      type: "ocr:state";
      state: "ready" | "unavailable";
      /** the engine that is in use */
      engine?: OcrEngineName;
      /**
       * Why the engine is not there. Never empty when the state is
       * "unavailable", and never set when the state is "ready".
       */
      reason?: string;
    }
  /**
   * extension -> panel. The read **failed**.
   *
   * A failure is a message, not a silence: the app has to be able to say why
   * the text did not arrive (D-59).
   */
  | {
      v: 1;
      type: "ocr:error";
      id: string;
      message: string;
    }
  /**
   * panel -> extension. Fetch the captions of a YouTube video (D-129).
   *
   * A browser cannot read YouTube's captions: they are not in the page. So the
   * **bridge** - the Node process the teacher's VS Code extension runs - asks
   * for them, and the app receives them as ordinary caption track data.
   */
  | {
      v: 1;
      type: "captions:request";
      /** the id of this request, so the answer can be matched to it */
      id: string;
      /** the YouTube video id */
      videoId: string;
    }
  /**
   * extension -> panel. The captions of the video (D-129).
   *
   * The **cues** are the same shape the local path produces - the panel does
   * not know where they came from - and the **tier** travels with them, so the
   * panel can say which tier answered.
   */
  | {
      v: 1;
      type: "captions:result";
      /** the id of the request this answers */
      id: string;
      /** the YouTube video id */
      videoId: string;
      /** every track the video has - there is often more than one */
      tracks: BridgeCaptionTrack[];
      /**
       * Which tier answered (D-129).
       *
       * It is **optional**: an extension that predates the field still reads,
       * and the panel then says that the tier is unknown rather than guessing.
       */
      tier?: CaptionTier;
    }
  /**
   * extension -> panel. The video has no captions (D-129).
   *
   * The **reason** is never empty: the teacher's own key is not set, the
   * public endpoint gave nothing back, or the video simply has no captions -
   * and the teacher is told which.
   */
  | {
      v: 1;
      type: "captions:none";
      /** the id of the request this answers */
      id: string;
      /** the YouTube video id */
      videoId: string;
      /** why there are none - the video has none, or they could not be read */
      reason: string;
      /**
       * Which tier answered (D-129): the third one, "none".
       *
       * It is **optional**, for the same reason as on `captions:result`.
       */
      tier?: CaptionTier;
    }
  /**
   * panel -> extension. The presenter's **controls** (D-145).
   *
   * The input panel is a small page the extension serves on its own loopback
   * HTTP server, and the teacher opens it on their **real** screen: the screen
   * the students see and the controls the teacher uses are different surfaces.
   *
   * The command travels over the **bridge** - there is one way to drive a
   * presentation - and it is one of a closed list of the presenter's own
   * controls, so the panel can never ask for anything else.
   */
  | { v: 1; type: "present:command"; command: PresenterCommand }
  /** panel -> extension. */
  | { v: 1; type: "ping" }
  /** extension -> panel. */
  | { v: 1; type: "pong" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isSelection = (value: unknown): value is BridgeSelection =>
  isRecord(value) &&
  typeof value.start === "number" &&
  typeof value.end === "number";

/** Whether a value is one of the caption tiers (D-129). */
export const isCaptionTier = (value: unknown): value is CaptionTier =>
  value === "api" || value === "public" || value === "none";

const isCaptionCue = (value: unknown): value is PanelCaptionCue =>
  isRecord(value) &&
  typeof value.startMs === "number" &&
  typeof value.endMs === "number" &&
  typeof value.text === "string";

const isCaptionTrack = (value: unknown): value is BridgeCaptionTrack =>
  isRecord(value) &&
  typeof value.language === "string" &&
  typeof value.label === "string" &&
  Array.isArray(value.cues) &&
  value.cues.every(isCaptionCue);

/**
 * The runtime guard for the protocol.
 *
 * The types above are erased at run time; this function is what actually
 * decides whether a frame is a legal message. Every frame that enters the
 * server or the client goes through it, so a malformed frame can never be
 * mistaken for a command.
 */
export function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (!isRecord(value)) {
    return false;
  }
  if (value.v !== BRIDGE_PROTOCOL_VERSION) {
    return false;
  }
  const type = value.type;
  if (typeof type !== "string") {
    return false;
  }
  switch (type) {
    case "bridge:auth":
      return typeof value.token === "string";
    case "bridge:hello":
      return (
        typeof value.version === "string" &&
        typeof value.workspace === "string" &&
        (value.appName === undefined || typeof value.appName === "string") &&
        // the stream's URL is optional: an extension that predates it still
        // connects, and the panel falls back to the mirrored text (D-85)
        (value.streamUrl === undefined || typeof value.streamUrl === "string")
      );
    case "editor:content":
      return (
        typeof value.uri === "string" &&
        typeof value.language === "string" &&
        typeof value.text === "string" &&
        typeof value.version === "number" &&
        (value.selection === undefined || isSelection(value.selection))
      );
    case "editor:capture":
      return (
        (value.state === "live" || value.state === "unavailable") &&
        typeof value.seq === "number" &&
        // a live capture carries no reason; an unavailable one carries the
        // reason and nothing else - the panel has to be able to SAY it (D-75)
        (value.state === "live"
          ? value.reason === undefined
          : typeof value.reason === "string" && value.reason.length > 0) &&
        // the region is the teacher's own choice, and it is optional: no
        // region means the whole window (D-143)
        (value.region === undefined || isBridgeMirrorRegion(value.region)) &&
        (value.follow === undefined || typeof value.follow === "boolean") &&
        (value.width === undefined || typeof value.width === "number") &&
        (value.height === undefined || typeof value.height === "number") &&
        // the control and the parking are optional: an extension that
        // predates them still connects (D-323, D-328)
        (value.control === undefined || isBridgeControlState(value.control)) &&
        (value.parked === undefined || typeof value.parked === "boolean")
      );
    case "editor:control":
      return typeof value.enabled === "boolean";
    case "editor:input":
      return isBridgeInputEvent(value.event);
    case "editor:window":
      return isBridgeWindowAction(value.action);
    case "editor:mirror":
      return (
        // the region is optional: no region means the whole window (D-143)
        (value.region === undefined || isBridgeMirrorRegion(value.region)) &&
        // the follow mode is a flag, and it is always said: "off" is said as
        // "off", so a mode can never be left in an unknown state (D-143)
        typeof value.follow === "boolean"
      );
    case "run:started":
      return (
        typeof value.runId === "string" &&
        typeof value.command === "string" &&
        typeof value.cwd === "string"
      );
    case "run:output":
      return (
        typeof value.runId === "string" &&
        (value.stream === "stdout" || value.stream === "stderr") &&
        typeof value.text === "string"
      );
    case "run:exit":
      return (
        typeof value.runId === "string" &&
        (value.code === null || typeof value.code === "number")
      );
    case "run:start":
      return (
        typeof value.command === "string" &&
        isStringArray(value.args) &&
        (value.cwd === undefined || typeof value.cwd === "string")
      );
    case "run:stop":
      return typeof value.runId === "string";
    case "code:run":
      return (
        typeof value.id === "string" &&
        typeof value.language === "string" &&
        typeof value.text === "string"
      );
    case "run:notice":
      return (
        typeof value.runId === "string" &&
        (value.kind === "timed-out" ||
          value.kind === "truncated" ||
          value.kind === "missing-runtime") &&
        // the sentence the panel shows is never empty: an empty notice is a
        // bug, and the rule is to say what is missing (D-122)
        typeof value.text === "string" &&
        value.text.length > 0
      );
    case "run:runtimes":
      return Array.isArray(value.languages) && isStringArray(value.languages);
    case "ocr:request":
      return (
        typeof value.id === "string" &&
        (value.fileId === undefined || typeof value.fileId === "string") &&
        typeof value.imageBase64 === "string" &&
        (value.region === undefined || isOcrRegion(value.region)) &&
        (value.language === undefined || typeof value.language === "string") &&
        // the engine is optional: an extension that predates it still reads
        (value.engine === undefined || isOcrEngineName(value.engine))
      );
    case "ocr:result":
      return (
        typeof value.id === "string" &&
        (value.fileId === undefined || typeof value.fileId === "string") &&
        typeof value.text === "string" &&
        (value.lines === undefined ||
          (Array.isArray(value.lines) && value.lines.every(isOcrLine))) &&
        (value.confidence === undefined ||
          typeof value.confidence === "number") &&
        // the engine and the time are optional (D-90)
        (value.engine === undefined || isOcrEngineName(value.engine)) &&
        (value.durationMs === undefined ||
          typeof value.durationMs === "number") &&
        // how the model was built is optional (D-106)
        (value.model === undefined || isOcrModel(value.model))
      );
    case "ocr:state":
      return (
        (value.state === "ready" || value.state === "unavailable") &&
        (value.engine === undefined || isOcrEngineName(value.engine)) &&
        // a ready state carries no reason; an unavailable one carries the
        // reason and nothing else - the panel has to be able to SAY it (D-91)
        (value.state === "ready"
          ? value.reason === undefined
          : typeof value.reason === "string" && value.reason.length > 0)
      );
    case "ocr:error":
      return typeof value.id === "string" && typeof value.message === "string";
    case "captions:request":
      return typeof value.id === "string" && typeof value.videoId === "string";
    case "captions:result":
      return (
        typeof value.id === "string" &&
        typeof value.videoId === "string" &&
        Array.isArray(value.tracks) &&
        value.tracks.every(isCaptionTrack) &&
        // the tier is optional (D-129): an extension that predates it still reads
        (value.tier === undefined || isCaptionTier(value.tier))
      );
    case "captions:none":
      return (
        typeof value.id === "string" &&
        typeof value.videoId === "string" &&
        // the reason is never empty: the teacher is told why (D-129)
        typeof value.reason === "string" &&
        value.reason.length > 0 &&
        (value.tier === undefined || isCaptionTier(value.tier))
      );
    case "present:command":
      // the command is one of the presenter's own controls, and nothing else
      return isPresenterCommand(value.command);
    case "ping":
    case "pong":
      return true;
    default:
      return false;
  }
}

/** Parse a raw frame into a message, or `null` when it is not one. */
export function parseBridgeMessage(raw: string): BridgeMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isBridgeMessage(parsed) ? parsed : null;
}

/** Serialise a message for the wire. */
export function encodeBridgeMessage(message: BridgeMessage): string {
  return JSON.stringify(message);
}

/** The URL the app connects to. The token is NOT part of it. */
export function bridgeUrl(
  port: number = DEFAULT_BRIDGE_PORT,
  host: string = DEFAULT_BRIDGE_HOST,
): string {
  return `ws://${host}:${port}/`;
}
