/**
 * The step order of a flowchart, read out of the drawing.
 *
 * A flowchart on an Excalidraw canvas is ordinary shapes and ordinary arrows, so
 * the flow has to be *read* out of them:
 *
 * - an **arrow** that is in the selection and whose start and end are bound to
 *   two of the selected shapes says "these two shapes are consecutive". The
 *   bindings live on the arrow (`startBinding` / `endBinding`), so the arrow is
 *   the edge and the shapes are the nodes;
 * - the order is a **topological sort** over those edges;
 * - where the arrows do not decide, the tie is broken by the **reading order**:
 *   a row band, then left to right;
 * - a **cycle** is not an error — the loop is part of the animation — so it is
 *   broken at its lowest-reading-order member and the flow carries on.
 *
 * Everything here is a pure function over elements, so the order can be tested
 * without a canvas.
 */

import {
  getCommonBounds,
  isLinearElement,
  isTextElement,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawLinearElement,
} from "@excalidraw/element/types";

/** An axis-aligned box in scene coordinates. */
export type FlowBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * A step of the flow.
 *
 * A step is a **container**, not a shape (D-60): `getTargetElements` folds the
 * bound text into the selection, so a labelled box arrives as *two* entries.
 * The step is the container and its label together, and the resolver dedupes on
 * the container rather than trusting `targetElements.length`.
 */
export type FlowStep = {
  /** the container's id — the step's identity */
  containerId: string;
  /** the container and every element bound to it */
  elementIds: string[];
  /** the step's box: the union of the container's and its label's */
  box: FlowBox;
};

/** An arrow that says "these two steps are consecutive". */
export type FlowEdge = {
  from: string;
  to: string;
};

export type FlowGraph = {
  /** the steps, in the order the animation walks them */
  steps: FlowStep[];
  /** the edges the arrows gave us */
  edges: FlowEdge[];
};

/** An item the reading order sorts. */
export type FlowReadingItem = {
  id: string;
  box: FlowBox;
};

/**
 * The container a target element belongs to, if it has one.
 *
 * Only a text element bound to a container has one. The container is what the
 * step is; the text is part of it (D-60).
 */
const getBoundContainer = (
  element: ExcalidrawElement,
  elementsMap: ElementsMap,
): ExcalidrawElement | null => {
  if (!isTextElement(element) || !element.containerId) {
    return null;
  }

  return elementsMap.get(element.containerId) ?? null;
};

/**
 * The reading order of a set of steps: a **row band**, then left to right.
 *
 * Two shapes are in the same band when their vertical spans **overlap** — the
 * band test is an overlap, not a tolerance, so there is no magic pixel: a
 * shape that lies entirely below another is in a later band, and a shape that
 * straddles two bands joins the band it overlaps most. The bands themselves are
 * ordered top to bottom.
 */
export const sortByReadingOrder = (
  items: readonly FlowReadingItem[],
): FlowReadingItem[] => {
  const sorted = [...items].sort(
    (a, b) => a.box.y - b.box.y || a.box.x - b.box.x,
  );

  const bands: { items: FlowReadingItem[]; top: number; bottom: number }[] = [];

  for (const item of sorted) {
    const itemBottom = item.box.y + item.box.height;

    let band: typeof bands[number] | null = null;
    let bestOverlap = 0;

    for (const candidate of bands) {
      const overlap =
        Math.min(itemBottom, candidate.bottom) -
        Math.max(item.box.y, candidate.top);

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        band = candidate;
      }
    }

    if (band) {
      band.items.push(item);
      band.top = Math.min(band.top, item.box.y);
      band.bottom = Math.max(band.bottom, itemBottom);
    } else {
      bands.push({ items: [item], top: item.box.y, bottom: itemBottom });
    }
  }

  const result: FlowReadingItem[] = [];

  for (const band of bands) {
    band.items.sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y);
    result.push(...band.items);
  }

  return result;
};

/**
 * The step order: a topological sort over the arrow edges, with the reading
 * order as the tie-break.
 *
 * A **cycle is broken, not refused** (D-62): the owner's own words are "this
 * entire thing is in a loop", so when no step is left with an unresolved
 * predecessor, the cycle is broken at its lowest-reading-order member and the
 * flow carries on from there.
 */
