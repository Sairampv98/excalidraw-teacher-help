/**
 * The attribute of an element that has the keyboard for something else (D-345).
 *
 * The mirror's live window takes it while Control is on and the window has the
 * keyboard: every key goes into the editor, so the canvas's own shortcuts - the
 * command palette's, the search's - must not hear it.
 */
export const KEYBOARD_TAKEN_ATTRIBUTE = "data-keyboard-taken";

/** Whether a key event is for an element that has taken the keyboard. */
export const isKeyboardTaken = (event: Event): boolean =>
  event.target instanceof Element &&
  event.target.closest(`[${KEYBOARD_TAKEN_ATTRIBUTE}="true"]`) !== null;
