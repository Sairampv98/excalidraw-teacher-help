import { newPanelElement } from "@excalidraw/element";
import {
  codePanelContent,
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

/** The panel's size on the canvas, in scene units. */
export const CODE_PANEL_WIDTH = 520;
export const CODE_PANEL_HEIGHT = 380;

/**
 * Inserts the code panel at the middle of what the teacher can see.
 */
export const insertCodePanel = (api: ExcalidrawImperativeAPI): void => {
  const appState = api.getAppState();
  const zoom = appState.zoom.value;

  const panel = newPanelElement({
    type: "panel",
    x: (appState.width / 2 - appState.scrollX) / zoom - CODE_PANEL_WIDTH / 2,
    y: (appState.height / 2 - appState.scrollY) / zoom - CODE_PANEL_HEIGHT / 2,
    width: CODE_PANEL_WIDTH,
    height: CODE_PANEL_HEIGHT,
    panelKind: "code",
    panel: codePanelContent(emptyCodePanelState(), CODE_PANEL_SESSION_ID),
    posterMode: false,
    posterFileId: null,
  });

  stampCurrentPage([panel], appState.currentPageId);

  api.updateScene({
    elements: [...api.getSceneElements(), panel],
    appState: {
      selectedElementIds: { [panel.id]: true },
    },
  });
};
