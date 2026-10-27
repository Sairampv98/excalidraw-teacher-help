/**
 * The arrows that are being hidden or recoloured right now (D-204).
 *
 * The animation overlays say what their flow does to its arrows, each under its
 * own name - the flow that is played or stepped, and the flows of the class loop
 * - and the editor reads the whole of it when it builds what the canvas draws.
 * It is a jotai atom, like the animation's own state (D-63): nothing here is
 * written into the document.
 */

import { atom, editorJotaiStore } from "../editor-jotai";
import { NO_ARROW_LOOKS } from "../scene/flowArrowLooks";

import type { ArrowLook, ArrowLooks } from "../scene/flowArrowLooks";

type Entries = readonly (readonly [string, ArrowLook])[];

export const flowArrowLooksAtom = atom<Readonly<Record<string, Entries>>>({});

/** says what the flow under `source` does to its arrows; nothing clears it */
export const setFlowArrowLooks = (source: string, entries: Entries) => {
  const current = editorJotaiStore.get(flowArrowLooksAtom);

  // an unchanged answer is no change: nothing is drawn again for it
  if (
    JSON.stringify(current[source] ?? []) === JSON.stringify(entries) ||
    (!current[source] && !entries.length)
  ) {
    return;
  }

  const next = { ...current };

  if (entries.length) {
    next[source] = entries;
  } else {
    delete next[source];
  }

  editorJotaiStore.set(flowArrowLooksAtom, next);
};

const merged = new WeakMap<object, ArrowLooks>();

/**
 * Everything that is being hidden or recoloured, as one map. The same state
 * gives the same map, so the renderer can tell that nothing has changed.
 */
export const mergeFlowArrowLooks = (
  state: Readonly<Record<string, Entries>>,
): ArrowLooks => {
  const sources = Object.values(state);

  if (!sources.length) {
    return NO_ARROW_LOOKS;
  }

  const kept = merged.get(state);

  if (kept) {
    return kept;
  }

  const map = new Map<string, ArrowLook>();

  for (const entries of sources) {
    for (const [id, look] of entries) {
      map.set(id, look);
    }
  }

  merged.set(state, map);

  return map;
};

export const getFlowArrowLooks = (): ArrowLooks =>
  mergeFlowArrowLooks(editorJotaiStore.get(flowArrowLooksAtom));

/** calls `listener` whenever what is hidden or recoloured changes */
export const subscribeToFlowArrowLooks = (listener: () => void) =>
  editorJotaiStore.sub(flowArrowLooksAtom, listener);
