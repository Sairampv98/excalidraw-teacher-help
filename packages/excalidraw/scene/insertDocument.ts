/**
 * Inserting a document into the current canvas (D-35..D-38).
 *
 * The fork owner's request: "if I open one excalidraw file and then open another
 * excalidraw file in the same canvas, the second should merge into the first".
 *
 * Opening a file **replaces** the canvas — `loadFileToCanvas` syncs the file's
 * elements with `replaceFiles: true`, so the first document is gone — and it
 * keeps doing so (D-35). The merge is therefore an **explicit action**:
 * "File > Insert document...".
 *
 * This module holds the pure parts of that action — read, remap, place — so
 * the action itself stays a thin shell around them and the behaviour can be
 * asserted without a file picker.
 *
 * What is deliberately **not** here:
 *
 * - the **import** path's page logic (`loadSceneOrLibraryFromBlob`): it grows
 *   the page to contain the content and translates the content to follow the
 *   grown page. That is right for an import and wrong for an insertion into an
 *   existing document — the content that is inserted keeps its own coordinates
 *   and is only moved by the placement (D-38).
 * - the other document's **page structure**: the content is flattened onto the
 *   current page (D-36).
 */

import { randomId } from "@excalidraw/common";

import { duplicateElements, getCommonBounds } from "@excalidraw/element";

import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";

import { parseFileContents } from "../data/blob";
import { isValidExcalidrawData } from "../data/json";
import { restoreElements } from "../data/restore";

import { PAGE_SPACING } from "../types";

import {
  getElementsForPage,
  getPageRect,
  growPagesToFitContent,
  stampCurrentPage,
  translateContentForPageLayout,
} from "./pages";

import type { BinaryFiles, ExcalidrawPage, PageRect } from "../types";

/**
 * The gap between the existing content's right edge and the inserted content's
 * left edge.
 *
 * It is the library's own `PAGE_SPACING` — the gap the page layout leaves
 * between two page rects — so the inserted content sits a page-gap away from
 * what is already there, and not at some hand-picked distance.
 */
export const INSERT_GAP = PAGE_SPACING;

/** a document read from a file, ready to be inserted */
export type InsertedDocument = {
  elements: ExcalidrawElement[];
  files: BinaryFiles;
};

/**
 * Reads an `.excalidraw` file for an insertion into a live document.
 *
 * The file is restored with the library's own `restoreElements`, but **without**
 * the import path's page logic: the elements keep the coordinates the file gave
 * them, and the file's pages are not merged into this document's pages.
 */
export const readDocumentFromFile = async (
  file: Blob | File,
): Promise<InsertedDocument> => {
  const contents = await parseFileContents(file);

  let data: any;
  try {
    data = JSON.parse(contents);
  } catch (error) {
    throw new Error("Error: invalid file");
  }

  if (!isValidExcalidrawData(data)) {
    throw new Error("Error: invalid file");
  }

  const elements = restoreElements(data.elements, null, {
    // the bindings of the file are repaired against the file's own elements:
    // an arrow bound to a shape in the same file keeps its binding, and one
    // bound to something the file does not contain loses it (there is nothing
    // in *this* document it could bind to)
    repairBindings: true,
    deleteInvisibleElements: true,
  });

  return { elements: [...elements], files: data.files || {} };
};

/**
 * Gives every binary file of the inserted document an id of its own and
 * rewrites the elements' `fileId` to match (D-37).
 *
 * The inserted elements reference the **other** document's binary files by id,
 * and those ids may already be taken in this document's file store — an id
 * clash would silently swap the image the element shows. Every file therefore
 * gets a **fresh** id, and the fresh id is checked against the ids already in
 * this document, so it cannot collide with one of them either.
 */
export const remapFileIds = ({
  elements,
  files,
  existingFileIds,
}: {
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  existingFileIds: readonly string[];
}): { elements: ExcalidrawElement[]; files: BinaryFiles } => {
  const taken = new Set<string>(existingFileIds);

  const idMap = new Map<string, FileId>();
  const remappedFiles: BinaryFiles = {};

  for (const [fileId, file] of Object.entries(files)) {
    let freshId = randomId() as FileId;

    while (taken.has(freshId)) {
      freshId = randomId() as FileId;
    }

    taken.add(freshId);
    idMap.set(fileId, freshId);
    remappedFiles[freshId] = { ...file, id: freshId };
  }

  const remappedElements = elements.map((element) => {
    if (!("fileId" in element) || !element.fileId) {
      return element;
    }

    const freshId = idMap.get(element.fileId);

    if (!freshId) {
      // the element points at a file the document does not carry
      return element;
    }

    return { ...element, fileId: freshId };
  });

  return { elements: remappedElements, files: remappedFiles };
};

