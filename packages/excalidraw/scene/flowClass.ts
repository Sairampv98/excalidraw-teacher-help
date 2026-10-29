/**
 * The class loop of a flow (D-182 to D-184, D-188).
 *
 * A chart can be **marked for class**: its animation is then saved with it, as
 * ordinary element data on every step container, and the class view plays it
 * by itself. Everything that decides what is marked and what the loop is at a
 * given time is pure and lives here, so it is tested without a canvas or a
 * clock.
 */

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import { FLOW_LOOK_DEFAULTS, readFlowLook } from "./flowLook";
import { allFlows } from "./flowSelection";
import {
  FLOW_ARROW_STYLES,
  FLOW_NODE_STYLES,
  FLOW_SPEED,
  clampFlowSpeed,
} from "./flowStyles";

import type { FlowLook } from "./flowLook";
import type { FlowGraph } from "./flowOrder";
import type { FlowArrowStyle, FlowNodeStyle } from "./flowStyles";

/** what a class loop plays: the bar's settings, minus the camera (D-183) */
export type FlowClassSettings = FlowLook & {
  node: FlowNodeStyle;
  arrow: FlowArrowStyle;
  /** scene units a second, before the chart scale (D-179) */
  speed: number;
  /** how long a step is held, in milliseconds */
  stepMs: number;
  /** whether the loop wraps; if not it plays once and rests on its last step */
  loop: boolean;
};

export const FLOW_CLASS_DEFAULTS: FlowClassSettings = {
  ...FLOW_LOOK_DEFAULTS,
  node: "focus",
  arrow: "none",
  speed: FLOW_SPEED,
  stepMs: 1200,
  loop: true,
};

/** the fastest a step may change, in milliseconds */
const MIN_STEP_MS = 100;

/**
 * The class entry of an element, read defensively (D-188): no entry, or one of
 * the wrong type, is **not marked**; a partial entry takes the defaults for
 * what it lacks.
 */
export const readFlowClass = (
  element: ExcalidrawElement,
): FlowClassSettings | null => {
  const entry = element.customData?.flow?.class;

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  return {
    // an entry from before the look has none of it: the defaults (D-195)
    ...readFlowLook(entry),
    node: FLOW_NODE_STYLES.some((style) => style.id === entry.node)
      ? entry.node
      : FLOW_CLASS_DEFAULTS.node,
    arrow: FLOW_ARROW_STYLES.some((style) => style.id === entry.arrow)
      ? entry.arrow
      : FLOW_CLASS_DEFAULTS.arrow,
    speed: Number.isFinite(entry.speed)
      ? clampFlowSpeed(entry.speed)
      : FLOW_CLASS_DEFAULTS.speed,
    stepMs:
      Number.isFinite(entry.stepMs) && entry.stepMs >= MIN_STEP_MS
        ? entry.stepMs
        : FLOW_CLASS_DEFAULTS.stepMs,
    loop:
      typeof entry.loop === "boolean" ? entry.loop : FLOW_CLASS_DEFAULTS.loop,
  };
};

/** the element's `customData` with the class entry put in, or taken out */
export const withFlowClass = (
  element: ExcalidrawElement,
  settings: FlowClassSettings | null,
): ExcalidrawElement["customData"] => {
  const { class: _removed, ...flow } = element.customData?.flow ?? {};

  return {
    ...element.customData,
    flow: settings ? { ...flow, class: { ...settings } } : flow,
  };
};

/** the settings a flow is marked with, or `null`; the first marked step decides */
export const flowClassOf = (
  graph: FlowGraph,
  elementsMap: ElementsMap,
): FlowClassSettings | null => {
  for (const step of graph.steps) {
    const container = elementsMap.get(step.containerId);
    const settings = container && readFlowClass(container);

    if (settings) {
      return settings;
    }
  }

  return null;
};

/** an identity for a flow that survives a move or a resize: its step ids */
export const flowKeyOf = (graph: FlowGraph) =>
  graph.steps
    .map((step) => step.containerId)
    .sort()
    .join("|");

export type MarkedFlow = {
  key: string;
  graph: FlowGraph;
  settings: FlowClassSettings;
};

/**
 * Every marked flow on the page being shown (D-184). `pageId` is `undefined`
 * when the document has no pages: then all of it is the page.
 */
export const markedFlowsOnPage = (
  elements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
  pageId?: string,
): MarkedFlow[] => {
  const onPage = pageId
    ? elements.filter((element) => element.pageId === pageId)
    : elements;

  const marked: MarkedFlow[] = [];

  for (const graph of allFlows(onPage, elementsMap)) {
    const settings = flowClassOf(graph, elementsMap);

    if (settings) {
      marked.push({ key: flowKeyOf(graph), graph, settings });
    }
  }

  return marked;
};

/**
 * Which step a class loop is on `elapsedMs` after it started: the steps follow
 * each other every `stepMs`, the loop wraps, and a flow whose loop is off plays
 * once and **rests on its last step** (D-184).
 */
export const classStepAt = ({
  elapsedMs,
  stepCount,
  stepMs,
  loop,
}: {
  elapsedMs: number;
  stepCount: number;
  stepMs: number;
  loop: boolean;
}) => {
  if (stepCount <= 0) {
    return { index: 0, resting: true };
  }

  const raw = Math.max(0, Math.floor(elapsedMs / Math.max(stepMs, 1)));

  if (loop) {
    return { index: raw % stepCount, resting: false };
  }

  return {
    index: Math.min(raw, stepCount - 1),
    resting: raw >= stepCount - 1,
  };
};
