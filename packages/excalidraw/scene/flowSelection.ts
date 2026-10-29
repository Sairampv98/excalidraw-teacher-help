/**
 * The flow a selection belongs to (D-180).
 *
 * The teacher does not have to select a whole chart to animate it: one shape or
 * one arrow is enough, and what is animated, laid out and reset is **the whole
 * connected flow** that element belongs to - the shapes, the arrows that join
 * them and the labels bound to either.
 *
 * "Connected" is read from the bindings and nothing else, so it is the same
 * thing the step order is built from (`buildFlowGraph`): two charts that no
 * arrow joins are two flows, whatever is selected.
 */

import { captionOf, mediaOf } from "@excalidraw/element";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import { buildFlowGraph } from "./flowOrder";

import type { FlowGraph } from "./flowOrder";

/** the root of the group an id is in; the groups are merged by `join` */
const makeGroups = () => {
  const parent = new Map<string, string>();

  const find = (id: string): string => {
    let root = id;

    while (parent.has(root) && parent.get(root) !== root) {
      root = parent.get(root)!;
    }

    // keep the chain short for the next lookup
    let step = id;

    while (step !== root) {
      const next = parent.get(step)!;

      parent.set(step, root);
      step = next;
    }

    return root;
  };

  const join = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };

  return { find, join };
};

/**
 * The shapes of a chart that has no arrows are **one flow** (D-231): nothing joins
 * them, so the chart they were made in is what does, and they are walked in
 * reading order. A chart that has arrows is read from its arrows alone, as ever.
 */
const joinArrowlessCharts = (
  live: readonly ExcalidrawElement[],
  join: (a: string, b: string) => void,
) => {
  const chartOf = (element: ExcalidrawElement) => {
    const id = element.customData?.flow?.chartId;

    return typeof id === "string" ? id : null;
  };

  const joined = new Set<string>();

  for (const element of live) {
    if (element.type === "arrow" && element.customData?.flow?.role === "edge") {
      const id = chartOf(element);

      if (id) {
        joined.add(id);
      }
    }
  }

  const first = new Map<string, string>();

  for (const element of live) {
    const id = chartOf(element);

    if (!id || joined.has(id)) {
      continue;
    }

    if (first.has(id)) {
      join(element.id, first.get(id)!);
    } else {
      first.set(id, element.id);
    }
  }
};

/**
 * The flow that the selected element belongs to, or `null` when it is in none:
 * a shape no arrow touches, and a flow of a single step, are not flows.
 */
export const flowOfSelection = (
  selectedElementIds: Readonly<Record<string, boolean>>,
  elements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
): FlowGraph | null => {
  const selected = Object.keys(selectedElementIds).filter(
    (id) => selectedElementIds[id],
  );

  if (!selected.length) {
    return null;
  }

  const { find, join } = makeGroups();
  const live = elements.filter((element) => !element.isDeleted);

  for (const element of live) {
    // a label belongs to what it is bound to
    if (element.type === "text" && element.containerId) {
      join(element.id, element.containerId);
    }

    // the media of a node belongs to the node (D-246), and so does its caption (D-248)
    const media = mediaOf(element);

    if (media) {
      join(element.id, media.of);
    }

    const caption = element.type === "text" ? captionOf(element) : null;

    if (caption) {
      join(element.id, caption.of);
    }

    // an arrow belongs to the shapes at its two ends
    if (element.type === "arrow") {
      if (element.startBinding) {
        join(element.id, element.startBinding.elementId);
      }

      if (element.endBinding) {
        join(element.id, element.endBinding.elementId);
      }
    }
  }

  joinArrowlessCharts(live, join);

  // the first selected element whose flow has at least two steps decides
  const tried = new Set<string>();

  for (const id of selected) {
    const root = find(id);

    if (tried.has(root)) {
      continue;
    }

    tried.add(root);

    const members = live.filter((element) => find(element.id) === root);
    const graph = buildFlowGraph(members, elementsMap);

    if (graph.steps.length > 1) {
      return graph;
    }
  }

  return null;
};

/**
 * Every flow among `elements`: each connected set of shapes, arrows and labels
 * that makes at least two steps. The class view (D-184) plays the marked ones.
 */
export const allFlows = (
  elements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
): FlowGraph[] => {
  const { find, join } = makeGroups();
  const live = elements.filter((element) => !element.isDeleted);

  for (const element of live) {
    if (element.type === "text" && element.containerId) {
      join(element.id, element.containerId);
    }

    // the media of a node belongs to the node (D-246), and so does its caption (D-248)
    const media = mediaOf(element);

    if (media) {
      join(element.id, media.of);
    }

    const caption = element.type === "text" ? captionOf(element) : null;

    if (caption) {
      join(element.id, caption.of);
    }

    if (element.type === "arrow") {
      if (element.startBinding) {
        join(element.id, element.startBinding.elementId);
      }

      if (element.endBinding) {
        join(element.id, element.endBinding.elementId);
      }
    }
  }

  joinArrowlessCharts(live, join);

  const groups = new Map<string, ExcalidrawElement[]>();

  for (const element of live) {
    const root = find(element.id);

    groups.set(root, [...(groups.get(root) ?? []), element]);
  }

  const flows: FlowGraph[] = [];

  for (const members of groups.values()) {
    // a lone shape or a lone arrow cannot be a flow: skip the work for it
    if (members.length < 3) {
      continue;
    }

    const graph = buildFlowGraph(members, elementsMap);

    if (graph.steps.length > 1) {
      flows.push(graph);
    }
  }

  return flows;
};
