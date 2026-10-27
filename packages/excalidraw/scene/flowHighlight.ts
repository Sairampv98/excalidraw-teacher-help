/**
 * What a step's highlight is drawn on, and in what shape (D-191, D-192).
 *
 * The highlight follows the node it is on: a rectangle with the corner
 * roundness it was drawn with, an ellipse as an ellipse, a diamond as a
 * diamond, and a rotated node at its own angle. All of it is read from the
 * element, so a node that is changed in the editor is followed, and all of it
 * is pure so it is tested without a canvas.
 */

import { getCornerRadius } from "@excalidraw/element";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import type { FlowHighlightTarget } from "./flowLook";
import type { FlowBox, FlowStep } from "./flowOrder";

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

/**
 * The elements of a step that are highlighted (D-191): the node itself - the
 * container, with its label inside it - or, when the teacher asked for it,
 * only the label. A node with no label has no text to highlight and takes the
 * shape.
 */
export const nodeHighlightElements = (
  step: FlowStep,
  elementsMap: ElementsMap,
  target: FlowHighlightTarget,
): ExcalidrawElement[] => {
  const elements = step.elementIds
    .map((id) => elementsMap.get(id))
    .filter((element): element is ExcalidrawElement => Boolean(element));

  const container = elements.find((element) => element.id === step.containerId);
  const labels = elements.filter(
    (element) => element.type === "text" && element.id !== step.containerId,
  );

  if (target === "text" && labels.length) {
    return labels;
  }

  return container ? [container] : elements;
};
