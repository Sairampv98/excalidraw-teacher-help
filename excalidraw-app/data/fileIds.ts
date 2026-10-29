/**
 * The files an element needs (D-250).
 *
 * An image needs its picture. A panel that is made of a file - a video that is
 * small enough to travel in the document - needs that file, and a poster panel
 * needs the picture of its poster. They are all files of the document's store,
 * and all of them have to be kept with the document: saved to the browser's
 * storage and read back when it is opened, or the panel says its file is no
 * longer there after a reload.
 */

import { isInitializedImageElement, isPanelElement } from "@excalidraw/element";
import { panelSource } from "@excalidraw/excalidraw";

import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";

export const fileIdsOf = (element: ExcalidrawElement): FileId[] => {
  if (isInitializedImageElement(element)) {
    return [element.fileId];
  }

  if (!isPanelElement(element)) {
    return [];
  }

  const ids: FileId[] = [];
  const source = panelSource(element);

  if (source.type === "file") {
    ids.push(source.fileId as FileId);
  }

  if (element.posterFileId) {
    ids.push(element.posterFileId);
  }

  return ids;
};

/** the ids of the files of all the elements, once each */
export const fileIdsOfAll = (
  elements: readonly ExcalidrawElement[] | null | undefined,
): FileId[] => [...new Set((elements ?? []).flatMap(fileIdsOf))];
