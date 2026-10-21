import { newPanelElement, syncInvalidIndices } from "@excalidraw/element";
import {
  codePanelContent,
  codePanelSize,
  emptyCodePanelState,
  stampCurrentPage,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/**
 * Inserts a **code panel** — a live mirror of the teacher's VS Code editor —
 * into the canvas (D-51).
 *
 * The panel is born with a bridge source and no content: it says it is not
 * connected until the teacher pastes the session token, and it never shows a
 * blank editor in the meantime (D-52).
 *
 * The panel is **selected** after it is inserted, because the bridge field
 * lives in the panel's chrome, and the chrome is drawn for the selected panel.
 */

/** The name of the bridge session the panel belongs to. */
export const CODE_PANEL_SESSION_ID = "vscode-bridge";

/**
 * Inserts the code panel at the middle of what the teacher can see.
 *
 * Its size is a **share of the visible canvas**, not a constant (D-80): the
 * owner asked for the editor's view to cover half the canvas, and a fixed
 * 520x380 was a fifth of it.
 */
export const insertCodePanel = (api: ExcalidrawImperativeAPI): void => {
  const appState = api.getAppState();
  const zoom = appState.zoom.value;

  const size = codePanelSize(
    { width: appState.width, height: appState.height },
    zoom,
  );

  const panel = newPanelElement({
    type: "panel",
    x: (appState.width / 2 - appState.scrollX) / zoom - size.width / 2,
    y: (appState.height / 2 - appState.scrollY) / zoom - size.height / 2,
    width: size.width,
    height: size.height,
    panelKind: "code",
    panel: codePanelContent(emptyCodePanelState(), CODE_PANEL_SESSION_ID),
    posterMode: false,
    posterFileId: null,
  });

  stampCurrentPage([panel], appState.currentPageId);

  // A NEW element has no fractional index yet - that is what `index: null`
  // means ("not yet assigned to the scene"). The library assigns the index
  // itself when IT inserts an element (`scene.insertElementsAtIndex` syncs
  // before the scene sees the set), but a host app that adds an element
  // through `updateScene` has to do it itself: the scene validates the
  // indices BEFORE it syncs them, and an element with no index fails that
  // validation. In dev and test that validation throws, and the insert dies
  // with `InvalidFractionalIndexError` - which is what happened the first
  // time a panel was inserted into an empty scene.
  //
  // `syncInvalidIndices` is the library's own function for this: it assigns
  // an index to the elements that do not have one and leaves the ones that
  // already have a valid index alone.
  const elements = syncInvalidIndices([...api.getSceneElements(), panel]);

  api.updateScene({
    elements,
    appState: {
      selectedElementIds: { [panel.id]: true },
    },
  });
};
