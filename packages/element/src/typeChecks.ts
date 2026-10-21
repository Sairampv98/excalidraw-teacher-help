import { ROUNDNESS, assertNever } from "@excalidraw/common";

import { pointsEqual } from "@excalidraw/math";

import type { ElementOrToolType } from "@excalidraw/excalidraw/types";

import type { MarkNonNullable } from "@excalidraw/common/utility-types";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  ExcalidrawEmbeddableElement,
  ExcalidrawLinearElement,
  ExcalidrawBindableElement,
  ExcalidrawFreeDrawElement,
  InitializedExcalidrawImageElement,
  ExcalidrawImageElement,
  ExcalidrawTextElementWithContainer,
  ExcalidrawTextContainer,
  ExcalidrawFrameElement,
  RoundnessType,
  ExcalidrawFrameLikeElement,
  ExcalidrawElementType,
  ExcalidrawIframeElement,
  ExcalidrawIframeLikeElement,
  ExcalidrawMagicFrameElement,
  ExcalidrawArrowElement,
  ExcalidrawElbowArrowElement,
  ExcalidrawLineElement,
  ExcalidrawFlowchartNodeElement,
  ExcalidrawLinearElementSubType,
  ExcalidrawPanelElement,
  ExcalidrawRectanguloidElement,
} from "./types";

export const isPanelElement = (
  element: ExcalidrawElement | null | undefined,
): element is ExcalidrawPanelElement => {
  return !!element && element.type === "panel";
};

/**
 * A **live** panel: its content is a real DOM surface mounted by the panel
 * overlay, and the canvas paints nothing for it.
 *
 * The live/poster discriminator is `posterMode` (D-33) — deliberately not the
 * base element's `locked` flag, which means "immutable" and would make a
 * poster panel un-selectable.
 *
 * Not a type predicate: `posterMode` is a plain boolean, so there is no
 * narrower panel type to narrow to — narrowing to "the panel type" would make
 * the *negative* branch `never`.
 */
export const isLivePanelElement = (
  element: ExcalidrawElement | null | undefined,
): boolean => {
  return isPanelElement(element) && !element.posterMode;
};

/**
 * A **poster** panel: the canvas paints its poster image at the panel's
 * bounds, and the panel overlay skips it.
 *
 * Not a type predicate — see `isLivePanelElement`.
 */
export const isPosterPanelElement = (
  element: ExcalidrawElement | null | undefined,
): boolean => {
  return isPanelElement(element) && element.posterMode;
};

export const isInitializedImageElement = (
  element: ExcalidrawElement | null,
): element is InitializedExcalidrawImageElement => {
  return !!element && element.type === "image" && !!element.fileId;
};

export const isImageElement = (
  element: ExcalidrawElement | null,
): element is ExcalidrawImageElement => {
  return !!element && element.type === "image";
};

export const isEmbeddableElement = (
  element: ExcalidrawElement | null | undefined,
): element is ExcalidrawEmbeddableElement => {
  return !!element && element.type === "embeddable";
};

export const isIframeElement = (
  element: ExcalidrawElement | null,
): element is ExcalidrawIframeElement => {
  return !!element && element.type === "iframe";
};

export const isIframeLikeElement = (
  element: ExcalidrawElement | null,
): element is ExcalidrawIframeLikeElement => {
  return (
    !!element && (element.type === "iframe" || element.type === "embeddable")
  );
};

export const isTextElement = (
  element: ExcalidrawElement | null,
): element is ExcalidrawTextElement => {
  return element != null && element.type === "text";
};

export const isFrameElement = (
  element: ExcalidrawElement | null,
): element is ExcalidrawFrameElement => {
  return element != null && element.type === "frame";
};

export const isMagicFrameElement = (
  element: ExcalidrawElement | null,
): element is ExcalidrawMagicFrameElement => {
  return element != null && element.type === "magicframe";
};

export const isFrameLikeElement = (
  element: ExcalidrawElement | null,
): element is ExcalidrawFrameLikeElement => {
  return (
    element != null &&
    (element.type === "frame" || element.type === "magicframe")
  );
};

export const isFreeDrawElement = (
  element?: ExcalidrawElement | null,
): element is ExcalidrawFreeDrawElement => {
  return element != null && isFreeDrawElementType(element.type);
};

export const isFreeDrawElementType = (
  elementType: ExcalidrawElementType,
): boolean => {
  return elementType === "freedraw";
};

export const isLinearElement = (
  element?: ExcalidrawElement | null,
): element is ExcalidrawLinearElement => {
  return element != null && isLinearElementType(element.type);
};

