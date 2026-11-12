/**
 * Hiding and recolouring the arrows of an animated flow (D-204).
 *
 * The animation does not paint over an arrow: the canvas is given the arrow
 * **without**, or a **copy** with its stroke colour changed. That happens where
 * the list of what the canvas draws is built, so the elements the editor holds,
 * and the document, are never touched - what the canvas is handed is a copy,
 * and a copy is kept so that it is not made again every frame.
 *
 * Everything here is pure.
 */

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { FlowGraph } from "./flowOrder";

/** what an animated flow does to one of its arrows */
export type ArrowLook = {
  /** the canvas does not draw the arrow */
  hidden: boolean;
  /** the canvas draws the arrow in this colour; `null` leaves it as it is */
  color: string | null;
};

export type ArrowLooks = ReadonlyMap<string, ArrowLook>;

/** no flow is animated: every arrow is drawn as it is */
export const NO_ARROW_LOOKS: ArrowLooks = new Map();

/** the looks a flow gives to its arrows, from its look (D-190, D-204) */
export const arrowLooksFor = (
  graph: FlowGraph,
  look: {
    hideArrow: boolean;
    arrowColor: string | null;
    glowArrow?: boolean;
    arrowStyle?: string;
  },
): [string, ArrowLook][] => {
  // the arrow animation is off: the arrows are as they are drawn
  if (look.arrowStyle === "off") {
    return [];
  }

  // a neon arrow keeps its own drawing - its shape, its head - and the tube is
  // the glow laid along it; only "Hide arrow" takes the arrow away
  const hidden = look.hideArrow;

  return !hidden && !look.arrowColor
    ? []
    : graph.edgeArrows.map(({ arrowId }) => [
        arrowId,
        { hidden, color: hidden ? null : look.arrowColor },
      ]);
};

type Kept = { version: number; versionNonce: number; copy: ExcalidrawElement };

const copies = new WeakMap<object, Map<string, Kept>>();

/**
 * A copy of an element with its stroke colour changed. The copy is **kept**: the
 * same element in the same colour gives the same object, so the canvas's own
 * caches keep their hold on it; and it is made again when the element changes.
 * The element itself is not touched.
 */
export const recoloured = <T extends ExcalidrawElement>(
  element: T,
  color: string,
): T => {
  let byColor = copies.get(element);

  if (!byColor) {
    byColor = new Map();
    copies.set(element, byColor);
  }

  const kept = byColor.get(color);

  if (
    kept &&
    kept.version === element.version &&
    kept.versionNonce === element.versionNonce
  ) {
    return kept.copy as T;
  }

  const copy = { ...element, strokeColor: color };

  byColor.set(color, {
    version: element.version,
    versionNonce: element.versionNonce,
    copy,
  });

  return copy;
};

/**
 * The element the canvas is given for `element`: nothing when its arrow is
 * hidden, a recoloured copy when it has a colour, and the element itself
 * otherwise.
 */
export const elementForCanvas = <T extends ExcalidrawElement>(
  element: T,
  looks: ArrowLooks | undefined,
): T | null => {
  const look = looks?.get(element.id);

  if (!look) {
    return element;
  }

  if (look.hidden) {
    return null;
  }

  return look.color ? recoloured(element, look.color) : element;
};
