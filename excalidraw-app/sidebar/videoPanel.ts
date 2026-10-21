/**
 * The insert of a **video panel** — a local video on the canvas.
 *
 * No bridge, no service, no network: the video is a file in the document's own
 * file store, and the panel is a **live surface** — a real `<video>` in the
 * page, mounted by the library.
 *
 * The captions, when the video has any, come from a **sidecar** next to it
 * (`.srt` / `.vtt`): the app reads it, and the cues ride in the panel's
 * payload as plain data. The bridge never sees a sidecar.
 *
 * And the caption itself is an **ordinary text element** beside the panel: the
 * owner's ask (2026-10-21) — the caption is outside the player, it is editable
 * like any other text, and a video **without** captions gets **no** caption
 * element at all.
 */

import { newPanelElement, syncInvalidIndices } from "@excalidraw/element";
import {
  DEFAULT_CAPTION_LANGUAGE,
  stampCurrentPage,
  videoPanelContent,
} from "@excalidraw/excalidraw";
import {
  generateIdFromFile,
  getDataURL,
} from "@excalidraw/excalidraw/data/blob";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import type { VideoPanelElement } from "@excalidraw/excalidraw";

import {
  captionBindingFor,
  captionElementBeside,
  readCaptionTrack,
  readVideoSize,
} from "../components/videoCaptions";

import { placementFor } from "./insertIntoScene";

/** the widest the panel is shown on the canvas, in scene units */
export const VIDEO_PANEL_MAX_WIDTH = 480;

/** the size a video panel gets when the browser cannot read the video's size */
export const VIDEO_PANEL_FALLBACK_WIDTH = 480;
export const VIDEO_PANEL_FALLBACK_HEIGHT = 270;

/** the size of the caption element beside the panel */
const CAPTION_FONT_SIZE = 20;

/**
 * Inserts a video panel — and, when the video has captions, the caption
 * element beside it.
 *
 * The panel is **selected** after it is inserted, because the panel's chrome —
 * the lock button, and the caption track — is drawn for the selected panel.
 */
export const insertVideoPanel = async (
  api: ExcalidrawImperativeAPI,
  {
    videoFile,
    sidecarFile,
    at,
  }: {
    /** the video itself */
    videoFile: File;
    /** the caption sidecar next to it, when there is one */
    sidecarFile?: File | null;
    /** where the panel should land, by its centre */
    at?: { x: number; y: number };
  },
) => {
  const dataURL = await getDataURL(videoFile);
  const fileId = await generateIdFromFile(videoFile);

  // the video's **own** size — the size a poster is captured at, and the size
  // the panel is shown at, scaled down to fit the canvas
  const natural = await readVideoSize(videoFile);

  const track = sidecarFile ? await readCaptionTrack(sidecarFile) : null;

  const ratio = natural
    ? Math.min(
        1,
        VIDEO_PANEL_MAX_WIDTH / Math.max(natural.width, natural.height),
      )
    : 1;

  const width = natural
    ? Math.max(1, natural.width * ratio)
    : VIDEO_PANEL_FALLBACK_WIDTH;
  const height = natural
    ? Math.max(1, natural.height * ratio)
    : VIDEO_PANEL_FALLBACK_HEIGHT;

  const { x, y } = placementFor(api, { width, height }, at);

  const panel = newPanelElement({
    type: "panel",
    x,
    y,
    width,
    height,
    panelKind: "video",
    panel: videoPanelContent({
      source: {
        type: "file",
        fileId,
        mimeType: (videoFile.type || "video/mp4") as BinaryFileData["mimeType"],
      },
      tracks: track ? [track] : [],
      language: track?.language ?? DEFAULT_CAPTION_LANGUAGE,
      // the video's own size, so a poster is captured at the video's size and
      // not at the size the panel happens to be shown at
      naturalWidth: natural?.width ?? null,
      naturalHeight: natural?.height ?? null,
    }),
    posterMode: false,
    posterFileId: null,
  });

  // no caption track, no caption element: there is nothing to show
  const caption = captionElementBeside({
    panel,
    track,
    fontSize: CAPTION_FONT_SIZE,
    strokeColor: api.getAppState().currentItemStrokeColor,
  });

  const binding = captionBindingFor({
    panel,
    elementId: caption?.id ?? null,
    language: track?.language ?? DEFAULT_CAPTION_LANGUAGE,
  });

  // the binding rides on the panel **element**, beside the payload — see
  // `CaptionBoundPanel` in the library for why it is not in the payload
  const bound = (
    binding ? { ...panel, captionBinding: binding } : panel
  ) as VideoPanelElement;

  const now = Date.now();

  api.addFiles([
    {
      id: fileId,
      // the file store's media-type list is image-shaped, and it lives in
      // `@excalidraw/element` — outside this wave's scope. A video file keeps
      // its own type, because the overlay tells "a video" from "a picture" by
      // it.
      mimeType: (videoFile.type || "video/mp4") as BinaryFileData["mimeType"],
      dataURL,
      created: now,
      lastRetrieved: now,
      version: 1,
    },
  ]);

  stampCurrentPage(
    caption ? [bound, caption] : [bound],
    api.getAppState().currentPageId,
  );

  // A NEW element has no fractional index yet — that is what `index: null`
  // means. The library assigns the index when IT inserts an element, but a
  // host app that adds elements through `updateScene` has to do it itself:
  // `syncInvalidIndices` is the library's own function for that.
  const elements = syncInvalidIndices([
    ...api.getSceneElements(),
    ...(caption ? [bound, caption] : [bound]),
  ]);

  api.updateScene({
    elements,
    appState: {
      selectedElementIds: { [panel.id]: true },
    },
  });

  return { panel: bound, caption, track };
};
