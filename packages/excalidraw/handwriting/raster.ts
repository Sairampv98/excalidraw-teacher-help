/**
 * Pure (canvas-free) rasterizer: turns ink strokes into a fixed-height
 * grayscale strip the HTR model consumes. Implemented with a hand-rolled line
 * drawer so it runs identically in the browser and under Node (tests) without
 * needing an OffscreenCanvas.
 *
 * Output values are in [0, 1] where 1 = ink, 0 = background.
 */

import type { Ink } from "./types";

export type RasterOptions = {
  height: number;
  maxWidth: number;
  padding: number;
};

export type Raster = {
  data: Float32Array; // length = width * height, row-major
  width: number;
  height: number;
};

/** Plot a point with a small soft brush so thin strokes survive downscaling. */
const plot = (
  data: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
) => {
  const xi = Math.round(x);
  const yi = Math.round(y);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = xi + dx;
      const py = yi + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) {
        continue;
      }
      const v = dx === 0 && dy === 0 ? 1 : 0.5;
      const idx = py * width + px;
      if (v > data[idx]) {
        data[idx] = v;
      }
    }
  }
};

const drawLine = (
  data: Float32Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) => {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    plot(data, width, height, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
  }
};

export const rasterizeInk = (ink: Ink, opts: RasterOptions): Raster => {
  const { height, maxWidth, padding } = opts;
  const inkW = Math.max(1, ink.bounds.maxX - ink.bounds.minX);
  const inkH = Math.max(1, ink.bounds.maxY - ink.bounds.minY);

  const innerH = height - padding * 2;
  const scale = innerH / inkH;
  const width = Math.min(
    maxWidth,
    Math.max(1, Math.round(inkW * scale) + padding * 2),
  );

  const data = new Float32Array(width * height);

  const tx = (x: number) => (x - ink.bounds.minX) * scale + padding;
  const ty = (y: number) => (y - ink.bounds.minY) * scale + padding;

  for (const stroke of ink.strokes) {
    const pts = stroke.points;
    if (pts.length === 1) {
      plot(data, width, height, tx(pts[0].x), ty(pts[0].y));
      continue;
    }
    for (let i = 1; i < pts.length; i++) {
      drawLine(
        data,
        width,
        height,
        tx(pts[i - 1].x),
        ty(pts[i - 1].y),
        tx(pts[i].x),
        ty(pts[i].y),
      );
    }
  }

  return { data, width, height };
};
