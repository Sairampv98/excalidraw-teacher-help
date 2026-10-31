/**
 * What of the page an exported animation shows (D-374): the chart that is
 * animated - its steps, the arrows between them and their labels, and every
 * element the chart was made with - and nothing of what lies next to it on the
 * page. The box of those elements is the box the picture frames.
 */

import { getCommonBounds, isTextElement } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { readChartId } from "../flowChart";

import type { FlowBox, FlowGraph, FlowStep } from "../flowOrder";

export type FlowExportChart = {
  elements: ExcalidrawElement[];
  box: FlowBox;
};

export const chartToExport = (
  graph: FlowGraph,
  steps: readonly FlowStep[],
  elements: readonly ExcalidrawElement[],
): FlowExportChart | null => {
  const ids = new Set<string>();

  for (const step of steps) {
    for (const id of step.elementIds) {
      ids.add(id);
    }
  }

  for (const edge of graph.edgeArrows) {
    ids.add(edge.arrowId);
  }

  // a chart made by the studio knows all of its own elements: the stems of a
  // timeline, the lanes of a matrix, the pictures in its nodes
  const chartIds = new Set<string>();

  for (const step of steps) {
    const container = elements.find(
      (element) => element.id === step.containerId,
    );
    const chartId = container ? readChartId(container) : null;

    if (chartId) {
      chartIds.add(chartId);
    }
  }

  const parts = new Map<string, ExcalidrawElement>();

  for (const element of elements) {
    if (element.isDeleted) {
      continue;
    }

    const chartId = readChartId(element);

    if (
      ids.has(element.id) ||
      (chartId && chartIds.has(chartId)) ||
      // the label of an arrow is a text bound to it
      (isTextElement(element) &&
        element.containerId &&
        ids.has(element.containerId))
    ) {
      parts.set(element.id, element);
    }
  }

  const list = [...parts.values()];

  if (list.length === 0) {
    return null;
  }

  const [minX, minY, maxX, maxY] = getCommonBounds(list);

  return {
    elements: list,
    box: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
};
