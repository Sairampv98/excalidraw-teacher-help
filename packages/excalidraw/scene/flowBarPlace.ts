/**
 * Where the teacher has put the animation bar, and whether it is collapsed
 * (D-197, D-198).
 *
 * The bar is a movable pill like the toolbar and the properties panel. Its
 * place is a place **in the window**, not in the document, so it is remembered
 * in the browser's own storage - read defensively, because storage can be
 * empty, blocked or hold anything.
 */

import type { FlowViewport } from "./flowCamera";

export const FLOW_BAR_PLACE_KEY = "excalidraw-flow-bar-place";

/** how near an edge a dropped bar is pulled to it, in pixels */
export const FLOW_BAR_SNAP = 24;

/** the space kept between a placed bar and the edge of the window */
export const FLOW_BAR_EDGE_MARGIN = 8;

/** pointer travel, in pixels, before a press on the grip is a drag */
export const FLOW_BAR_DRAG_THRESHOLD = 5;

export type FlowBarPlace = {
  /** the bar's top-left, in the editor's own pixels; `null` follows the chart */
  placed: { x: number; y: number } | null;
  collapsed: boolean;
};

export const NO_FLOW_BAR_PLACE: FlowBarPlace = {
  placed: null,
  collapsed: false,
};

/** what storage holds, kept to what is valid; never throws */
export const readFlowBarPlace = (): FlowBarPlace => {
  try {
    const raw = window.localStorage.getItem(FLOW_BAR_PLACE_KEY);
    const stored = raw ? JSON.parse(raw) : null;

    if (!stored || typeof stored !== "object") {
      return NO_FLOW_BAR_PLACE;
    }

    return {
      placed:
        Number.isFinite(stored.x) && Number.isFinite(stored.y)
          ? { x: stored.x, y: stored.y }
          : null,
      collapsed: stored.collapsed === true,
    };
  } catch {
    return NO_FLOW_BAR_PLACE;
  }
};

export const writeFlowBarPlace = (place: FlowBarPlace) => {
  try {
    window.localStorage.setItem(
      FLOW_BAR_PLACE_KEY,
      JSON.stringify({
        x: place.placed?.x,
        y: place.placed?.y,
        collapsed: place.collapsed,
      }),
    );
  } catch {
    // the place still applies for this session
  }
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/** keeps a placed bar inside the window, with the margin on every side */
export const clampFlowBarPlace = (
  place: { x: number; y: number },
  size: { width: number; height: number },
  viewport: FlowViewport,
) => ({
  x: clamp(
    place.x,
    FLOW_BAR_EDGE_MARGIN,
    viewport.width - size.width - FLOW_BAR_EDGE_MARGIN,
  ),
  y: clamp(
    place.y,
    FLOW_BAR_EDGE_MARGIN,
    viewport.height - size.height - FLOW_BAR_EDGE_MARGIN,
  ),
});

/** a bar dropped near an edge is pulled to it */
export const snapFlowBarPlace = (
  place: { x: number; y: number },
  size: { width: number; height: number },
  viewport: FlowViewport,
) => {
  const clamped = clampFlowBarPlace(place, size, viewport);
  const right = viewport.width - size.width - FLOW_BAR_EDGE_MARGIN;
  const bottom = viewport.height - size.height - FLOW_BAR_EDGE_MARGIN;

  return {
    x:
      clamped.x - FLOW_BAR_EDGE_MARGIN < FLOW_BAR_SNAP
        ? FLOW_BAR_EDGE_MARGIN
        : right - clamped.x < FLOW_BAR_SNAP
        ? Math.max(FLOW_BAR_EDGE_MARGIN, right)
        : clamped.x,
    y:
      clamped.y - FLOW_BAR_EDGE_MARGIN < FLOW_BAR_SNAP
        ? FLOW_BAR_EDGE_MARGIN
        : bottom - clamped.y < FLOW_BAR_SNAP
        ? Math.max(FLOW_BAR_EDGE_MARGIN, bottom)
        : clamped.y,
  };
};

/**
 * A remembered place that can be used in this window: one that is off the
 * window - a smaller screen than it was set on - is ignored, and the bar
 * follows the chart again (D-197).
 */
export const usableFlowBarPlace = (
  placed: FlowBarPlace["placed"],
  viewport: FlowViewport,
) =>
  placed &&
  placed.x >= 0 &&
  placed.y >= 0 &&
  placed.x <= viewport.width - FLOW_BAR_EDGE_MARGIN &&
  placed.y <= viewport.height - FLOW_BAR_EDGE_MARGIN
    ? placed
    : null;
