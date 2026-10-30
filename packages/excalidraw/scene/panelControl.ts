/**
 * The canvas's **control** of the mirrored editor window (D-323 to D-327).
 *
 * A panel that shows the editor's live window can send the mouse and the
 * keyboard into it. The library draws the switch and turns what the teacher
 * does over the view into **events**; the host sends them over the bridge, and
 * the extension delivers them. The events are a closed list, and every number
 * is bounded - the extension checks them again, and this module keeps to the
 * same limits so that nothing it makes is ever refused.
 *
 * The library does not import the bridge's protocol (it has no business with
 * the bridge), so the shapes here are the protocol's own, spelled out: the
 * host's types accept them as they are, and a test in the app compares the key
 * table with the protocol's.
 */

/** The modifiers of an event, as a mask. The Windows key is never one. */
export const PANEL_MOD_CTRL = 1;
export const PANEL_MOD_SHIFT = 2;
export const PANEL_MOD_ALT = 4;

/** The most a text event may carry, in UTF-16 units. */
export const PANEL_TEXT_MAX = 256;

/** The most a wheel event may turn, in notches, either way. */
export const PANEL_WHEEL_MAX = 20;

/**
 * How often a pointer move is sent, at the most (D-327).
 *
 * The pointer moves faster than anything needs to hear of it: thirty places a
 * second is smooth to the eye and a twentieth of what the extension allows.
 */
export const PANEL_MOVE_INTERVAL_MS = 30;

/** What the panel sends into the editor's window. */
export type PanelInputEvent =
  | {
      kind: "pointer";
      action: "move" | "down" | "up";
      /** a place in the WHOLE window, as a fraction of it (D-324) */
      x: number;
      y: number;
      button?: "left" | "middle" | "right";
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
      /** a name from {@link PANEL_KEY_CODES} */
      code: string;
      /** the character the key types, when it types one */
      char?: string;
      mods: number;
    }
  | { kind: "text"; text: string };

/** What the extension says about the control (D-323, D-326). */
export interface PanelControlState {
  /** is Control on? */
  enabled: boolean;
  /** the way the input goes in */
  route: "background" | "focus" | "none";
  /** one sentence: why this route, or why there is none */
  reason: string;
}

/** What the panel asks of the editor's window itself (D-328, D-351). */
export type PanelWindowAction = "park" | "bring-back" | "virtual";

/**
 * What the host tells the library about the **control** (D-323).
 *
 * The library draws the switch and turns the teacher's mouse and keys into
 * events; the host is the side that talks to the bridge. Without this prop
 * there is no control: the panel only shows the editor's window.
 */
export type PanelControlControls = {
  /** the teacher turned Control on or off */
  onToggle?: (panelId: string, enabled: boolean) => void;
  /** one event for the editor's window */
  onInput?: (panelId: string, event: PanelInputEvent) => void;
  /** the teacher asked to park the editor's window, or bring it back */
  onWindow?: (panelId: string, action: PanelWindowAction) => void;
};

/**
 * The keys that may be sent: `KeyboardEvent.code`'s own names (D-327).
 *
 * A key that is not here is not sent as a key. The protocol has the same list.
 */
