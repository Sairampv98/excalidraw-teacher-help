import { MIME_TYPES } from "@excalidraw/common";
import { isImageElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawImageElement,
  FileId,
} from "@excalidraw/element/types";

import type { BinaryFiles } from "../types";

/**
 * A GIF is painted onto the canvas with `context.drawImage`, which bakes in
 * whichever frame the underlying `<img>` is showing at that instant. The canvas
 * is otherwise only repainted when the app state changes, so an idle board
 * freezes a GIF on its first frame — it only appears to move while you happen
 * to be dragging something.
 *
 * These helpers decide *whether* to keep repainting. Only GIFs qualify: an
 * animated WebP would work the same way, but a still WebP is common enough
 * that repainting for every one of them would cost more than it is worth.
 */
export const isAnimatedImageMimeType = (mimeType: string | undefined) =>
  mimeType === MIME_TYPES.gif;

/**
 * `fileId`s of every animated image currently in the scene.
 *
 * The renderer needs to know *which* elements are animated rather than merely
 * whether any are, because it can only draw an animated image live — see
 * `renderElement.ts`. The editor needs only the emptiness of the set.
 */
export const animatedImageFileIds = (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
): Set<FileId> => {
  const fileIds = new Set<FileId>();

  for (const element of elements) {
    if (
      isImageElement(element) &&
      element.fileId != null &&
      isAnimatedImageMimeType(files[element.fileId]?.mimeType)
    ) {
      fileIds.add(element.fileId);
    }
  }

  return fileIds;
};

/**
 * Shared empty result, so a scene without any GIF can hand the renderer a
 * stable reference instead of a fresh `Set` on every render.
 */
export const NO_ANIMATED_IMAGE_FILE_IDS: ReadonlySet<string> = new Set();

export const sceneHasAnimatedImage = (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
) => animatedImageFileIds(elements, files).size > 0;

/**
 * The animated images themselves, for the DOM overlay that plays them.
 *
 * An animated image cannot be painted onto the canvas and simply repainted —
 * Chromium only advances a GIF's frame clock while the `<img>` is genuinely
 * visible on screen, so it has to be a real element in the page. See
 * `components/AnimatedImageOverlay.tsx`.
 */
export const getAnimatedImageElements = (
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles,
): ExcalidrawImageElement[] =>
  elements.filter(
    (element): element is ExcalidrawImageElement =>
      isImageElement(element) &&
      element.fileId != null &&
      isAnimatedImageMimeType(files[element.fileId]?.mimeType),
  );
