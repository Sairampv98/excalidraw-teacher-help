import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { insertImageIntoScene } from "../sidebar/insertIntoScene";

import { stickerMimeType, stickerUrl } from "./assets";

import type { ScenePoint } from "../sidebar/insertIntoScene";
import type { Sticker } from "./catalog";

/** what a dragged sticker carries, so only the canvas drop that wants it claims it */
export const STICKER_DRAG_TYPE = "application/x-excalidraw-sticker";

/**
 * Puts a sticker on the canvas (D-160).
 *
 * It goes through `insertImageIntoScene`, the app's one image path, so the
 * sticker is stamped to the page the teacher is on, and a GIF keeps the
 * `image/gif` type the animated-image overlay plays. `at` is where its centre
 * lands; without it the sticker goes to the middle of what is visible.
 */
export const insertSticker = async (
  api: ExcalidrawImperativeAPI,
  sticker: Sticker,
  at?: ScenePoint,
) => {
  await insertImageIntoScene(api, await stickerFile(sticker), at);
};

/** the file of a sticker, read from the repo's own copy of it (D-157) */
export const stickerFile = async (sticker: Sticker) => {
  const url = stickerUrl(sticker);

  if (!url) {
    throw new Error(`no file for the sticker ${sticker.id}`);
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`the sticker ${sticker.id} could not be read`);
  }

  const blob = await response.blob();

  return new File([blob], sticker.file, {
    type: stickerMimeType(sticker),
  });
};