export const PANEL_KEY_CODES: readonly string[] = [
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

/** The part of a keyboard event this module reads. */
export interface PanelKeyboardLike {
  code: string;
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  getModifierState?: (key: string) => boolean;
}

/**
 * The chord that gives the keyboard back to the canvas (D-323).
 *
 * The keys are all forwarded while the view has the keyboard, so there has to
 * be one that is not: it is never sent, and it always works.
 */
export const CONTROL_RELEASE_CHORD = "Ctrl+Alt+Home";

/** Is this key the chord that gives the keyboard back? */
export const isReleaseChord = (event: PanelKeyboardLike): boolean =>
  event.code === "Home" &&
  event.ctrlKey &&
  event.altKey &&
  !event.shiftKey &&
  !event.metaKey;

/**
 * The modifiers of a key, as a mask.
 *
 * AltGr is Ctrl+Alt to Windows and a way to type a character to a person, so a
 * key held with AltGr carries no modifier: it types what it types.
 */
export const keyboardModifiers = (event: PanelKeyboardLike): number => {
  if (event.getModifierState?.("AltGraph")) {
    return event.shiftKey ? PANEL_MOD_SHIFT : 0;
  }

  return (
    (event.ctrlKey ? PANEL_MOD_CTRL : 0) |
    (event.shiftKey ? PANEL_MOD_SHIFT : 0) |
    (event.altKey ? PANEL_MOD_ALT : 0)
  );
};

/**
 * Is this a chord the **machine keeps for itself** (D-327)?
 *
 * Alt+F4 would close the editor, Alt+Tab, Alt+Esc and Ctrl+Esc move the
 * teacher around their own desktop, and Ctrl+Alt+Delete is not a window's key.
 * The panel does not send them, and the extension does not accept them.
 */
export const isMachineChord = (event: PanelKeyboardLike): boolean => {
  const alt = event.altKey;
  const ctrl = event.ctrlKey;

  return (
    (alt &&
      (event.code === "F4" ||
        event.code === "Tab" ||
        event.code === "Escape")) ||
    (ctrl && event.code === "Escape") ||
    (ctrl && alt && event.code === "Delete")
  );
};

/** Is this text made of characters a person types? */
const isTypable = (text: string): boolean =>
  text.length > 0 &&
  text.length <= PANEL_TEXT_MAX &&
  // eslint-disable-next-line no-control-regex
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);

/**
 * A key as an event, or `null` when it is not one to send (D-327).
 *
 * Not sent: a key held with the Windows key, a key that is not in the table,
 * and the release chord. A key that types a character carries it, unless it is
 * held with Ctrl or Alt - then it is a shortcut and types nothing.
 */
export const panelKeyEvent = (
  event: PanelKeyboardLike,
  action: "down" | "up",
): PanelInputEvent | null => {
  if (event.metaKey || isReleaseChord(event) || isMachineChord(event)) {
    return null;
  }

  if (!PANEL_KEY_CODES.includes(event.code)) {
    return null;
  }

  const mods = keyboardModifiers(event);
  const typed =
    [...event.key].length === 1 &&
    isTypable(event.key) &&
    (mods & (PANEL_MOD_CTRL | PANEL_MOD_ALT)) === 0
      ? event.key
      : undefined;

  return {
    kind: "key",
    action,
    code: event.code,
    ...(typed === undefined ? {} : { char: typed }),
    mods,
  };
};

/**
 * A text as events of at most {@link PANEL_TEXT_MAX} characters each (D-327).
 *
 * It is what an input method commits, or a character whose key is not in the
 * table. Characters that cannot be typed are dropped, and a surrogate pair is
 * never cut in two.
 */
export const panelTextEvents = (text: string): PanelInputEvent[] => {
  const typable = [...text]
    .filter((character) => isTypable(character))
    .join("");
  const events: PanelInputEvent[] = [];
  let chunk = "";

  for (const character of typable) {
    if (chunk.length + character.length > PANEL_TEXT_MAX) {
      events.push({ kind: "text", text: chunk });
      chunk = "";
    }

    chunk += character;
  }

  if (chunk) {
    events.push({ kind: "text", text: chunk });
  }

  return events;
};

/**
 * What a wheel turned, in notches (D-327).
 *
 * A browser says it in pixels (a notch is about a hundred), in lines (three to
 * a notch) or in pages (ten notches); the helper wants notches, and no more
 * than {@link PANEL_WHEEL_MAX} either way.
 */
export const panelWheelNotches = (event: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}): { dx: number; dy: number } => {
  const toNotches = (delta: number): number =>
    event.deltaMode === 1
      ? delta / 3
      : event.deltaMode === 2
      ? delta * 10
      : delta / 100;
  const bounded = (delta: number): number =>
    Math.max(
      -PANEL_WHEEL_MAX,
      Math.min(PANEL_WHEEL_MAX, toNotches(Number.isFinite(delta) ? delta : 0)),
    );

  return { dx: bounded(event.deltaX), dy: bounded(event.deltaY) };
};
