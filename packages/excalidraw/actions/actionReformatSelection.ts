import { CaptureUpdateAction } from "@excalidraw/element";

import type { Action } from "./types";

/**
 * "Reformat as…" — hands the current selection over to the host app.
 *
 * The library cannot reformat anything itself: turning a selection into a
 * syntax-highlighted code card needs the host app's own highlighter, and
 * turning it into a table needs the host app's own table builder. So the
 * library only owns the *offer* — the context menu entry — and the app owns
 * the work. This is the same extension pattern the other host-app hooks use
 * (`onPaste`, `onDuplicate`, `onLibraryChange`).
 *
 * The entry only appears when the selection holds at least one text element,
 * and only when the host app actually handles the hook.
 */
export const actionReformatSelection: Action = {
  name: "reformatSelection",
  label: "labels.reformatSelection",
  trackEvent: { category: "element" },
  perform: (elements, appState, _formData, app) => {
    const selectedElements = app.scene.getSelectedElements({
      selectedElementIds: appState.selectedElementIds,
    });

    app.props.onReformatSelection?.({ selectedElements, appState });

    return {
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  predicate: (elements, appState, appProps) => {
    if (!appProps.onReformatSelection) {
      return false;
    }

    // only a selection that holds text can be reformatted
    return elements.some(
      (element) =>
        element.type === "text" && !!appState.selectedElementIds[element.id],
    );
  },
};
