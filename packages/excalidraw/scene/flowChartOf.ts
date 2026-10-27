/**
 * Which chart an element belongs to, and what it was made from (D-221, D-222).
 *
 * A chart made after charts remembered how has an id on every element and a
 * record on its first shape. An older one has neither: its script is rebuilt
 * from what is on the page, and the elements it is made of are named from the
 * flow the element belongs to (D-180).
 *
 * Everything here is pure.
 */

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  chartElementsOf,
  chartRecordOf,
  readChartId,
  rebuildFlowScript,
} from "./flowChart";
import { flowOfSelection } from "./flowSelection";

import type { FlowChartRecord } from "./flowChart";
import type { FlowBox } from "./flowOrder";

export type ResolvedChart = {
  /** the chart's id: its own, or one to give it when it is first applied */
  chartId: string;
  /** what the chart is made from: remembered, or rebuilt from the page */
  record: FlowChartRecord;
  /** the chart was made before charts remembered how (D-221) */
  legacy: boolean;
  /** for a legacy chart: the elements it is made of, named by the flow */
  legacyElementIds: string[];
  /** a key that stays the same for the chart for as long as it is on the page */
  key: string;
  /** the box of the whole chart, in scene units */
  box: FlowBox;
};

const boxOfElements = (elements: readonly ExcalidrawElement[]): FlowBox => {
  const left = Math.min(...elements.map((e) => e.x));
  const top = Math.min(...elements.map((e) => e.y));
  const right = Math.max(...elements.map((e) => e.x + e.width));
  const bottom = Math.max(...elements.map((e) => e.y + e.height));

  return { x: left, y: top, width: right - left, height: bottom - top };
};

/**
 * The chart an element belongs to, or `null` when it belongs to none. `newId`
 * gives the id a legacy chart will have once it is applied.
 */
export const resolveChart = (
  anchor: ExcalidrawElement,
  elements: readonly ExcalidrawElement[],
  elementsMap: ReadonlyMap<string, ExcalidrawElement>,
  newId: () => string,
): ResolvedChart | null => {
  const chartId = readChartId(anchor);

  if (chartId) {
    const members = chartElementsOf(chartId, elements);
    const record = chartRecordOf(anchor, elements);

    if (record && members.length > 0) {
      return {
        chartId,
        record,
        legacy: false,
        legacyElementIds: [],
        key: chartId,
        box: boxOfElements(members),
      };
    }
  }

  // a chart without a record: its flow is what is on the page
  const graph = flowOfSelection(
    { [anchor.id]: true },
    elements,
    elementsMap as Map<string, ExcalidrawElement>,
  );

  if (!graph || graph.steps.length === 0) {
    return null;
  }

  const rebuilt = rebuildFlowScript(graph, elementsMap);
  const ids = new Set<string>();

  for (const step of graph.steps) {
    step.elementIds.forEach((id) => ids.add(id));
  }

  for (const edge of graph.edgeArrows) {
    ids.add(edge.arrowId);

    for (const bound of elementsMap.get(edge.arrowId)?.boundElements ?? []) {
      ids.add(bound.id);
    }
  }

  const members = [...ids]
    .map((id) => elementsMap.get(id))
    .filter((element): element is ExcalidrawElement => !!element);

  return {
    chartId: newId(),
    record: {
      id: "",
      preset: rebuilt.preset,
      script: rebuilt.script,
      fit: "page",
      shape: "own",
    },
    legacy: true,
    legacyElementIds: [...ids],
    // the first step stays the first step: the chart is found again by it
    key: `legacy-${graph.steps[0].containerId}`,
    box: boxOfElements(members),
  };
};