/**
 * Places the inserted content **beside** what is already on the page — to the
 * right of it (D-38).
 *
 * The placement is measured with the library's own `getCommonBounds`, the same
 * function the paste path uses, and never with a re-derived formula.
 *
 * - The page's **content** is what is already there: the elements of that page
 *   that are neither deleted nor floating — the same set the page model calls
 *   the page's content (`growPagesToFitContent`, `scalePageContent`). A
 *   floating element is not owned by its page, so it does not push the
 *   inserted content away.
 * - The inserted content's left edge lands one `INSERT_GAP` to the right of
 *   that content's right edge, and its top edge lines up with the content's
 *   top edge — so the two read as one drawing next to the other.
 * - When the page has no content, the inserted content lands on the **page's
 *   origin**.
 *
 * The page can only grow to the right and downwards (D-5), so the placement is
 * never left of / above the page's origin.
 */
export const placeInsertedElements = ({
  elements,
  existingElements,
  pageRect,
}: {
  elements: readonly ExcalidrawElement[];
  existingElements: readonly ExcalidrawElement[];
  pageRect: PageRect;
}): ExcalidrawElement[] => {
  if (!elements.length) {
    return [];
  }

  const existingContent = existingElements.filter(
    (element) => !element.isDeleted && !element.floating,
  );

  let targetLeft: number;
  let targetTop: number;

  if (existingContent.length) {
    const [, contentTop, contentRight] = getCommonBounds(existingContent);

    targetLeft = contentRight + INSERT_GAP;
    targetTop = Math.max(contentTop, pageRect.y);
  } else {
    targetLeft = pageRect.x;
    targetTop = pageRect.y;
  }

  targetLeft = Math.max(targetLeft, pageRect.x);

  const [insertedLeft, insertedTop] = getCommonBounds(elements);

  const dx = targetLeft - insertedLeft;
  const dy = targetTop - insertedTop;

  if (dx === 0 && dy === 0) {
    return [...elements];
  }

  return elements.map((element) => ({
    ...element,
    x: element.x + dx,
    y: element.y + dy,
  }));
};

export type InsertDocumentIntoSceneResult = {
  /** the whole scene after the insertion */
  elements: readonly ExcalidrawElement[];
  /** the pages after the insertion — the current page may have grown */
  pages: readonly ExcalidrawPage[];
  /** the binary files of the inserted document, under their fresh ids */
  files: BinaryFiles;
  /** the ids of the elements that arrived, so the user can see them */
  selectedElementIds: Record<string, true>;
};

/**
 * Merges an inserted document into the live scene.
 *
 * The current document is **not** replaced: its elements are kept as they are,
 * and the inserted content is added to them.
 */
export const insertDocumentIntoScene = ({
  elements,
  pages,
  currentPageId,
  document,
  files,
}: {
  elements: readonly ExcalidrawElement[];
  pages: readonly ExcalidrawPage[];
  currentPageId: string;
  document: InsertedDocument;
  files: BinaryFiles;
}): InsertDocumentIntoSceneResult => {
  // 1. the inserted elements get ids of their own, so they cannot collide with
  //    the ids of the elements already in this document
  const { duplicatedElements } = duplicateElements({
    elements: document.elements.filter((element) => !element.isDeleted),
    type: "everything",
    // the drawing comes across as it was authored — the seed is part of it
    randomizeSeed: false,
  });

  // 2. the binary files get ids of their own (D-37)
  const remapped = remapFileIds({
    elements: duplicatedElements,
    files: document.files,
    existingFileIds: Object.keys(files),
  });

  // 3. the content belongs to the page the user is acting on (D-36, D-12)
  stampCurrentPage(remapped.elements, currentPageId);

  // 4. the content is placed beside what is already on the page (D-38)
  const placed = placeInsertedElements({
    elements: remapped.elements,
    existingElements: getElementsForPage(elements, currentPageId),
    pageRect: getPageRect(pages, currentPageId),
  });

  const nextElements = [...elements, ...placed];

  // 5. the page grows to contain what arrived (D-38)
  const grownPages = growPagesToFitContent(pages, nextElements);

  // 6. the pages that follow the grown one move — and their content with them
  const finalElements = translateContentForPageLayout({
    elements: nextElements,
    previousPages: pages,
    nextPages: grownPages,
  });

  const selectedElementIds: Record<string, true> = {};

  for (const element of placed) {
    selectedElementIds[element.id] = true;
  }

  return {
    elements: finalElements,
    pages: grownPages,
    files: remapped.files,
    selectedElementIds,
  };
};
