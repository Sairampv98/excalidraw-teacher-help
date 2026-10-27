/**
 * The auto-layout of a flowchart, and putting it back.
 *
 * The layout is an **ordinary, undoable scene mutation**: it moves the selected
 * shapes, so it calls `updateBoundElements` for every element it moved — the
 * bound arrows have to follow, or the flowchart falls apart — and it captures
 * the update immediately. It creates no elements, so it needs no
 * `reconcileElements`.
 *
 * It **never changes the size of a shape or of its text** (D-174): only where
 * the shapes are, and the gaps between them, which follow the chart's own scale
 * (D-175) so that a chart resized up is not laid out with the gaps of a small
 * one. The first time a chart is laid out, every shape's position is
 * remembered on the shape; **reset layout** goes back to that.
 */

import {
  CaptureUpdateAction,
  getCommonBounds,
  isArrowElement,
  updateBoundElements,
  updateFrameMembershipOfSelectedElements,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { buildFlowGraph } from "../scene/flowOrder";
import {
  NODE_SEPARATION,
  RANK_SEPARATION,
  layoutFlow,
} from "../scene/flowLayout";
import { chartScaleOf } from "../scene/flowScale";
import { flowOfSelection as connectedFlow } from "../scene/flowSelection";

import { register } from "./register";

import type { FlowGraph } from "../scene/flowOrder";
import type { AppClassProperties, AppState } from "../types";

type Home = { x: number; y: number };

/** where a shape was the first time its chart was laid out, if it was */
export const readFlowHome = (element: ExcalidrawElement): Home | null => {
  const home = element.customData?.flow?.home;

  return home && Number.isFinite(home.x) && Number.isFinite(home.y)
    ? { x: home.x, y: home.y }
    : null;
};

/**
 * The flowchart the selection belongs to: one shape or arrow is enough, and the
 * whole connected flow is what is laid out (D-180).
 */
const flowOfSelection = (appState: AppState, app: AppClassProperties) => {
  const elementsMap = app.scene.getNonDeletedElementsMap();

  return {
    elementsMap,
    graph:
      connectedFlow(
        appState.selectedElementIds,
        app.scene.getNonDeletedElements(),
        elementsMap,
      ) ?? buildFlowGraph([], elementsMap),
  };
};

/** the layout needs at least two steps: one shape is not a flowchart */
export const flowLayoutPredicate = (
  appState: AppState,
  app: AppClassProperties,
) => flowOfSelection(appState, app).graph.steps.length > 1;

/** reset is offered for a chart that has a remembered layout */
export const flowResetLayoutPredicate = (
  appState: AppState,
  app: AppClassProperties,
) => {
  const { elementsMap, graph } = flowOfSelection(appState, app);

  return graph.steps.some((step) => {
    const container = elementsMap.get(step.containerId);

    return !!container && !!readFlowHome(container);
  });
};

/**
 * An arrow made by the studio before the arrows' size was set says it is zero
 * wide, and a resize scales its points by that: the arrow is scaled to nothing.
 * Its points are the truth, so its size is put right here.
 */
const repairArrowSizes = (
  graph: FlowGraph,
  app: AppClassProperties,
  updated: Map<string, ExcalidrawElement>,
) => {
  for (const { arrowId } of graph.edgeArrows) {
    const arrow = app.scene.getElement(arrowId);

    if (
      !arrow ||
      !isArrowElement(arrow) ||
      arrow.width !== 0 ||
      arrow.height !== 0
    ) {
      continue;
    }

    const xs = arrow.points.map((point) => point[0]);
    const ys = arrow.points.map((point) => point[1]);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);

    if (width || height) {
      updated.set(arrow.id, app.scene.mutateElement(arrow, { width, height }));
    }
  }
};