export const isLineElement = (
  element?: ExcalidrawElement | null,
): element is ExcalidrawLineElement => {
  return element != null && element.type === "line";
};

export const isArrowElement = (
  element?: ExcalidrawElement | null,
): element is ExcalidrawArrowElement => {
  return element != null && element.type === "arrow";
};

export const isElbowArrow = (
  element?: ExcalidrawElement,
): element is ExcalidrawElbowArrowElement => {
  return isArrowElement(element) && element.elbowed;
};

/**
 * sharp or curved arrow, but not elbow
 */
export const isSimpleArrow = (
  element?: ExcalidrawElement,
): element is ExcalidrawArrowElement => {
  return isArrowElement(element) && !element.elbowed;
};

export const isSharpArrow = (
  element?: ExcalidrawElement,
): element is ExcalidrawArrowElement => {
  return isArrowElement(element) && !element.elbowed && !element.roundness;
};

export const isCurvedArrow = (
  element?: ExcalidrawElement,
): element is ExcalidrawArrowElement => {
  return (
    isArrowElement(element) && !element.elbowed && element.roundness !== null
  );
};

export const isLinearElementType = (
  elementType: ElementOrToolType,
): boolean => {
  return (
    elementType === "arrow" || elementType === "line" // || elementType === "freedraw"
  );
};

export const isBindingElement = (
  element?: ExcalidrawElement | null,
  includeLocked = true,
): element is ExcalidrawArrowElement => {
  return (
    element != null &&
    (!element.locked || includeLocked === true) &&
    isBindingElementType(element.type)
  );
};

export const isBindingElementType = (
  elementType: ElementOrToolType,
): boolean => {
  return elementType === "arrow";
};

export const isBindableElement = (
  element: ExcalidrawElement | null | undefined,
  includeLocked = true,
): element is ExcalidrawBindableElement => {
  return (
    element != null &&
    (!element.locked || includeLocked === true) &&
    // NOTE: a panel is deliberately NOT bindable — an arrow must never bind
    // to a panel. Recorded as a deliberate reject, not an oversight.
    (element.type === "rectangle" ||
      element.type === "diamond" ||
      element.type === "ellipse" ||
      element.type === "image" ||
      element.type === "iframe" ||
      element.type === "embeddable" ||
      element.type === "frame" ||
      element.type === "magicframe" ||
      (element.type === "text" && !element.containerId))
  );
};

/**
 * A panel is a **rectangular** on-canvas footprint, so it belongs to the
 * rectanguloid/rectangular groups: the distance and segment maths, the
 * hit-test and the bounds all treat it as a plain rotated rectangle.
 *
 * The declared return type is `ExcalidrawRectanguloidElement` (not
 * `ExcalidrawBindableElement`) because a panel is deliberately **not**
 * bindable — an arrow must never bind to a panel.
 */
export const isRectanguloidElement = (
  element?: ExcalidrawElement | null,
): element is ExcalidrawRectanguloidElement => {
  return (
    element != null &&
    (element.type === "rectangle" ||
      element.type === "diamond" ||
      element.type === "image" ||
      element.type === "iframe" ||
      element.type === "embeddable" ||
      element.type === "frame" ||
      element.type === "magicframe" ||
      element.type === "panel" ||
      (element.type === "text" && !element.containerId))
  );
};

// TODO: Remove this when proper distance calculation is introduced
// @see binding.ts:distanceToBindableElement()
/**
 * A panel is a **rectangular** on-canvas footprint, so it belongs to the
 * rectanguloid/rectangular groups: the distance and segment maths, the
 * hit-test and the bounds all treat it as a plain rotated rectangle.
 *
 * The declared return type is `ExcalidrawRectanguloidElement` (not
 * `ExcalidrawBindableElement`) because a panel is deliberately **not**
 * bindable — an arrow must never bind to a panel.
 */
export const isRectangularElement = (
  element?: ExcalidrawElement | null,
): element is ExcalidrawRectanguloidElement => {
  return (
    element != null &&
    (element.type === "rectangle" ||
      element.type === "image" ||
      element.type === "text" ||
      element.type === "iframe" ||
      element.type === "embeddable" ||
      element.type === "frame" ||
      element.type === "magicframe" ||
      element.type === "freedraw" ||
      element.type === "panel")
  );
};

export const isTextBindableContainer = (
  element: ExcalidrawElement | null,
  includeLocked = true,
): element is ExcalidrawTextContainer => {
  return (
    element != null &&
    (!element.locked || includeLocked === true) &&
    (element.type === "rectangle" ||
      element.type === "diamond" ||
      element.type === "ellipse" ||
      isArrowElement(element))
  );
};

