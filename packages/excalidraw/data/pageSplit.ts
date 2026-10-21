import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";

import { paginateContentIntoPages } from "../scene/pages";

import type { ExcalidrawPage } from "../types";

/** what the user chose when the offer was made */
export type PageSplitChoice = "split" | "keep" | "cancel";

/** the tiled result, and the number of pages it has */
export type PageSplitCandidate = {
  elements: OrderedExcalidrawElement[];
  pages: ExcalidrawPage[];
  pageCount: number;
};

/**
 * The tiled result, or null when the content already fits on one page.
 *
 * The tiling is computed ONCE (D-16): the caller shows `pageCount` in the
 * offer and imports the very same result.
 */
export const getPageSplitCandidate = (
  elements: readonly ExcalidrawElement[],
): PageSplitCandidate | null => {
  const result = paginateContentIntoPages(elements);

  if (result.pages.length < 2) {
    // the content already fits on one page — there is nothing to tile
    return null;
  }

  return {
    // the tiling copies every property of an element — the fractional `index`
    // among them — so the order of the scene is preserved
    elements: result.elements as OrderedExcalidrawElement[],
    pages: result.pages,
    pageCount: result.pages.length,
  };
};
