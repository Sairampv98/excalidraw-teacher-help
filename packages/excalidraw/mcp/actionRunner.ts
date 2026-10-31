/**
 * Running editor actions as the panels do (D-402, D-403): the properties panel's
 * controls work on the **selection**, and the page panel's on the **open page**,
 * so the elements or the page the assistant names are treated as the selection or
 * the open page for the length of the action, and what the person had is put back
 * afterwards.
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

export const applyActions = async (
  app: McpApp,
  steps: readonly McpActionStep[],
  {
    ids,
    groups = false,
    keepSelection = true,
    keepDefaults = true,
  }: {
    /** the elements to act on, as though they were selected */
    ids?: readonly string[];
    /** whole groups are selected, as clicking a member of a group does */
    groups?: boolean;
    /** the person's own selection is put back */
    keepSelection?: boolean;
    /** the style the person's next elements get is left as it was */
    keepDefaults?: boolean;
  } = {},
) => {
  const before = app.state;
  const selected: Record<string, true> = Object.fromEntries(
    (ids ?? []).map((id) => [id, true as const]),
  );
  const selectedGroupIds: Record<string, true> = {};

  if (ids && groups) {
    // the outermost group of each element named, and everything in it
    const live = app.scene.getNonDeletedElements();

    for (const element of live) {
      if (selected[element.id] && element.groupIds.length) {
        selectedGroupIds[element.groupIds[element.groupIds.length - 1]] = true;
      }
    }

    for (const element of live) {
      if (element.groupIds.some((group) => selectedGroupIds[group])) {
        selected[element.id] = true;
      }
    }
  }

  const virtual: AppState = {
    ...before,
    ...(ids
      ? {
          selectedElementIds: selected,
          selectedGroupIds,
          editingGroupId: null,
          selectedLinearElement: null,
        }
      : {}),
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

  if (keepSelection && ids) {
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

/** the elements named are the selection for the action */
export const applyActionsToIds = (
  app: McpApp,
  ids: readonly string[],
  steps: readonly McpActionStep[],
  options: { keepSelection?: boolean; keepDefaults?: boolean } = {},
) => applyActions(app, steps, { ...options, ids });
