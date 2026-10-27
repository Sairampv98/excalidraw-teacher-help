/**
 * Where the floating animation bar sits (D-177).
 *
 * The bar is anchored just below the chart it controls and follows it: it is
 * placed from the chart's bounds with the library's own
 * `sceneCoordsToViewportCoords`, so a moved chart, a scroll and a zoom all move
 * it by construction. When the chart's own edge is off screen the bar is held
 * at the nearest edge **inside** the viewport, so it can always be reached.
 *
 * Pure: bounds, camera and viewport in, a position out.
 */

import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import type { FlowAnimationCamera } from "./flowAnimation";
import type { FlowViewport } from "./flowCamera";
import type { FlowBox } from "./flowOrder";

/** the space kept between the bar and the edge of the viewport, in pixels */
export const FLOW_BAR_MARGIN = 8;

/** the space between the chart and the bar, in pixels */
export const FLOW_BAR_GAP = 12;

/** about how wide the bar is at most, in pixels: it wraps below this width */
export const FLOW_BAR_WIDTH = 440;

/** about how tall the bar is, in pixels: two rows of controls */
export const FLOW_BAR_HEIGHT = 112;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/** the box all the steps of a flow fill, in scene units */
export const unionOfBoxes = (boxes: readonly FlowBox[]): FlowBox | null => {
  if (!boxes.length) {
    return null;
  }

  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/**
 * The bar's position in the overlay's own pixels: `left` is the **centre** of
 * the bar (it is centred on that point) and `top` is its top edge.
 */
export const flowBarPosition = ({
  box,
  camera,
  viewport,
}: {
  box: FlowBox;
  camera: FlowAnimationCamera;
  viewport: FlowViewport;
}) => {
  const { x, y } = sceneCoordsToViewportCoords(
    { sceneX: box.x + box.width / 2, sceneY: box.y + box.height },
    camera,
  );

  // the bar is centred on the chart, so it needs half its own width each side
  const half = Math.min(
    FLOW_BAR_WIDTH / 2,
    Math.max(0, (viewport.width - FLOW_BAR_MARGIN * 2) / 2),
  );

  return {
    left: clamp(
      x - camera.offsetLeft,
      FLOW_BAR_MARGIN + half,
      viewport.width - FLOW_BAR_MARGIN - half,
    ),
    top: clamp(
      y - camera.offsetTop + FLOW_BAR_GAP,
      FLOW_BAR_MARGIN,
      viewport.height - FLOW_BAR_HEIGHT - FLOW_BAR_MARGIN,
    ),
  };
};