/** moves each step's container, with its label, to a position */
const moveSteps = (
  graph: FlowGraph,
  positions: Map<string, Home>,
  app: AppClassProperties,
  updated: Map<string, ExcalidrawElement>,
) => {
  for (const step of graph.steps) {
    const container = app.scene.getElement(step.containerId);
    const position = positions.get(step.containerId);

    if (!container || !position) {
      continue;
    }

    const dx = position.x - container.x;
    const dy = position.y - container.y;

    // the container and its label move together
    const stepElements = step.elementIds
      .map((id) => app.scene.getElement(id))
      .filter((element): element is NonDeletedExcalidrawElement =>
        Boolean(element),
      );

    for (const element of stepElements) {
      updated.set(
        element.id,
        app.scene.mutateElement(element, {
          x: element.x + dx,
          y: element.y + dy,
        }),
      );

      // the bound arrows have to follow, or the flowchart falls apart
      updateBoundElements(element, app.scene, {
        simultaneouslyUpdated: stepElements,
      });
    }
  }
};

const result = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  app: AppClassProperties,
  updated: Map<string, ExcalidrawElement>,
) => ({
  appState,
  elements: updateFrameMembershipOfSelectedElements(
    elements.map((element) => updated.get(element.id) ?? element),
    appState,
    app,
  ),
  captureUpdate: CaptureUpdateAction.IMMEDIATELY,
});

export const actionFlowLayout = register({
  name: "flowLayout",
  label: "labels.flowAnimationLayout",
  trackEvent: { category: "element" },
  predicate: (elements, appState, appProps, app) =>
    flowLayoutPredicate(appState, app),
  perform: (elements, appState, _, app) => {
    const { elementsMap, graph } = flowOfSelection(appState, app);

    if (graph.steps.length < 2) {
      return false;
    }

    const containers = graph.steps
      .map((step) =>
        app.scene.getElement<NonDeletedExcalidrawElement>(step.containerId),
      )
      .filter((element): element is NonDeletedExcalidrawElement =>
        Boolean(element),
      );

    // the layout keeps the flowchart where the user drew it: the laid-out
    // group's top-left is the selection's own top-left
    const [minX, minY] = getCommonBounds(containers, elementsMap);
    const scale = chartScaleOf(graph, elementsMap);

    const { positions } = layoutFlow(
      graph.steps.map((step) => ({ id: step.containerId, box: step.box })),
      graph.edges,
      { x: minX, y: minY },
      {
        // the gaps follow the chart's own size, the shapes are left as they are
        nodeSeparation: NODE_SEPARATION * scale,
        rankSeparation: RANK_SEPARATION * scale,
      },
    );

    const updated = new Map<string, ExcalidrawElement>();

    // the first position is the one reset goes back to, so it is written once
    for (const container of containers) {
      if (!readFlowHome(container)) {
        updated.set(
          container.id,
          app.scene.mutateElement(container, {
            customData: {
              ...container.customData,
              flow: {
                ...container.customData?.flow,
                home: { x: container.x, y: container.y },
              },
            },
          }),
        );
      }
    }

    repairArrowSizes(graph, app, updated);
    moveSteps(graph, positions, app, updated);

    return result(elements, appState, app, updated);
  },
});

export const actionFlowResetLayout = register({
  name: "flowResetLayout",
  label: "labels.flowAnimationResetLayout",
  trackEvent: { category: "element" },
  predicate: (elements, appState, appProps, app) =>
    flowResetLayoutPredicate(appState, app),
  perform: (elements, appState, _, app) => {
    const { graph } = flowOfSelection(appState, app);

    const homes = new Map<string, Home>();

    for (const step of graph.steps) {
      const container = app.scene.getElement(step.containerId);
      const home = container && readFlowHome(container);

      if (home) {
        homes.set(step.containerId, home);
      }
    }

    if (!homes.size) {
      return false;
    }

    const updated = new Map<string, ExcalidrawElement>();

    moveSteps(graph, homes, app, updated);

    return result(elements, appState, app, updated);
  },
});
