import {
  pointFromPair,
  type GlobalPoint,
  type LocalPoint,
} from "@excalidraw/math";

import type { NullableGridSize } from "@excalidraw/excalidraw/types";

/**
 * The size of the box that bounds `points`.
 *
 * Single pass, in the spirit of `getBoundsFromPoints()` (`@excalidraw/element`):
 * the previous implementation built two intermediate arrays and spread them
 * into `Math.max()`/`Math.min()`, which is two allocations plus four spreads
 * per call — and a spread over a very long array blows the argument limit.
 * The result is bit-for-bit the same as before, including the `-Infinity`
 * an empty array produces.
 */
export const getSizeFromPoints = (
  points: readonly (GlobalPoint | LocalPoint)[],
) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    width: maxX - minX,
    height: maxY - minY,
  };
};

/** @arg dimension, 0 for rescaling only x, 1 for y */
export const rescalePoints = <Point extends GlobalPoint | LocalPoint>(
  dimension: 0 | 1,
  newSize: number,
  points: readonly Point[],
  normalize: boolean,
): Point[] => {
  const coordinates = points.map((point) => point[dimension]);
  const maxCoordinate = Math.max(...coordinates);
  const minCoordinate = Math.min(...coordinates);
  const size = maxCoordinate - minCoordinate;
  const scale = size === 0 ? 1 : newSize / size;

  let nextMinCoordinate = Infinity;

  const scaledPoints = points.map((point): Point => {
    const newCoordinate = point[dimension] * scale;
    const newPoint = [...point];
    newPoint[dimension] = newCoordinate;
    if (newCoordinate < nextMinCoordinate) {
      nextMinCoordinate = newCoordinate;
    }
    return newPoint as Point;
  });

  if (!normalize) {
    return scaledPoints;
  }

  if (scaledPoints.length === 2) {
    // we don't translate two-point lines
    return scaledPoints;
  }

  const translation = minCoordinate - nextMinCoordinate;

  const nextPoints = scaledPoints.map((scaledPoint) =>
    pointFromPair<Point>(
      scaledPoint.map((value, currentDimension) => {
        return currentDimension === dimension ? value + translation : value;
      }) as [number, number],
    ),
  );

  return nextPoints;
};

// TODO: Rounding this point causes some shake when free drawing
export const getGridPoint = (
  x: number,
  y: number,
  gridSize: NullableGridSize,
): [number, number] => {
  if (gridSize) {
    return [
      Math.round(x / gridSize) * gridSize,
      Math.round(y / gridSize) * gridSize,
    ];
  }
  return [x, y];
};
