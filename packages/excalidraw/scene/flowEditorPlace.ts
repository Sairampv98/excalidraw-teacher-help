/**
 * Where the script editor's panel goes (D-222).
 *
 * It opens beside the chart it edits and never over it when there is room beside
 * it; once the teacher has moved it, its place is remembered in the browser's
 * own storage, read defensively. The place is a place in the window and not in
 * the document.
 */

import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import { FLOW_BAR_EDGE_MARGIN, clampFlowBarPlace } from "./flowBarPlace";

import type { FlowAnimationCamera } from "./flowAnimation";
import type { FlowViewport } from "./flowCamera";
import type { FlowBox } from "./flowOrder";

export const FLOW_EDITOR_PLACE_KEY = "excalidraw-flow-editor-place";

/** the panel's size, in the editor's own pixels */
export const FLOW_EDITOR_SIZE = { width: 360, height: 470 } as const;

/** the space between the panel and the chart it sits beside */
export const FLOW_EDITOR_GAP = 16;

export type FlowEditorPlace = { x: number; y: number } | null;

export const readFlowEditorPlace = (): FlowEditorPlace => {
  try {
    const raw = window.localStorage.getItem(FLOW_EDITOR_PLACE_KEY);
    const stored = raw ? JSON.parse(raw) : null;

    return stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)
      ? { x: stored.x, y: stored.y }
      : null;
  } catch {
    return null;
  }
};

export const writeFlowEditorPlace = (place: NonNullable<FlowEditorPlace>) => {
  try {
    window.localStorage.setItem(FLOW_EDITOR_PLACE_KEY, JSON.stringify(place));
  } catch {
    // the place still applies for this session
  }
};

/** a remembered place that is inside this window; one that is not is ignored */
export const usableFlowEditorPlace = (
  place: FlowEditorPlace,
  viewport: FlowViewport,
  size: { width: number; height: number } = FLOW_EDITOR_SIZE,
) =>
  place &&
  place.x >= 0 &&
  place.y >= 0 &&
  place.x <= viewport.width - FLOW_BAR_EDGE_MARGIN &&
  place.y <= viewport.height - FLOW_BAR_EDGE_MARGIN
    ? clampFlowBarPlace(place, size, viewport)
    : null;

/**
 * The panel's place beside a chart: to its right when there is room, else to its
 * left, else the corner of the window furthest from it (D-222).
 */
export const flowEditorPosition = ({
  box,
  camera,
  viewport,
  size = FLOW_EDITOR_SIZE,
}: {
  box: FlowBox;
  camera: FlowAnimationCamera;
  viewport: FlowViewport;
  size?: { width: number; height: number };
}) => {
  const topLeft = sceneCoordsToViewportCoords(
    { sceneX: box.x, sceneY: box.y },
    camera,
  );
  const left = topLeft.x - camera.offsetLeft;
  const top = topLeft.y - camera.offsetTop;
  const right = left + box.width * camera.zoom.value;
  const margin = FLOW_BAR_EDGE_MARGIN;

  let x: number;

  if (right + FLOW_EDITOR_GAP + size.width <= viewport.width - margin) {
    x = right + FLOW_EDITOR_GAP;
  } else if (left - FLOW_EDITOR_GAP - size.width >= margin) {
    x = left - FLOW_EDITOR_GAP - size.width;
  } else {
    // no room beside it: the corner furthest from the chart's middle
    x =
      (left + right) / 2 > viewport.width / 2
        ? margin
        : viewport.width - size.width - margin;
  }

  return clampFlowBarPlace({ x, y: top }, size, viewport);
};

/** whether a panel at `place` lies over the chart's box on the screen */
export const flowEditorCoversChart = ({
  place,
  box,
  camera,
  size = FLOW_EDITOR_SIZE,
}: {
  place: { x: number; y: number };
  box: FlowBox;
  camera: FlowAnimationCamera;
  size?: { width: number; height: number };
}) => {
  const topLeft = sceneCoordsToViewportCoords(
    { sceneX: box.x, sceneY: box.y },
    camera,
  );
  const left = topLeft.x - camera.offsetLeft;
  const top = topLeft.y - camera.offsetTop;
  const right = left + box.width * camera.zoom.value;
  const bottom = top + box.height * camera.zoom.value;

  return (
    place.x < right &&
    place.x + size.width > left &&
    place.y < bottom &&
    place.y + size.height > top
  );
};
