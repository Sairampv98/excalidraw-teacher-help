/**
 * The auto-layout of a flowchart.
 *
 * The layout is an **ordinary, undoable scene mutation**: it moves the selected
 * shapes, so it calls `updateBoundElements` for every element it moved — the
 * bound arrows have to follow, or the flowchart falls apart — and it captures
 * the update immediately. It creates no elements, so it needs no
 * `reconcileElements`.
 */

import {
  CaptureUpdateAction,
  getCommonBounds,
  getTargetElements,
  updateBoundElements,
  updateFrameMembershipOfSelectedElements,
} from "@excalidraw/element";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { buildFlowGraph } from "../scene/flowOrder";
import { layoutFlow } from "../scene/flowLayout";

import { register } from "./register";

import type { AppClassProperties, AppState } from "../types";

/** the layout needs at least two steps: one shape is not a flowchart */
export const flowLayoutPredicate = (
  appState: AppState,
  app: AppClassProperties,
) => {
  const elementsMap = app.scene.getNonDeletedElementsMap();
  const targetElements = getTargetElements(elementsMap, appState);

  return buildFlowGraph(targetElements, elementsMap).steps.length > 1;
};

export const actionFlowLayout = register({
  name: "flowLayout",
  label: "labels.flowAnimationLayout",
  trackEvent: { category: "element" },
  predicate: (elements, appState, appProps, app) =>
    flowLayoutPredicate(appState, app),
  perform: (elements, appState, _, app) => {
    const elementsMap = app.scene.getNonDeletedElementsMap();
    const targetElements = getTargetElements(elementsMap, appState);
    const graph = buildFlowGraph(targetElements, elementsMap);

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

    const { positions } = layoutFlow(
      graph.steps.map((step) => ({ id: step.containerId, box: step.box })),
      graph.edges,
      { x: minX, y: minY },
    );

    const updated = new Map<string, ExcalidrawElement>();

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

    return {
      appState,
      elements: updateFrameMembershipOfSelectedElements(
        elements.map((element) => updated.get(element.id) ?? element),
        appState,
        app,
      ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
});
