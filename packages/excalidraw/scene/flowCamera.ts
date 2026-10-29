/**
 * The camera flight of the flow animation (D-170).
 *
 * While a flow plays or is presented, the view can **ease** to the current
 * step: the step's bounds plus a padding, over a second and a half, slowing as
 * it arrives. The flight changes only the **view** - `scrollX`, `scrollY` and
 * `zoom` - and it never leaves the page: the target goes through the page
 * clamp, which also keeps the zoom above its floor.
 *
 * Everything here is pure: a target and a position along the flight give a
 * camera, so the flight is tested without a canvas or a clock.
 */

import { MAX_ZOOM } from "@excalidraw/common";

import { clampCameraToPage } from "./pages";

import type { NormalizedZoomValue, PageRect } from "../types";

import type { FlowBox } from "./flowOrder";

/** the padding round the step, in scene units - the reference pen's number */
export const FLOW_CAMERA_PADDING = 75;

/** how long the flight to a step takes, in milliseconds */
export const FLOW_FLIGHT_MS = 1500;

export type FlowCameraState = {
  scrollX: number;
  scrollY: number;
  zoom: number;
};

export type FlowViewport = { width: number; height: number };

/** a quick start and a slow arrival: the circular ease-out */
export const easeOutCirc = (t: number) => {
  const clamped = Math.min(Math.max(t, 0), 1);

  return Math.sqrt(1 - (clamped - 1) ** 2);
};

/**
 * The camera that shows a step: its bounds plus the padding, as large as the
 * viewport allows, kept on the page.
 */
export const flightTarget = ({
  box,
  viewport,
  pageRect,
  padding = FLOW_CAMERA_PADDING,
  maxZoom = MAX_ZOOM,
}: {
  box: FlowBox;
  viewport: FlowViewport;
  pageRect: PageRect;
  padding?: number;
  maxZoom?: number;
}): FlowCameraState => {
  const width = box.width + padding * 2;
  const height = box.height + padding * 2;
  const zoom = Math.min(viewport.width / width, viewport.height / height);

  // the centre of the box is the centre of the view
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;

  return clampCameraToPage({
    scrollX: viewport.width / (2 * zoom) - centreX,
    scrollY: viewport.height / (2 * zoom) - centreY,
    zoom: zoom as NormalizedZoomValue,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    pageRect,
    maxZoom,
  });
};

/** the scene point at the middle of the view */
const centreOf = (camera: FlowCameraState, viewport: FlowViewport) => ({
  x: viewport.width / (2 * camera.zoom) - camera.scrollX,
  y: viewport.height / (2 * camera.zoom) - camera.scrollY,
});

/**
 * The camera `progress` of the way from one view to another, eased.
 *
 * The view's centre and its zoom are what move; the scroll is derived from
 * them. At the end it is **exactly** the target - no rounding left over - and
 * at the start exactly where it was.
 */
export const cameraAt = (
  from: FlowCameraState,
  to: FlowCameraState,
  progress: number,
  viewport: FlowViewport,
): FlowCameraState => {
  if (progress <= 0) {
    return from;
  }

  if (progress >= 1) {
    return to;
  }

  const t = easeOutCirc(progress);
  const a = centreOf(from, viewport);
  const b = centreOf(to, viewport);
  const zoom = from.zoom + (to.zoom - from.zoom) * t;
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;

  return {
    zoom,
    scrollX: viewport.width / (2 * zoom) - x,
    scrollY: viewport.height / (2 * zoom) - y,
  };
};
