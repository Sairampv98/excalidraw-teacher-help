/**
 * The arrows of a chart follow its nodes (D-249).
 *
 * An arrow that joins two nodes is bound to them, and the editor moves its ends
 * when a node is moved or resized *by the editor*. A node that is changed by
 * something else - the script's Apply giving it another shape, a layout - is
 * changed without the editor knowing, and the arrow keeps the ends it had: it
 * runs into the middle of a node that has grown. This puts the arrows right.
 *
 * It works on a scene of its own made of copies, with the editor's own
 * `updateBoundElements`, so the arrows end where the editor would put them.
 */

import {
  Scene,
  newElementWith,
  updateBoundElements,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

/** whether an element is a node of a chart: a shape the chart's arrows are bound to */
export const isChartNode = (element: ExcalidrawElement) =>
  !element.isDeleted &&
  element.type !== "arrow" &&
  element.type !== "text" &&
  element.customData?.flow?.role === "node";

/** what an arrow's ends depend on in its node: its place, its size, its angle and its shape */
export const nodeGeometry = (node: ExcalidrawElement) =>
  [
    node.type,
    Math.round(node.x * 100) / 100,
    Math.round(node.y * 100) / 100,
    Math.round(node.width * 100) / 100,
    Math.round(node.height * 100) / 100,
    Math.round(node.angle * 1000) / 1000,
  ].join("|");

const same = (a: number, b: number) => Math.abs(a - b) < 0.01;

/**
 * The elements with the arrows bound to these nodes put where the editor puts
 * them, or null when they already are.
 */
export const refreshBoundArrows = (
  elements: readonly ExcalidrawElement[],
  nodeIds: ReadonlySet<string>,
): ExcalidrawElement[] | null => {
  const scene = new Scene();

  scene.replaceAllElements(elements.map((element) => ({ ...element })));

  const map = scene.getNonDeletedElementsMap();

  for (const id of nodeIds) {
    const node = map.get(id);

    if (node) {
      updateBoundElements(node, scene);
    }
  }

  const moved = scene.getElementsMapIncludingDeleted();
  let changed = false;

  const next = elements.map((original) => {
    if (original.type !== "arrow" || original.isDeleted) {
      return original;
    }

    const arrow = moved.get(original.id);

    if (
      !arrow ||
      arrow.type !== "arrow" ||
      (same(arrow.x, original.x) &&
        same(arrow.y, original.y) &&
        same(arrow.width, original.width) &&
        same(arrow.height, original.height) &&
        arrow.points.length === original.points.length &&
        arrow.points.every(
          (point, i) =>
            same(point[0], original.points[i][0]) &&
            same(point[1], original.points[i][1]),
        ))
    ) {
      return original;
    }

    changed = true;

    return newElementWith(original, {
      x: arrow.x,
      y: arrow.y,
      width: arrow.width,
      height: arrow.height,
      points: arrow.points,
    });
  });

  return changed ? next : null;
};
