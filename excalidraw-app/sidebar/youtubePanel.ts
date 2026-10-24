/**
 * The insert of a **YouTube panel** — a video on the canvas, played by
 * YouTube's own player.
 *
 * The panel holds a **video id**, not a URL (D-128): the id is the only thing
 * YouTube's own player needs, and the embed URL is built from it in one place
 * — in the library, where the iframe is. Nothing here fetches YouTube's pages
 * and nothing here parses their markup, so nothing here can rot.
 *
 * The **captions** are a different matter: a browser cannot read YouTube's
 * captions, so they are asked for over the bridge, and they come back in one
 * of three tiers — and the tier travels with the answer (D-129).
 */

import { newPanelElement, syncInvalidIndices } from "@excalidraw/element";
import { stampCurrentPage, youtubePanelContent } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { ExcalidrawPanelElement } from "@excalidraw/element/types";

import { youtubeVideoId } from "../../packages/vscode-bridge/bridge/src/youtube";

import { placementFor } from "./insertIntoScene";

/** the size the panel is shown at on the canvas, in scene units */
export const YOUTUBE_PANEL_WIDTH = 480;
export const YOUTUBE_PANEL_HEIGHT = 270;

/**
 * The **video id** in a YouTube link — or `null` when the text is not one.
 *
 * The reading lives in the **shared** module, so the app and the extension
 * cannot disagree about what an id is.
 */
export { youtubeVideoId };

/**
 * Inserts a YouTube panel.
 *
 * The panel is **selected** after it is inserted, because the panel's chrome —
 * the lock button — is drawn for the selected panel.
 */
export const insertYoutubePanel = (
  api: ExcalidrawImperativeAPI,
  {
    videoId,
    at,
  }: {
    /** the YouTube video id — the only thing the panel holds (D-128) */
    videoId: string;
    /** where the panel should land, by its centre */
    at?: { x: number; y: number };
  },
): ExcalidrawPanelElement => {
  const { x, y } = placementFor(
    api,
    { width: YOUTUBE_PANEL_WIDTH, height: YOUTUBE_PANEL_HEIGHT },
    at,
  );

  const panel = newPanelElement({
    type: "panel",
    x,
    y,
    width: YOUTUBE_PANEL_WIDTH,
    height: YOUTUBE_PANEL_HEIGHT,
    panelKind: "video",
    // the payload holds the **id** and nothing else: no URL, no markup
    // (D-128)
    panel: youtubePanelContent({ videoId }),
    posterMode: false,
    posterFileId: null,
  });

  stampCurrentPage([panel], api.getAppState().currentPageId);

  // A NEW element has no fractional index yet — that is what `index: null`
  // means. The library assigns the index when IT inserts an element, but a
  // host app that adds elements through `updateScene` has to do it itself.
  const elements = syncInvalidIndices([...api.getSceneElements(), panel]);

  api.updateScene({
    elements,
    appState: {
      selectedElementIds: { [panel.id]: true },
    },
  });

  return panel;
};