export const isExcalidrawElement = (
  element: any,
): element is ExcalidrawElement => {
  const type: ExcalidrawElementType | undefined = element?.type;
  if (!type) {
    return false;
  }
  switch (type) {
    case "text":
    case "diamond":
    case "rectangle":
    case "iframe":
    case "embeddable":
    case "ellipse":
    case "arrow":
    case "freedraw":
    case "line":
    case "frame":
    case "magicframe":
    case "image":
    case "panel":
    case "selection": {
      return true;
    }
    default: {
      assertNever(type, null);
      return false;
    }
  }
};

export const isFlowchartNodeElement = (
  element: ExcalidrawElement,
): element is ExcalidrawFlowchartNodeElement => {
  return (
    element.type === "rectangle" ||
    element.type === "ellipse" ||
    element.type === "diamond"
  );
};

export const hasBoundTextElement = (
  element: ExcalidrawElement | null,
): element is MarkNonNullable<ExcalidrawBindableElement, "boundElements"> => {
  return (
    isTextBindableContainer(element) &&
    !!element.boundElements?.some(({ type }) => type === "text")
  );
};

export const isBoundToContainer = (
  element: ExcalidrawElement | null,
): element is ExcalidrawTextElementWithContainer => {
  return (
    element !== null &&
    "containerId" in element &&
    element.containerId !== null &&
    isTextElement(element)
  );
};

export const isArrowBoundToElement = (element: ExcalidrawArrowElement) => {
  return !!element.startBinding || !!element.endBinding;
};

export const isUsingAdaptiveRadius = (type: string) =>
  type === "rectangle" ||
  type === "embeddable" ||
  type === "iframe" ||
  type === "image";

export const isUsingProportionalRadius = (type: string) =>
  type === "line" || type === "arrow" || type === "diamond";

export const canApplyRoundnessTypeToElement = (
  roundnessType: RoundnessType,
  element: ExcalidrawElement,
) => {
  if (
    (roundnessType === ROUNDNESS.ADAPTIVE_RADIUS ||
      // if legacy roundness, it can be applied to elements that currently
      // use adaptive radius
      roundnessType === ROUNDNESS.LEGACY) &&
    isUsingAdaptiveRadius(element.type)
  ) {
    return true;
  }
  if (
    roundnessType === ROUNDNESS.PROPORTIONAL_RADIUS &&
    isUsingProportionalRadius(element.type)
  ) {
    return true;
  }

  return false;
};

export const getDefaultRoundnessTypeForElement = (
  element: ExcalidrawElement,
) => {
  if (isUsingProportionalRadius(element.type)) {
    return {
      type: ROUNDNESS.PROPORTIONAL_RADIUS,
    };
  }

  if (isUsingAdaptiveRadius(element.type)) {
    return {
      type: ROUNDNESS.ADAPTIVE_RADIUS,
    };
  }

  return null;
};

export const getLinearElementSubType = (
  element: ExcalidrawLinearElement,
): ExcalidrawLinearElementSubType => {
  if (isSharpArrow(element)) {
    return "sharpArrow";
  }
  if (isCurvedArrow(element)) {
    return "curvedArrow";
  }
  if (isElbowArrow(element)) {
    return "elbowArrow";
  }
  return "line";
};

/**
 * Checks if current element points meet all the conditions for polygon=true
 * (this isn't a element type check, for that use isLineElement).
 *
 * If you want to check if points *can* be turned into a polygon, use
 *  canBecomePolygon(points).
 */
export const isValidPolygon = (
  points: ExcalidrawLineElement["points"],
): boolean => {
  return points.length > 3 && pointsEqual(points[0], points[points.length - 1]);
};

export const canBecomePolygon = (
  points: ExcalidrawLineElement["points"],
): boolean => {
  return (
    points.length > 3 ||
    // 3-point polygons can't have all points in a single line
    (points.length === 3 && !pointsEqual(points[0], points[points.length - 1]))
  );
};

export const isEligibleFrameChildType = (type: ElementOrToolType) => {
  switch (type) {
    case "rectangle":
    case "diamond":
    case "ellipse":
    case "arrow":
    case "line":
    case "freedraw":
    case "text":
    case "image":
    case "frame":
    case "embeddable": {
      return true;
    }
    default: {
      // NOTE: a panel is deliberately NOT an eligible frame child. A panel is
      // `floating: true` — it is not owned by its page and may sit outside
      // the page rect — so it must never become a frame child. This arm is
      // not TS-protected (`ElementOrToolType` is not the element union), so
      // the reject is recorded here rather than left to chance.
      return false;
    }
  }
};
