/**
 * What a step's highlight is drawn on, and in what shape (D-191, D-192).
 *
 * The highlight follows the node it is on: a rectangle with the corner
 * roundness it was drawn with, an ellipse as an ellipse, a diamond as a
 * diamond, and a rotated node at its own angle. All of it is read from the
 * element, so a node that is changed in the editor is followed, and all of it
 * is pure so it is tested without a canvas.
 */

import {
  getBoundTextElement,
  getCornerRadius,
  mediaOf,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import type { FlowHighlightTarget } from "./flowLook";
import type { FlowBox, FlowGraph, FlowStep } from "./flowOrder";

export type HighlightShape = {
  kind: "rect" | "ellipse" | "diamond";
  /** the corner radius of a rectangle, in scene units; 0 for the others */
  radius: number;
  /** the angle the node is rotated by, in radians */
  angle: number;
};

/**
 * The outline a node's highlight takes. A node with no outline of its own (a
 * free-form shape, an image, a label) takes the rectangle of its bounds.
 */
export const highlightShapeOf = (
  element: ExcalidrawElement,
): HighlightShape => {
  const angle = element.angle ?? 0;

  if (element.type === "ellipse") {
    return { kind: "ellipse", radius: 0, angle };
  }

  if (element.type === "diamond") {
    return { kind: "diamond", radius: 0, angle };
  }

  const radius =
    element.type === "rectangle" && element.roundness
      ? getCornerRadius(Math.min(element.width, element.height), element)
      : 0;

  return { kind: "rect", radius, angle };
};

/**
 * The box a highlight is laid out in: the element's own, **not** rotated. The
 * rotation is the outline's - about the centre, which is the same centre as the
 * bounds of the rotated element.
 */
export const highlightBoxOf = (element: ExcalidrawElement): FlowBox => ({
  x: element.x,
  y: element.y,
  width: element.width,
  height: element.height,
});

/** what a step's highlight is drawn on (D-201) */
export type HighlightParts = {
  /** the node's outline: drawn in the node's own shape */
  outline: ExcalidrawElement | null;
  /** a rectangle on the label's own box */
  box: ExcalidrawTextElement | null;
  /** the label's letters, lit as letters (D-202) */
  letters: ExcalidrawTextElement | null;
};

/** the label of a step: the text bound to its container, if it has one */
export const labelOf = (
  step: FlowStep,
  elementsMap: ElementsMap,
): ExcalidrawTextElement | null => {
  for (const id of step.elementIds) {
    const element = elementsMap.get(id);

    if (element && element.type === "text" && id !== step.containerId) {
      return element;
    }
  }

  return null;
};

/**
 * What the highlight of a step is put on (D-201): the node's outline, the
 * rectangle on the label's box, the label's letters, or an outline with one of
 * the other two. A node with no label has no text, so every choice that names a
 * text takes the shape.
 */
export const nodeHighlightParts = (
  step: FlowStep,
  elementsMap: ElementsMap,
  target: FlowHighlightTarget,
): HighlightParts => {
  const container = elementsMap.get(step.containerId) ?? null;
  const label = labelOf(step, elementsMap);

  if (!label || target === "shape") {
    return { outline: container, box: null, letters: null };
  }

  switch (target) {
    case "shape-box":
      return { outline: container, box: label, letters: null };
    case "shape-text":
      return { outline: container, box: null, letters: label };
    case "box":
      return { outline: null, box: label, letters: null };
    case "letters":
      return { outline: null, box: null, letters: label };
    default:
      return { outline: container, box: null, letters: null };
  }
};

/** the labels bound to the arrows of a flow: the yes and no of a decision (D-203) */
export const arrowLabelsOf = (
  graph: FlowGraph | null,
  elementsMap: ElementsMap,
): ExcalidrawTextElement[] => {
  const labels: ExcalidrawTextElement[] = [];

  for (const edge of graph?.edgeArrows ?? []) {
    const arrow = elementsMap.get(edge.arrowId);
    const label = arrow && getBoundTextElement(arrow, elementsMap);

    if (label && !label.isDeleted) {
      labels.push(label);
    }
  }

  return labels;
};

/**
 * The labels the overlay draws again for a flow's current step (D-213): the
 * labels of its arrows when something is animated along them, and the letters
 * of the step's own label when they are lit. The canvas does not draw these, so
 * a label is never seen twice - the overlay's copy is the one on the screen.
 */
export const drawnLabelIds = ({
  graph,
  step,
  elementsMap,
  nodeStyle,
  nodeTarget,
  arrowsAnimated,
}: {
  graph: FlowGraph | null;
  step: FlowStep | undefined;
  elementsMap: ElementsMap;
  nodeStyle: string;
  nodeTarget: FlowHighlightTarget;
  /** something is animated along the arrows: marks, a colour, or hidden */
  arrowsAnimated: boolean;
}): string[] => {
  const ids: string[] = [];

  if (arrowsAnimated) {
    ids.push(...arrowLabelsOf(graph, elementsMap).map((label) => label.id));
  }

  if (step && nodeStyle !== "none") {
    const letters = nodeHighlightParts(step, elementsMap, nodeTarget).letters;

    if (letters) {
      ids.push(letters.id);
    }
  }

  return ids;
};

/**
 * Whether a step holds media (D-246): a picture, a GIF or a video in its node.
 * Such a step is only outlined by the highlight - a wash of the look's colour
 * over the picture would change it.
 */
export const stepHoldsMedia = (
  step: { elementIds: readonly string[] },
  elementsMap: ElementsMap,
) =>
  step.elementIds.some((id) => {
    const member = elementsMap.get(id);

    return !!member && mediaOf(member) !== null;
  });
