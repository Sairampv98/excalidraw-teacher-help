/**
 * The ink look the next element is drawn with (D-241).
 *
 * Choosing a look in the properties panel sets it on what is selected and keeps
 * it for the next element drawn, as the other `currentItem` choices do. It is a
 * jotai atom (the `PageSplitState.ts` pattern) and not `appState`, so it is not
 * part of the scene's state or of its snapshots.
 */

import { NORMAL_INK, customDataWithInk, canHaveInk } from "@excalidraw/element";

import type { Ink } from "@excalidraw/element";

import { atom, editorJotaiStore } from "./editor-jotai";

export const currentInkAtom = atom<Ink>(NORMAL_INK);

export const getCurrentInk = (): Ink => editorJotaiStore.get(currentInkAtom);

export const setCurrentInk = (ink: Ink) => {
  editorJotaiStore.set(currentInkAtom, ink);
};

/**
 * The `customData` a new element of this type is made with: the ink look that is
 * chosen, or nothing when it is Normal or the element cannot have one.
 */
export const newElementInkProps = (type: string) => {
  const ink = getCurrentInk();

  if (ink.look === "normal" || !canHaveInk({ type })) {
    return {};
  }

  return { customData: customDataWithInk(undefined, ink) };
};
