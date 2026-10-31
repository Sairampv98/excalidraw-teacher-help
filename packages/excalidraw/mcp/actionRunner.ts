/**
 * Running an editor action on a set of elements, as the properties panel does
 * (D-402): the panel's controls work on the **selection**, so the elements the
 * assistant names are treated as the selection for the length of the action, and
 * the person's own selection is put back afterwards.
 *
 * Several actions in one call are chained on the same elements, then applied
 * once - one change of the scene, so one undo step (D-399).
 */

import { CaptureUpdateAction } from "@excalidraw/element";

import type { OrderedExcalidrawElement } from "@excalidraw/element/types";

import { fail } from "./common";

import type { McpApp } from "./common";
import type { Action, ActionResult } from "../actions/types";
import type { AppState } from "../types";

export type McpActionStep = { action: Action; value: unknown };

/** the keys of the app state that the panel keeps as the style of the next elements */
const isCurrentItemKey = (key: string) => key.startsWith("currentItem");

/** the part of what an action gives back that is the person's selection */
const SELECTION_KEYS = [
  "selectedElementIds",
  "selectedGroupIds",
  "editingGroupId",
  "selectedLinearElement",
] as const;

export const applyActionsToIds = async (
  app: McpApp,
  ids: readonly string[],
  steps: readonly McpActionStep[],
  {
    keepSelection = true,
    keepDefaults = true,
  }: { keepSelection?: boolean; keepDefaults?: boolean } = {},
) => {
  const before = app.state;
  const virtual: AppState = {
    ...before,
    selectedElementIds: Object.fromEntries(
      ids.map((id) => [id, true as const]),
    ),
    selectedGroupIds: {},
    editingGroupId: null,
    selectedLinearElement: null,
  };

  let elements: readonly OrderedExcalidrawElement[] =
    app.scene.getElementsIncludingDeleted();
  let state: AppState = virtual;

  for (const { action, value } of steps) {
    const result = (await action.perform(
      elements,
      state,
      value,
      app,
    )) as ActionResult;

    if (!result) {
      return fail("failed", `${action.name} did nothing.`);
    }

    if (result.elements) {
      elements = result.elements as readonly OrderedExcalidrawElement[];
    }

    if (result.appState) {
      state = { ...state, ...result.appState } as AppState;
    }
  }

  const appState: Partial<AppState> = { ...state };

  if (keepSelection) {
    for (const key of SELECTION_KEYS) {
      (appState as Record<string, unknown>)[key] = before[key];
    }
  }

  if (keepDefaults) {
    for (const key of Object.keys(appState)) {
      if (isCurrentItemKey(key)) {
        (appState as Record<string, unknown>)[key] = (
          before as unknown as Record<string, unknown>
        )[key];
      }
    }
  }

  app.syncActionResult({
    elements,
    appState: appState as AppState,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};
