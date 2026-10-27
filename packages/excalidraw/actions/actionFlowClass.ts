/**
 * **Show in class** (D-183): marks a flow for the class view, or takes the mark
 * off.
 *
 * Marking **writes the flow's animation into the document** - as ordinary
 * element data on every step container of the connected flow - so it is saved,
 * exported, copied and undone like anything else. It is the one place an
 * animation is written down, and it only happens when the teacher asks for it.
 */

import { CaptureUpdateAction } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { editorJotaiStore } from "../editor-jotai";
import { withFlowClass } from "../scene/flowClass";
import { flowOfSelection } from "../scene/flowSelection";

import { flowAnimationStateAtom } from "../components/FlowAnimationState";

import { register } from "./register";

import type { FlowClassSettings } from "../scene/flowClass";

export type FlowClassActionData = {
  /** mark the flow, or take the mark off */
  enabled: boolean;
  /**
   * a bar setting changed while the flow is marked: the entry is brought up to
   * date, and it is not a step of its own on the undo stack
   */
  writeThrough?: boolean;
};

/** the bar's settings as the class loop plays them - the camera is not one */
export const currentFlowClassSettings = (): FlowClassSettings => {
  const state = editorJotaiStore.get(flowAnimationStateAtom);

  return {
    node: state.nodeStyle,
    arrow: state.arrowStyle,
    speed: state.speed,
    stepMs: state.durationMs,
    loop: state.loop,
  };
};

export const actionFlowClass = register<FlowClassActionData>({
  name: "flowClass",
  label: "labels.flowAnimationClass",
  trackEvent: { category: "element" },
  perform: (elements, appState, formData, app) => {
    const map = app.scene.getNonDeletedElementsMap();
    const graph = flowOfSelection(
      appState.selectedElementIds,
      app.scene.getNonDeletedElements(),
      map,
    );

    if (!graph || !formData) {
      return false;
    }

    const settings = formData.enabled ? currentFlowClassSettings() : null;
    const updated = new Map<string, ExcalidrawElement>();

    for (const step of graph.steps) {
      const container = app.scene.getElement(step.containerId);

      if (!container) {
        continue;
      }

      updated.set(
        container.id,
        app.scene.mutateElement(container, {
          customData: withFlowClass(container, settings),
        }),
      );
    }

    return {
      appState,
      elements: elements.map((element) => updated.get(element.id) ?? element),
      captureUpdate: formData.writeThrough
        ? CaptureUpdateAction.EVENTUALLY
        : CaptureUpdateAction.IMMEDIATELY,
    };
  },
});
