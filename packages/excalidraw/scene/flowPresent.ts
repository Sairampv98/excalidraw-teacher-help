/**
 * Presenting a flow step by step (D-167, D-172).
 *
 * While presenting, the flow does not loop: it shows the steps **reached so
 * far**. Where the teacher has been is a **path** - the indices of the steps,
 * in the order they were visited - and the current step is its last. `next`
 * follows the step order, a **choice** at a question follows the branch that was
 * picked, and `previous` walks back along the path.
 *
 * Everything here is a pure function of the path and the graph, so it is tested
 * without a canvas.
 */

import type { FlowGraph, FlowStep } from "./flowOrder";

export type PresentPath = readonly number[];

/** presenting starts at the first step */
export const startPath = (): PresentPath => [0];

export const currentIndex = (path: PresentPath) => path[path.length - 1] ?? 0;

/** one step on, in the step order; at the last step it stays where it is */
export const presentNext = (
  path: PresentPath,
  stepCount: number,
): PresentPath => {
  const next = currentIndex(path) + 1;

  return next < stepCount ? [...path, next] : path;
};

/** one step back along the path; at the first step it stays where it is */
export const presentPrevious = (path: PresentPath): PresentPath =>
  path.length > 1 ? path.slice(0, -1) : path;

/** the branch the teacher picked becomes the next step */
export const presentChoose = (
  path: PresentPath,
  targetIndex: number,
): PresentPath => [...path, targetIndex];

/** the steps shown so far */
export const reachedIndices = (path: PresentPath): ReadonlySet<number> =>
  new Set(path);

const indexOfStep = (graph: FlowGraph, containerId: string) =>
  graph.steps.findIndex((step) => step.containerId === containerId);

/** the steps an arrow leaves the step at `index` for */
export const outgoingIndices = (graph: FlowGraph, index: number): number[] => {
  const step = graph.steps[index];

  if (!step) {
    return [];
  }

  return [
    ...new Set(
      graph.edges
        .filter((edge) => edge.from === step.containerId)
        .map((edge) => indexOfStep(graph, edge.to))
        .filter((to) => to >= 0),
    ),
  ];
};

/**
 * The branches that can be chosen at a step: its targets, when it has **more
 * than one** - a question. A step with one way on has nothing to choose.
 */
export const choicesAt = (graph: FlowGraph, index: number): number[] => {
  const targets = outgoingIndices(graph, index);

  return targets.length >= 2 ? targets : [];
};

/** a step no arrow leaves is an end */
export const isEndStep = (graph: FlowGraph, index: number) =>
  graph.steps[index] !== undefined &&
  outgoingIndices(graph, index).length === 0;

/**
 * The step and every step downstream of it, in the step order - what **play
 * from here** runs. A loop is followed once: a step is never listed twice.
 */
export const downstreamSteps = (
  graph: FlowGraph,
  index: number,
): FlowStep[] => {
  if (!graph.steps[index]) {
    return [];
  }

  const reached = new Set<number>([index]);
  const queue = [index];

  while (queue.length) {
    for (const next of outgoingIndices(graph, queue.shift()!)) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }

  return graph.steps.filter((_, i) => reached.has(i));
};

/** how long an end step's outline takes to draw on, in milliseconds */
export const FLOW_DRAW_ON_MS = 1500;

/**
 * An end step's reveal: the outline is **drawn on** - the part of it still to
 * draw falls from all of it to none - and only **then** is the shape filled.
 */
export const drawOnProgress = (elapsedMs: number) => {
  const drawn = Math.min(Math.max(elapsedMs / FLOW_DRAW_ON_MS, 0), 1);

  return {
    /** the fraction of the outline still to be drawn: 1 at first, 0 when done */
    remaining: 1 - drawn,
    /** the fill appears only once the outline is whole */
    fill: drawn < 1 ? 0 : Math.min((elapsedMs - FLOW_DRAW_ON_MS) / 600, 1),
  };
};
