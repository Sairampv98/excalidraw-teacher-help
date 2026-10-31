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
 * These helpers decide *whether* to keep repainting. A GIF always qualifies. A
 * WebP qualifies only when its own header says it is animated (D-382): a still
 * WebP is common enough that repainting for every one of them would cost more
 * than it is worth.
 */
export const isAnimatedImageMimeType = (mimeType: string | undefined) =>
  mimeType === MIME_TYPES.gif;

/**
 * Whether the first bytes of a file are those of an **animated WebP**: a RIFF
 * file of the WEBP kind whose extended header (`VP8X`) has the animation flag
 * (D-382). Thirty-three bytes are enough; fewer, or any other file, are not.
 */
export const isAnimatedWebpBytes = (bytes: ArrayLike<number>): boolean => {
  const text = (from: number) =>
    String.fromCharCode(
      bytes[from],
      bytes[from + 1],
      bytes[from + 2],
      bytes[from + 3],
    );

  return (
    bytes.length >= 21 &&
    text(0) === "RIFF" &&
    text(8) === "WEBP" &&
    text(12) === "VP8X" &&
    (bytes[20] & 0x02) !== 0
  );
};

/** the same for a data URL, reading only the start of it */
export const isAnimatedWebpDataUrl = (dataURL: string | undefined): boolean => {
  if (!dataURL) {
    return false;
  }

  const comma = dataURL.indexOf(",");

  if (comma < 0 || !dataURL.slice(0, comma).endsWith(";base64")) {
    return false;
  }

  try {
    // forty-four characters are thirty-three bytes
    const head = atob(dataURL.slice(comma + 1, comma + 45));

    return isAnimatedWebpBytes(Array.from(head, (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
};

/** whether a file is an image that moves: a GIF, or a WebP that is animated */
export const isAnimatedImageFile = (
  file: { mimeType?: string; dataURL?: string } | undefined,
): boolean =>
  isAnimatedImageMimeType(file?.mimeType) ||
  (file?.mimeType === MIME_TYPES.webp && isAnimatedWebpDataUrl(file.dataURL));

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
      isAnimatedImageFile(files[element.fileId])
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
      isAnimatedImageFile(files[element.fileId]),
  );
