/**
 * How big a chart is, as one number (D-175).
 *
 * The animation's marks and the layout's gaps are drawn in scene units, and a
 * chart is not always the size the presets made it: a hundred nodes are shrunk
 * to the font-size floor, and the teacher may have resized one up. Both want to
 * follow the chart, so the **chart scale** is the chart's own text size - the
 * median of its labels' font sizes - over the size the presets start from.
 *
 * It is read from the elements each time, never stored, so it follows a resize
 * at once, and it does not depend on the zoom: the zoom changes how the scene is
 * seen, not the scene.
 */

import type { ElementsMap } from "@excalidraw/element/types";

import { BASE_FLOW_FONT_SIZE } from "./flowPresets";

import type { FlowGraph } from "./flowOrder";

/** a chart is never drawn with marks smaller than half... */
export const FLOW_SCALE_MIN = 0.5;
/** ...or larger than four times the base size */
export const FLOW_SCALE_MAX = 4;

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** the scale for a set of label font sizes; a chart with no label is 1 */
export const chartScaleFromFontSizes = (fontSizes: readonly number[]) => {
  if (!fontSizes.length) {
    return 1;
  }

  return Math.min(
    Math.max(median(fontSizes) / BASE_FLOW_FONT_SIZE, FLOW_SCALE_MIN),
    FLOW_SCALE_MAX,
  );
};

/** the scale of the chart a graph describes, read from its labels */
export const chartScaleOf = (graph: FlowGraph, elementsMap: ElementsMap) => {
  const fontSizes: number[] = [];

  for (const step of graph.steps) {
    for (const id of step.elementIds) {
      const element = elementsMap.get(id);

      if (element?.type === "text") {
        fontSizes.push(element.fontSize);
      }
    }
  }

  return chartScaleFromFontSizes(fontSizes);
};
