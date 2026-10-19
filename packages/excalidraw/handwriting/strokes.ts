/**
 * Convert Excalidraw freedraw elements into engine-agnostic `Ink`.
 *
 * Freedraw elements store `points` relative to the element's (x, y) origin and
 * a parallel `pressures` array. We don't persist per-point timestamps, so we
 * synthesize a monotonically increasing `t` from the point index — sufficient
 * for both the browser API (which mainly uses ordering) and the HTR rasterizer
 * (which ignores time entirely).
 */

import type { Ink, InkPoint, Stroke } from "./types";

/** Minimal shape we need from a freedraw element (keeps this file dep-light). */
export type FreedrawLike = {
  type: string;
  x: number;
  y: number;
  points: readonly (readonly [number, number])[];
  pressures?: readonly number[];
};

/** Synthetic time step between consecutive points, in ms. */
const SYNTHETIC_DT = 8;

export const isFreedraw = (el: { type: string }): el is FreedrawLike =>
  el.type === "freedraw";

/** Build a single stroke (absolute scene coords) from one freedraw element. */
export const strokeFromFreedraw = (el: FreedrawLike): Stroke => {
  const points: InkPoint[] = el.points.map(([px, py], i) => ({
    x: el.x + px,
    y: el.y + py,
    t: i * SYNTHETIC_DT,
    pressure: el.pressures?.[i],
  }));
  return { points };
};

/**
 * Combine several freedraw elements into one `Ink` set, computing the overall
 * bounding box. Non-freedraw elements are ignored.
 */
export const inkFromElements = (elements: readonly { type: string }[]): Ink => {
  const strokes: Stroke[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    if (!isFreedraw(el)) {
      continue;
    }
    const stroke = strokeFromFreedraw(el);
    if (stroke.points.length === 0) {
      continue;
    }
    strokes.push(stroke);
    for (const p of stroke.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  if (strokes.length === 0) {
    return { strokes: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  }

  return { strokes, bounds: { minX, minY, maxX, maxY } };
};

/** Width/height of the ink bounds (0 when empty). */
export const inkSize = (ink: Ink) => ({
  width: ink.bounds.maxX - ink.bounds.minX,
  height: ink.bounds.maxY - ink.bounds.minY,
});
