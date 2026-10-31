/**
 * The camera flight of an exported animation (D-385): the picture flies to each
 * step, as the view does while the animation plays with its camera on.
 *
 * The live flight takes 1.5 seconds and starts from wherever the view happens to
 * be, so when a step is shorter than that the view never arrives and its path
 * depends on what came before. A file cannot be like that: it has to be the same
 * picture for the same moment, and it has to loop. So each flight here is from
 * the step before to the step, **finishes inside the step** (it takes the shorter
 * of 1.5 seconds and the step), and the camera at any moment is a function of the
 * moment alone. Everything is the live flight's own: the same target for a step,
 * the same padding, the same easing.
 */

import { MAX_ZOOM } from "@excalidraw/common";

import {
  FLOW_CAMERA_PADDING,
  FLOW_FLIGHT_MS,
  cameraAt,
  flightTarget,
} from "../flowCamera";

import { stepAt } from "./plan";

import type { FlowBox } from "../flowOrder";

/** scene units to pixels: `x * scale + offsetX` (the shape the pictures are drawn with) */
export type FlowCameraTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

const toTransform = (camera: {
  zoom: number;
  scrollX: number;
  scrollY: number;
}): FlowCameraTransform => ({
  scale: camera.zoom,
  offsetX: camera.scrollX * camera.zoom,
  offsetY: camera.scrollY * camera.zoom,
});

/**
 * The camera at `timeMs`: flying to the step that is current, from the step
 * before it (the last one, for the first).
 */
export const flightTransformAt = ({
  steps,
  durationMs,
  timeMs,
  picture,
  chart,
}: {
  steps: readonly { box: FlowBox }[];
  durationMs: number;
  timeMs: number;
  /** the picture, in pixels: the view the camera looks through */
  picture: { width: number; height: number };
  /** the chart's box: the camera does not leave it, with the padding */
  chart: FlowBox;
}): FlowCameraTransform => {
  const pageRect = {
    x: chart.x - FLOW_CAMERA_PADDING,
    y: chart.y - FLOW_CAMERA_PADDING,
    width: chart.width + 2 * FLOW_CAMERA_PADDING,
    height: chart.height + 2 * FLOW_CAMERA_PADDING,
  };

  const target = (index: number) =>
    flightTarget({
      box: steps[index].box,
      viewport: picture,
      pageRect,
      maxZoom: MAX_ZOOM,
    });

  const { stepIndex, sinceStepMs } = stepAt(timeMs, steps.length, durationMs);
  const to = target(stepIndex);
  const from = target((stepIndex - 1 + steps.length) % steps.length);
  const flight = Math.max(1, Math.min(FLOW_FLIGHT_MS, durationMs));

  return toTransform(
    cameraAt(from, to, Math.min(1, sinceStepMs / flight), picture),
  );
};

/** the part of the scene a camera looks at, in scene units */
export const sceneRectOf = (
  transform: FlowCameraTransform,
  picture: { width: number; height: number },
) => ({
  x: -transform.offsetX / transform.scale,
  y: -transform.offsetY / transform.scale,
  width: picture.width / transform.scale,
  height: picture.height / transform.scale,
});