export const orderFlowSteps = (
  ids: readonly string[],
  edges: readonly FlowEdge[],
  readingIndex: ReadonlyMap<string, number>,
): string[] => {
  const successors = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const id of ids) {
    successors.set(id, []);
    inDegree.set(id, 0);
  }

  for (const edge of edges) {
    if (!successors.has(edge.from) || !successors.has(edge.to)) {
      continue;
    }

    successors.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const remaining = new Set(ids);
  const order: string[] = [];

  while (remaining.size) {
    let next: string | null = null;

    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) !== 0) {
        continue;
      }

      if (
        next === null ||
        (readingIndex.get(id) ?? 0) < (readingIndex.get(next) ?? 0)
      ) {
        next = id;
      }
    }

    if (next === null) {
      // a cycle: break it at its lowest-reading-order member
      next = [...remaining].sort(
        (a, b) => (readingIndex.get(a) ?? 0) - (readingIndex.get(b) ?? 0),
      )[0];
    }

    remaining.delete(next);
    order.push(next);

    for (const successor of successors.get(next) ?? []) {
      inDegree.set(successor, (inDegree.get(successor) ?? 1) - 1);
    }
  }

  return order;
};

/**
 * Reads the flow out of a selection.
 *
 * `targetElements` is what `getTargetElements` hands over: the selected
 * elements **with their bound text folded in**, so a labelled box arrives as
 * two entries and the steps have to be deduped on the container.
 */
export const buildFlowGraph = (
  targetElements: readonly ExcalidrawElement[],
  elementsMap: ElementsMap,
): FlowGraph => {
  const targetIds = new Set(targetElements.map((element) => element.id));

  const containers = new Map<string, ExcalidrawElement>();
  const members = new Map<string, string[]>();
  const arrows: ExcalidrawLinearElement[] = [];

  const addContainer = (container: ExcalidrawElement) => {
    if (!containers.has(container.id)) {
      containers.set(container.id, container);
      members.set(container.id, [container.id]);
    }
  };

  for (const element of targetElements) {
    const boundContainer = getBoundContainer(element, elementsMap);

    if (boundContainer) {
      // the label of a container: it belongs to that container's step and is
      // not a step of its own (D-60). A label on an arrow is the arrow's.
      if (
        !isLinearElement(boundContainer) &&
        targetIds.has(boundContainer.id)
      ) {
        addContainer(boundContainer);
        members.get(boundContainer.id)!.push(element.id);
      }

      continue;
    }

    if (isLinearElement(element)) {
      arrows.push(element);
      continue;
    }

    addContainer(element);
  }

  const boxes = new Map<string, FlowBox>();

  for (const [containerId, elementIds] of members) {
    const elements = elementIds
      .map((id) => elementsMap.get(id))
      .filter((element): element is ExcalidrawElement => Boolean(element));

    const [minX, minY, maxX, maxY] = getCommonBounds(elements, elementsMap);

    boxes.set(containerId, {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    });
  }

  const reading = sortByReadingOrder(
    [...containers.keys()].map((id) => ({ id, box: boxes.get(id)! })),
  );
  const readingIndex = new Map(reading.map((item, index) => [item.id, index]));

  const edges: FlowEdge[] = [];
  const seen = new Set<string>();

  for (const arrow of arrows) {
    const from = arrow.startBinding?.elementId;
    const to = arrow.endBinding?.elementId;

    if (!from || !to || from === to) {
      continue;
    }

    if (!containers.has(from) || !containers.has(to)) {
      continue;
    }

    // an unambiguous key: two different edges must not share one
    const key = JSON.stringify([from, to]);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    edges.push({ from, to });
  }

  const order = orderFlowSteps([...containers.keys()], edges, readingIndex);

  const steps: FlowStep[] = order.map((containerId) => ({
    containerId,
    elementIds: members.get(containerId) ?? [containerId],
    box: boxes.get(containerId)!,
  }));

  return { steps, edges };
};
