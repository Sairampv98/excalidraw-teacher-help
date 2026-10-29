/**
 * The geometry of the flow animation's DOM overlay.
 *
 * The overlay does **not** replace the canvas: the canvas keeps drawing the
 * flowchart and the overlay adds the focus treatment on top. Its position
 * therefore has to agree with the canvas **exactly**, and it is computed with
 * the library's own `sceneCoordsToViewportCoords` — the oracle — and never
 * re-derived (D-34, D-44).
 *
 * Two transforms are produced:
 *
 * - `flowBoundsTransform` places a scene-space box on screen. It is the
 *   transform the overlay's own copy of a shape is positioned with, so the
 *   shape lands on the pixels the canvas would have used;
 * - `flowFocusTransform` enlarges one element of the focused step about the
 *   centre of the **step's** bounds — the union of the container's and its
 *   label's (D-60).
 */

import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import type { NormalizedZoomValue } from "../types";

import type { FlowBox } from "./flowOrder";

export type FlowAnimationCamera = {
  zoom: { value: NormalizedZoomValue };
  scrollX: number;
  scrollY: number;
  offsetLeft: number;
  offsetTop: number;
};

/**
 * How far the focused step stands out from its box, on every side, in scene
 * units (D-220): a margin, not a share of the size, so a wide node does not get
 * a wide gap.
 */
export const FLOW_FOCUS_MARGIN = 5;

/** the scale that puts the focus `margin` out from a box, on each axis */
export const flowFocusScale = (box: FlowBox, margin = FLOW_FOCUS_MARGIN) => ({
  x: 1 + (2 * margin) / Math.max(box.width, 1),
  y: 1 + (2 * margin) / Math.max(box.height, 1),
});

/**
 * The CSS transform that puts a scene-space box exactly where the canvas would
 * draw it.
 *
 * The oracle returns viewport coordinates. The overlay's host sits inside the
 * editor container, so the container's own offset is subtracted for the DOM
 * placement (D-34) — the same convention `ElementCanvasButtons` uses.
 */
export const flowBoundsTransform = (
  box: FlowBox,
  camera: FlowAnimationCamera,
): string => {
  const { x, y } = sceneCoordsToViewportCoords(
    { sceneX: box.x, sceneY: box.y },
    camera,
  );

  return [
    `translate(${x - camera.offsetLeft}px, ${y - camera.offsetTop}px)`,
    // the canvas scales the whole scene; this is that, folded in here
    `scale(${camera.zoom.value})`,
  ].join(" ");
};

/**
 * The transform that enlarges one element of the focused step about the centre
 * of the **step's** bounds.
 *
 * The offsets are in scene units, measured from the element's own top-left,
 * because the focus transform is applied inside the element's box and before
 * the zoom is folded in.
 */
export const flowFocusTransform = (
  stepBox: FlowBox,
  elementBox: FlowBox,
  scale?: number,
): string => {
  const dx = stepBox.x + stepBox.width / 2 - elementBox.x;
  const dy = stepBox.y + stepBox.height / 2 - elementBox.y;
  // a given scale is uniform; without one the focus is a margin round the box
  const factor = scale === undefined ? flowFocusScale(elementBox) : null;

  return [
    `translate(${dx}px, ${dy}px)`,
    factor ? `scale(${factor.x}, ${factor.y})` : `scale(${scale})`,
    `translate(${-dx}px, ${-dy}px)`,
  ].join(" ");
};
