/**
 * What a chart remembers about how it was made (D-221).
 *
 * A chart is ordinary shapes, text and arrows (D-161). Nothing about that
 * changes: every element the Flow tab makes carries the chart's **id** in its
 * `customData.flow`, and the first shape of the chart carries the **record** -
 * the preset, the script, the fit mode and the node shape - so the chart can be
 * edited later (D-222) and the record is saved with the document.
 *
 * Everything here is pure.
 */

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { readCustomPreset } from "./flowCustomPresets";
import { ALL_FLOW_PRESET_IDS, FLOW_NODE_SHAPES } from "./flowScript";

import type { FlowGraph } from "./flowOrder";
import type { FlowPresetId } from "./flowScript";

import type { FlowCustomPreset } from "./flowCustomPresets";
import type { FlowChartShape } from "./flowPresets";

/** how a chart that is too big for its page is handled (D-226) */
export type FlowFitMode = "page" | "spread" | "larger";

export const FLOW_FIT_MODES: readonly FlowFitMode[] = [
  "page",
  "spread",
  "larger",
];

export type FlowChartRecord = {
  /** ties the elements of one chart together */
  id: string;
  /** a built-in preset, or the id of a custom one (D-228) */
  preset: string;
  script: string;
  fit: FlowFitMode;
  shape: FlowChartShape;
  /** whether arrows are drawn between the shapes (D-231) */
  arrows: "own" | "none";
  /**
   * The custom preset the chart was made from, by value (D-228): the chart
   * edits and opens on a machine that does not have the preset.
   */
  custom?: FlowCustomPreset;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const flowDataOf = (element: ExcalidrawElement) =>
  isRecord(element.customData?.flow) ? element.customData.flow : null;

/** the id of the chart an element belongs to, if it has one */
export const readChartId = (element: ExcalidrawElement): string | null => {
  const id = flowDataOf(element)?.chartId;

  return typeof id === "string" && id ? id : null;
};

/** a record read defensively from whatever a document holds (D-188) */
export const readChartRecord = (
  element: ExcalidrawElement,
): FlowChartRecord | null => {
  const data = flowDataOf(element);
  const chart = data?.chart;

  if (!isRecord(chart) || typeof data?.chartId !== "string") {
    return null;
  }

  if (typeof chart.preset !== "string" || typeof chart.script !== "string") {
    return null;
  }

  const custom = isRecord(chart.custom) ? readCustomPreset(chart.custom) : null;

  return {
    id: data.chartId,
    preset: chart.preset,
    script: chart.script,
    ...(custom?.ok
      ? {
          custom: {
            ...custom.preset,
            id: String(
              chart.custom && (chart.custom as Record<string, unknown>).id,
            ),
          },
        }
      : {}),
    arrows: chart.arrows === "none" ? "none" : "own",
    fit: FLOW_FIT_MODES.includes(chart.fit as FlowFitMode)
      ? (chart.fit as FlowFitMode)
      : "page",
    shape:
      chart.shape === "own" ||
      FLOW_NODE_SHAPES.includes(chart.shape as typeof FLOW_NODE_SHAPES[number])
        ? (chart.shape as FlowChartShape)
        : "own",
  };
};

/** a preset that is one of the built-in kinds: the seven and the gallery */
export const isBuiltInPreset = (preset: string): preset is FlowPresetId =>
  (ALL_FLOW_PRESET_IDS as readonly string[]).includes(preset);

/** the elements of a chart, not deleted, in the order the document holds them */
export const chartElementsOf = (
  chartId: string,
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] =>
  elements.filter(
    (element) => !element.isDeleted && readChartId(element) === chartId,
  );

/** the record of the chart an element belongs to, wherever in the chart it is */
export const chartRecordOf = (
  element: ExcalidrawElement,
  elements: readonly ExcalidrawElement[],
): FlowChartRecord | null => {
  const id = readChartId(element);

  if (!id) {
    return null;
  }

  for (const candidate of chartElementsOf(id, elements)) {
    const record = readChartRecord(candidate);

    if (record) {
      return record;
    }
  }

  return null;
};

/**
 * Puts the chart's id on every element a chart is made of, and its record on
 * the first shape. Nothing else of an element changes.
 */
export const stampChart = (
  elements: readonly ExcalidrawElement[],
  record: FlowChartRecord,
): ExcalidrawElement[] => {
  let recorded = false;

  return elements.map((element) => {
    const flow = flowDataOf(element);

    if (!flow) {
      return element;
    }

    const isFirstShape =
      !recorded &&
      flow.role === "node" &&
      element.type !== "arrow" &&
      element.type !== "text";

    if (isFirstShape) {
      recorded = true;
    }

    return {
      ...element,
      customData: {
        ...element.customData,
        flow: {
          ...flow,
          chartId: record.id,
          ...(isFirstShape
            ? {
                chart: {
                  preset: record.preset,
                  script: record.script,
                  fit: record.fit,
                  shape: record.shape,
                  arrows: record.arrows,
                  ...(record.custom ? { custom: record.custom } : {}),
                },
              }
            : {}),
        },
      },
    };
  });
};

/* ------------------------------------------------------- a chart without a record */

/** the label of a step: the words of the text bound to its container */
const labelOfStep = (
  containerId: string,
  elementsMap: ReadonlyMap<string, ExcalidrawElement>,
) => {
  const container = elementsMap.get(containerId);

  for (const bound of container?.boundElements ?? []) {
    const text = elementsMap.get(bound.id);

    if (text && text.type === "text" && !text.isDeleted) {
      return (text.originalText ?? text.text).replace(/\s*\n\s*/g, " ").trim();
    }
  }

  return "";
};

/**
 * A script rebuilt from what is on the page, for a chart made before charts
 * remembered theirs (D-221): one line for each node, in step order, as a
 * process or a cycle when that is what the arrows make, and as \`A -> B\` lines
 * for anything else. The teacher can change the preset.
 */
export const rebuildFlowScript = (
  graph: FlowGraph,
  elementsMap: ReadonlyMap<string, ExcalidrawElement>,
): { preset: FlowPresetId; script: string } => {
  const labels = new Map<string, string>();

  for (const step of graph.steps) {
    labels.set(
      step.containerId,
      labelOfStep(step.containerId, elementsMap) || "Step",
    );
  }

  const order = graph.steps.map((step) => step.containerId);
  const out = new Map<string, number>();
  const into = new Map<string, number>();

  for (const edge of graph.edges) {
    out.set(edge.from, (out.get(edge.from) ?? 0) + 1);
    into.set(edge.to, (into.get(edge.to) ?? 0) + 1);
  }

  const simple = graph.edges.every(
    (edge) => (out.get(edge.from) ?? 0) <= 1 && (into.get(edge.to) ?? 0) <= 1,
  );
  const unique =
    new Set(order.map((id) => labels.get(id))).size === order.length;

  // a run of steps, each joined to the next, is a process; one that returns to
  // its first step is a cycle
  if (simple && unique && order.length > 0) {
    const consecutive = order
      .slice(0, -1)
      .every((id, i) =>
        graph.edges.some((e) => e.from === id && e.to === order[i + 1]),
      );
    const closes = graph.edges.some(
      (e) => e.from === order[order.length - 1] && e.to === order[0],
    );
    const expected = order.length - 1 + (closes && order.length > 1 ? 1 : 0);

    if (consecutive && graph.edges.length === expected) {
      return {
        preset: closes && order.length > 1 ? "cycle" : "process",
        script: order.map((id) => labels.get(id)).join("\n"),
      };
    }
  }

  // anything else: the arrows, as they are
  const lines: string[] = [];
  const joined = new Set<string>();

  for (const edge of graph.edges) {
    joined.add(edge.from);
    joined.add(edge.to);
    lines.push(`${labels.get(edge.from)} -> ${labels.get(edge.to)}`);
  }

  for (const id of order) {
    if (!joined.has(id)) {
      lines.push(labels.get(id)!);
    }
  }

  return { preset: "network", script: lines.join("\n") };
};
