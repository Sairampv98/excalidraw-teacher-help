import { MIN_ZOOM, randomInteger } from "@excalidraw/common";
import { clamp } from "@excalidraw/math";

import {
  getCommonBounds,
  isFreeDrawElement,
  isLinearElement,
} from "@excalidraw/element";

import type { LocalPoint } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";

import {
  CONTENT_SCALE_STEP,
  DEFAULT_PAGE_ID,
  PAGE_GAP,
  PAGE_HEIGHT,
  PAGE_SPACING,
  PAGE_WIDTH,
} from "../types";

import type {
  ExcalidrawPage,
  NormalizedZoomValue,
  PageRect,
  ResolvedExcalidrawPage,
} from "../types";

/**
 * Pages system.
 *
 * A page is a rect laid out left-to-right in scene space. Pages may differ in
 * size, so the layout is computed from *cumulative* offsets:
 *
 *     page N  ->  x: sum(width of pages before N) + N * PAGE_SPACING
 *
 * (an index-based `index * PAGE_GAP` formula cannot express pages of differing
 * sizes). For default-sized pages the two agree: `PAGE_GAP` is the pitch
 * between two page origins, `PAGE_SPACING` the gap between the rects.
 *
 * The page — not the infinite canvas — is the viewport universe: the camera is
 * clamped so the visible region can never leave the current page's rect, and
 * zoom only ever reveals *part* of that rect. Because every display maps the
 * same rect the same way, the editor and the presenter stay in lockstep.
 */

/** a page with its geometry resolved to concrete numbers */
export const normalizePage = (
  page: ExcalidrawPage,
): ResolvedExcalidrawPage => ({
  ...page,
  // 1920x1080 is the *minimum* page size — a page may only grow
  width: Math.max(page.width ?? PAGE_WIDTH, PAGE_WIDTH),
  height: Math.max(page.height ?? PAGE_HEIGHT, PAGE_HEIGHT),
  contentScale: page.contentScale ?? 1,
});

/** size of a page's rect in scene units */
export const getPageSize = (
  page: ExcalidrawPage,
): { width: number; height: number } => {
  const { width, height } = normalizePage(page);
  return { width, height };
};

/** index of `pageId` within `pages`, falling back to the first page */
export const getPageIndex = (
  pages: readonly ExcalidrawPage[],
  pageId: string,
): number => {
  const index = pages.findIndex((page) => page.id === pageId);
  return index >= 0 ? index : 0;
};

/** rect occupied by the page at `pageIndex` (0-based) in scene coords */
export const getPageRectAtIndex = (
  pages: readonly ExcalidrawPage[],
  pageIndex: number,
): PageRect => {
  let x = 0;

  for (let index = 0; index < pageIndex; index++) {
    const page = pages[index];
    x += (page ? getPageSize(page).width : PAGE_WIDTH) + PAGE_SPACING;
  }

  const page = pages[pageIndex];
  const { width, height } = page
    ? getPageSize(page)
    : { width: PAGE_WIDTH, height: PAGE_HEIGHT };

  return { x, y: 0, width, height };
};

/** rect occupied by the page with `pageId` in scene coords */
export const getPageRect = (
  pages: readonly ExcalidrawPage[],
  pageId: string,
): PageRect => getPageRectAtIndex(pages, getPageIndex(pages, pageId));

/**
 * Rect occupied by the page at `pageIndex` (0-based) in scene coords.
 *
 * Without `pages` this assumes every page is the default size (the historical
 * behaviour, and the only correct answer for a document whose pages all have
 * the default size). Pass `pages` to lay out pages of differing sizes.
 */
export const getPageRectByIndex = (
  pageIndex: number,
  pages?: readonly ExcalidrawPage[],
): PageRect =>
  pages
    ? getPageRectAtIndex(pages, pageIndex)
    : {
        x: pageIndex * PAGE_GAP,
        y: 0,
        width: PAGE_WIDTH,
        height: PAGE_HEIGHT,
      };

/** rect of the currently selected page */
export const getCurrentPageRect = (
  pages: readonly ExcalidrawPage[],
  currentPageId: string,
): PageRect => getPageRect(pages, currentPageId);

/**
 * Zoom at which the whole page fits inside the viewport. This is the minimum
 * zoom — you can always see the entire page, and zooming in just crops into it.
 */
export const getFitPageZoom = (
  viewportWidth: number,
  viewportHeight: number,
  pageWidth: number = PAGE_WIDTH,
  pageHeight: number = PAGE_HEIGHT,
): NormalizedZoomValue => {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return 1 as NormalizedZoomValue;
  }

  const fit = Math.min(viewportWidth / pageWidth, viewportHeight / pageHeight);

  // a viewport smaller than 10% of the page would make zooming out useless
  return Math.max(fit, MIN_ZOOM) as NormalizedZoomValue;
};

/**
 * Width the canvas should be treated as having, once the space the sidebar
 * covers is discounted.
 *
 * The sidebar is an absolutely positioned overlay — it never shrinks the canvas
 * box — so without this the page happily frames itself across the full width
 * and then hides its right-hand side behind the sidebar. Treating the visible
 * region as the viewport also makes the whole-page fit land flush at x=0
 * instead of centred, which is exactly "fit the page into what's left".
 *
 * The floor keeps a very wide sidebar on a narrow window from shrinking the
 * page to nothing; the sidebar is allowed to overlap a little in that case.
 */
export const MIN_PAGE_VIEWPORT_WIDTH = 320;

export const getPageViewportWidth = (
  viewportWidth: number,
  rightInset: number,
): number => {
  if (viewportWidth <= 0) {
    return viewportWidth;
  }

  const inset = Math.max(rightInset, 0);

  return Math.max(
    viewportWidth - inset,
    Math.min(viewportWidth, MIN_PAGE_VIEWPORT_WIDTH),
  );
};

/**
 * Clamps a camera to `pageRect`.
 *
 * - zoom is kept within [fit-whole-page, maxZoom]
 * - the visible region (viewport / zoom) is kept inside the page rect
 *
 * ## The scroll convention
 *
 * `scrollX` / `scrollY` are the library's **negated** scene offsets — the
 * renderer maps
 *
 *     viewportX = (sceneX + scrollX) * zoom
 *
 * so putting a scene point at the viewport's left edge means
 * `scrollX = -sceneX`, not `+sceneX`. This file used to compute the bounds as
 * if the sign were the other way round, and the damage is invisible on page 1
 * (whose `x` is 0, so the sign cancels out) and severe everywhere else:
 *
 * - page 2+ framed a viewport nowhere near the page, so it rendered blank
 * - an insert placed through these coordinates landed at a mirrored position,
 *   far off the left of the page and only visible in a full-scene export
 * - the scroll bounds only allowed travelling "up and left", so panning down or
 *   right was impossible
 * - a legitimate zoom was clamped back to a fixed wrong spot, which is why
 *   zooming always snapped to the same area
 *
 * `tests/pageCamera.test.ts` checks all of that through
 * `sceneCoordsToViewportCoords` rather than against the arithmetic below, so a
 * self-consistent-but-wrong implementation cannot pass.
 *
 * When the viewport is larger than the page (zoomed all the way out on a big
 * screen) the page is centered instead of pinned to a corner.
 */
export const clampCameraToPage = ({
  scrollX,
  scrollY,
  zoom,
  viewportWidth,
  viewportHeight,
  pageRect,
  maxZoom,
}: {
  scrollX: number;
  scrollY: number;
  zoom: NormalizedZoomValue;
  viewportWidth: number;
  viewportHeight: number;
  pageRect: PageRect;
  maxZoom: number;
}) => {
  const minZoom = getFitPageZoom(
    viewportWidth,
    viewportHeight,
    pageRect.width,
    pageRect.height,
  );
  const nextZoom = clamp(zoom, minZoom, Math.max(minZoom, maxZoom));

  // visible scene-space extent at this zoom
  const visibleWidth = viewportWidth / nextZoom;
  const visibleHeight = viewportHeight / nextZoom;

  const axisScroll = (
    current: number,
    offset: number,
    visible: number,
    size: number,
  ) =>
    // the page fits on this axis: centre it, no panning
    visible >= size
      ? visible / 2 - offset - size / 2
      : // otherwise the viewport may travel from "page's far edge at the
        // viewport's far edge" (the more negative end) to "page's near edge at
        // the viewport's origin"
        clamp(current, visible - offset - size, -offset);

  return {
    scrollX: axisScroll(scrollX, pageRect.x, visibleWidth, pageRect.width),
    scrollY: axisScroll(scrollY, pageRect.y, visibleHeight, pageRect.height),
    zoom: nextZoom as NormalizedZoomValue,
  };
};

/** camera that frames the whole page, centered */
export const getCameraForPage = ({
  viewportWidth,
  viewportHeight,
  pageRect,
  maxZoom,
}: {
  viewportWidth: number;
  viewportHeight: number;
  pageRect: PageRect;
  maxZoom: number;
}) => {
  const zoom = Math.min(
    getFitPageZoom(
      viewportWidth,
      viewportHeight,
      pageRect.width,
      pageRect.height,
    ),
    maxZoom,
  ) as NormalizedZoomValue;

  return clampCameraToPage({
    // the page's top-left corner, in the negated-offset convention
    scrollX: -pageRect.x,
    scrollY: -pageRect.y,
    zoom,
    viewportWidth,
    viewportHeight,
    pageRect,
    maxZoom,
  });
};

/**
 * Position of a page point as a fraction (0..1) of the page dimensions.
 * This is the resolution-independent camera the presenter mirrors, so a point
 * 40% across the page is 40% across on every display regardless of viewport
 * size or zoom.
 */
export const getPageRelativeCamera = ({
  scrollX,
  scrollY,
  pageRect,
}: {
  scrollX: number;
  scrollY: number;
  pageRect: PageRect;
}) => ({
  // `scrollX` is a negated offset, so the scrolled-off amount is how far past
  // `-pageRect.x` the camera has travelled
  /** fraction of the page width scrolled off to the left, 0..1 */
  offsetX: clamp(-(pageRect.x + scrollX) / pageRect.width, 0, 1),
  /** fraction of the page height scrolled off to the top, 0..1 */
  offsetY: clamp(-(pageRect.y + scrollY) / pageRect.height, 0, 1),
});

/** inverse of {@link getPageRelativeCamera} — used by the presenter window */
export const getCameraFromPageRelative = ({
  offsetX,
  offsetY,
  pageRect,
}: {
  offsetX: number;
  offsetY: number;
  pageRect: PageRect;
}) => ({
  scrollX: -pageRect.x - offsetX * pageRect.width,
  scrollY: -pageRect.y - offsetY * pageRect.height,
});

export const getElementsForPage = <
  T extends ExcalidrawElement = ExcalidrawElement,
>(
  elements: readonly T[],
  pageId: string,
): readonly T[] => elements.filter((element) => element.pageId === pageId);

export const getOrderedElementsForPage = (
  elements: readonly OrderedExcalidrawElement[],
  pageId: string,
): readonly OrderedExcalidrawElement[] =>
  elements.filter((element) => element.pageId === pageId);

export const getDefaultPage = (): ExcalidrawPage => ({
  id: DEFAULT_PAGE_ID,
  name: "Page 1",
});

/**
 * Stamps the page the user is acting on onto elements that are being inserted
 * into the live scene.
 *
 * THE RULE: an element the user inserts belongs to the page they are acting
 * on. Neither factory can know it on its own — `newElement()` cannot ask the
 * app (that would be a dependency cycle) and `restoreElements()` resolves from
 * the **file**, not from the running app — so both stamp a default. Content
 * inserted while a later page was active therefore used to land on page 1 and
 * vanish from the view, while still being present in the document (the
 * exporter draws the whole scene, the canvas draws only the current page).
 *
 * This is the single stamping point: every path that introduces elements into
 * the live scene goes through it — draw, paste, library, sidebar insert.
 * Restoring a file is the one exception, and it does not come through here.
 *
 * The stamp is applied **in place**, on purpose: callers keep a reference to
 * the element they created and go on to mutate it (drag handles, binding,
 * text editing), so handing the scene a copy would silently orphan those
 * mutations.
 */
export const stampCurrentPage = <
  T extends ExcalidrawElement = ExcalidrawElement,
>(
  elements: readonly T[],
  currentPageId: string,
): readonly T[] => {
  for (const element of elements) {
    // see the note above: `pageId` is readonly on some element variants, but
    // the element model is mutable and callers hold on to the reference
    (element as { pageId: string }).pageId = currentPageId;
  }

  return elements;
};

/**
 * Scales the geometry of an element around a pivot.
 *
 * Scaled: `x`, `y`, `width`, `height`, free-draw / linear `points`,
 * `strokeWidth` and (for text) `fontSize`.
 *
 * Not scaled: `angle`, `groupIds`, `boundElements`, `link`, `frameId` — those
 * are references, not geometry.
 */
const scaleElementGeometry = <T extends ExcalidrawElement>(
  element: T,
  pivotX: number,
  pivotY: number,
  factor: number,
): T => {
  const x = pivotX + (element.x - pivotX) * factor;
  const y = pivotY + (element.y - pivotY) * factor;

  if (isLinearElement(element) || isFreeDrawElement(element)) {
    return {
      ...element,
      x,
      y,
      width: element.width * factor,
      height: element.height * factor,
      strokeWidth: element.strokeWidth * factor,
      points: element.points.map(
        ([pointX, pointY]) => [pointX * factor, pointY * factor] as LocalPoint,
      ),
    } as T;
  }

  if (element.type === "text") {
    return {
      ...element,
      x,
      y,
      width: element.width * factor,
      height: element.height * factor,
      strokeWidth: element.strokeWidth * factor,
      fontSize: element.fontSize * factor,
    } as T;
  }

  return {
    ...element,
    x,
    y,
    width: element.width * factor,
    height: element.height * factor,
    strokeWidth: element.strokeWidth * factor,
  } as T;
};

/**
 * Scales the content of a page around the page's origin.
 *
 * The page rect is left untouched — scaling the content is the only way to get
 * more room on a page (D-2) — and floating elements are left untouched too: a
 * floating element does not belong to the page's coordinate space.
 *
 * The scale is written into the *stored* element geometry, it is not a
 * render-time multiplier. The scale step is 0.5 and its inverse 2, both exact in
 * binary floating point, so scaling down and back up is lossless.
 */
export const scalePageContent = <
  T extends ExcalidrawElement = ExcalidrawElement,
>({
  elements,
  pages,
  pageId,
  factor = CONTENT_SCALE_STEP,
}: {
  elements: readonly T[];
  pages: readonly ExcalidrawPage[];
  pageId: string;
  factor?: number;
}): { pages: readonly ExcalidrawPage[]; elements: readonly T[] } => {
  if (!pages.some((page) => page.id === pageId)) {
    return { pages, elements };
  }

  // the pivot is the page's origin, so content keeps its position relative to
  // the page
  const pivot = getPageRect(pages, pageId);

  return {
    pages: pages.map((page) =>
      page.id === pageId
        ? { ...page, contentScale: (page.contentScale ?? 1) * factor }
        : page,
    ),
    elements: elements.map((element) =>
      element.pageId === pageId && !element.floating
        ? scaleElementGeometry(element, pivot.x, pivot.y, factor)
        : element,
    ),
  };
};

/**
 * Removes a page.
 *
 * The page's *elements* are not touched here — see
 * {@link deletePageElements} — so that the caller can soft-delete them and
 * undo restores the page and its content together.
 *
 * Deleting the last page leaves a single, empty page behind: a document
 * always has at least one page.
 */
export const deletePage = ({
  pages,
  currentPageId,
  pageId,
}: {
  pages: readonly ExcalidrawPage[];
  currentPageId: string;
  pageId: string;
}): { pages: readonly ExcalidrawPage[]; currentPageId: string } => {
  const index = pages.findIndex((page) => page.id === pageId);

  if (index < 0) {
    return { pages, currentPageId };
  }

  const remaining = pages.filter((page) => page.id !== pageId);

  if (!remaining.length) {
    const page = getDefaultPage();
    return { pages: [page], currentPageId: page.id };
  }

  return {
    pages: remaining,
    currentPageId:
      currentPageId === pageId
        ? // the page before the deleted one, or the first page left
          (remaining[index - 1] ?? remaining[0]).id
        : currentPageId,
  };
};

/**
 * Soft-deletes the elements of a page.
 *
 * Soft-deleted (rather than removed) so that undoing the page deletion brings
 * the content back with the page record. The version is bumped so that the
 * change is a proper element delta for the history and the collab stream.
 */
export const deletePageElements = <T extends ExcalidrawElement>(
  elements: readonly T[],
  pageId: string,
): readonly T[] =>
  elements.map((element) =>
    element.pageId === pageId && !element.isDeleted
      ? ({
          ...element,
          isDeleted: true,
          version: element.version + 1,
          versionNonce: randomInteger(),
        } as T)
      : element,
  );

/**
 * Translates the content of every page whose rect moved, so that the content
 * of a page follows its page.
 *
 * A page's position is *positional*: its x is the sum of the widths of the
 * pages before it plus the spacing (see {@link getPageRectAtIndex}). Its
 * content, on the other hand, lives in absolute scene coordinates and is
 * never moved when the page list changes. Deleting a page in the middle
 * therefore shifts every later page one pitch to the left while their content
 * stays exactly where it was — stranded a page to the left of the page that
 * now holds it, so those pages look empty even though the content is still in
 * the document.
 *
 * This is the single mechanism that keeps content and page together: the
 * caller hands over the page list *before* the change and *after* it, and
 * every page that moved has its elements translated by the difference.
 * Deleting a page, inserting one, reordering the pages and resizing a page
 * are the same operation as far as the content is concerned.
 *
 * - only `x` and `y` are translated — nothing is scaled
 * - a **floating** element is not owned by its page's coordinate space and is
 *   left alone
 * - the elements of a page that no longer exists are left alone: they go
 *   with the page (see {@link deletePageElements})
 */
export const translateContentForPageLayout = <
  T extends ExcalidrawElement = ExcalidrawElement,
>({
  elements,
  previousPages,
  nextPages,
}: {
  elements: readonly T[];
  previousPages: readonly ExcalidrawPage[];
  nextPages: readonly ExcalidrawPage[];
}): readonly T[] => {
  const offsets = new Map<string, { dx: number; dy: number }>();

  for (const page of previousPages) {
    if (!nextPages.some((next) => next.id === page.id)) {
      // the page is gone — its content goes with it
      continue;
    }

    const before = getPageRect(previousPages, page.id);
    const after = getPageRect(nextPages, page.id);

    const dx = after.x - before.x;
    const dy = after.y - before.y;

    if (dx !== 0 || dy !== 0) {
      offsets.set(page.id, { dx, dy });
    }
  }

  if (!offsets.size) {
    return elements;
  }

  return elements.map((element) => {
    if (element.floating) {
      // a floating element is not owned by its page
      return element;
    }

    const offset = offsets.get(element.pageId);

    if (!offset) {
      return element;
    }

    return {
      ...element,
      x: element.x + offset.dx,
      y: element.y + offset.dy,
      // the geometry changed, so this is a proper element delta for the
      // history and the collab stream
      version: element.version + 1,
      versionNonce: randomInteger(),
    } as T;
  });
};

/** the default page name, e.g. "Page 3" */
const DEFAULT_PAGE_NAME = /^Page \d+$/;

/**
 * Inserts a page *after* the page the user is on.
 *
 * The new page takes the slot right after `afterPageId`, so every page that
 * follows it moves one pitch to the right — and its content has to move with
 * it (see {@link translateContentForPageLayout}).
 *
 * The pages that carry the default name are renamed so that the names stay
 * sequential; a page with a name of its own (a file's pages, say) keeps it.
 */
export const insertPageAfter = ({
  pages,
  afterPageId,
  pageId,
}: {
  pages: readonly ExcalidrawPage[];
  afterPageId: string;
  pageId: string;
}): readonly ExcalidrawPage[] => {
  const insertIndex = getPageIndex(pages, afterPageId) + 1;

  const nextPages = [
    ...pages.slice(0, insertIndex),
    { id: pageId, name: `Page ${insertIndex + 1}` },
    ...pages.slice(insertIndex),
  ];

  return nextPages.map((page, index) => {
    const name = `Page ${index + 1}`;
    return DEFAULT_PAGE_NAME.test(page.name) ? { ...page, name } : page;
  });
};

/**
 * Grows pages so that they contain the content restored onto them.
 *
 * A page's origin is derived from the layout (it cannot be stored on the
 * page), so a page can only grow to the right and downwards. Content that sits
 * to the left of / above the page's origin cannot be contained by growing the
 * page — such content has to be marked floating (D-4) to be reachable.
 */
export const growPagesToFitContent = (
  pages: readonly ExcalidrawPage[],
  elements: readonly ExcalidrawElement[],
): readonly ExcalidrawPage[] =>
  pages.map((page) => {
    const pageElements = elements.filter(
      (element) =>
        element.pageId === page.id && !element.isDeleted && !element.floating,
    );

    if (!pageElements.length) {
      return page;
    }

    const rect = getPageRect(pages, page.id);
    const [, , maxX, maxY] = getCommonBounds(pageElements);

    const width = Math.max(rect.width, maxX - rect.x);
    const height = Math.max(rect.height, maxY - rect.y);

    if (width === rect.width && height === rect.height) {
      return page;
    }

    return { ...page, width, height };
  });

/** the id the page at `index` (0-based) gets in a tiled document */
const tiledPageId = (index: number): string => `page-${index + 1}`;

/**
 * Tiles the content of a scene across pages.
 *
 * A vanilla `.excalidraw` file has no pages: every element is stamped onto
 * the first page, so a board that sprawls over several pages of *area* ends up
 * as one enormous page. Its content is then mostly **outside** the page rect
 * the camera is clamped to — unreachable — and the renderer draws every
 * element of the board on every frame.
 *
 * This function turns such a scene into a paged document: the content is
 * measured, re-anchored onto the scene origin, cut into a grid of page-sized
 * cells and laid out again — one cell per page.
 *
 * ## What it does
 *
 * 1. **Measure** the bounding box of the *content* — the elements that are
 *    neither deleted nor floating.
 * 2. **Re-anchor**: the content is translated by `(-minX, -minY)`, so its
 *    top-left lands on the scene origin. This is required: the first page's
 *    rect always starts at x = 0, so content at a negative coordinate could
 *    never be inside a page.
 * 3. **Tile**: the content is cut into a grid of `pageWidth` x `pageHeight`
 *    cells — `col = floor(x / pageWidth)`, `row = floor(y / pageHeight)` — and
 *    the cells that hold no content are dropped.
 * 4. **Place**: the surviving cells become the pages, in **row major** order
 *    (the top-left cell first, then left to right, then down), so the board
 *    reads in reading order. The page at index `P` has its rect at
 *    `x = P * (pageWidth + spacing)`, and the content of the cell
 *    `(col, row)` keeps its position *within* that cell.
 *
 * The cell of an element is decided by the element's **origin** — the same
 * `x` / `y` the renderer places it by.
 *
 * ## What it does not do
 *
 * - It does not **scale** anything: an element keeps its size, type and style.
 * - It does not move a **floating** element: a floating element is not owned
 *   by a page, so it is left exactly where it is.
 * - It does not mutate its input: every element it moves becomes a new
 *   object, and the elements it leaves alone are handed back untouched.
 *
 * ## "Already fits in one page"
 *
 * The content *fits* when its bounding box lies inside the **first** page's
 * rect — `minX >= 0 && minY >= 0 && maxX <= pageWidth && maxY <= pageHeight`.
 * That is a position test, not only a size test: a small scene sitting at
 * x = 5000 does not fit (it would be outside the page rect, and therefore
 * unreachable), so it is re-anchored onto the first page. An empty scene fits
 * as well.
 *
 * When the content fits, the function is a **no-op**: the elements come back
 * unchanged (the very same objects) and the page list is the single default
 * page.
 *
 * ## The page geometry
 *
 * The page size defaults to the library's page size (`PAGE_WIDTH` x
 * `PAGE_HEIGHT`) and the gap between two page rects to `PAGE_SPACING`, so the
 * returned pages land exactly where the library's own layout
 * ({@link getPageRectAtIndex}) puts them and every element ends up inside its
 * page.
 *
 * A `pageWidth` / `pageHeight` below the library's minimum is raised to it: a
 * page may only grow (D-1). A `spacing` other than `PAGE_SPACING` is
 * honoured by the arithmetic here, but the library lays the page rects out
 * with a fixed `PAGE_SPACING` gap — so a custom spacing and the library's own
 * layout disagree.
 */
export const paginateContentIntoPages = (
  elements: readonly ExcalidrawElement[],
  options?: {
    pageWidth?: number;
    pageHeight?: number;
    spacing?: number;
  },
): { elements: ExcalidrawElement[]; pages: ExcalidrawPage[] } => {
  // a page may only grow (D-1), so a smaller request is raised to the
  // library's minimum
  const pageWidth = Math.max(options?.pageWidth ?? PAGE_WIDTH, PAGE_WIDTH);
  const pageHeight = Math.max(
    options?.pageHeight ?? PAGE_HEIGHT,
    PAGE_HEIGHT,
  );
  const spacing = options?.spacing ?? PAGE_SPACING;

  /** the content: the elements a page owns — neither deleted nor floating */
  const content = elements.filter(
    (element) => !element.isDeleted && !element.floating,
  );

  /** the document as it is when there is nothing to tile */
  const singlePage = (): {
    elements: ExcalidrawElement[];
    pages: ExcalidrawPage[];
  } => ({
    elements: [...elements],
    pages: [getDefaultPage()],
  });

  if (!content.length) {
    return singlePage();
  }

  const [minX, minY, maxX, maxY] = getCommonBounds(content);

  // the content already lies inside the first page's rect: there is nothing
  // to tile
  if (minX >= 0 && minY >= 0 && maxX <= pageWidth && maxY <= pageHeight) {
    return singlePage();
  }

  // the anchor: the content's top-left lands on the scene origin
  const dx = -minX;
  const dy = -minY;

  /** the cell a re-anchored position falls into */
  const cellOf = (x: number, y: number) => ({
    col: Math.floor(x / pageWidth),
    row: Math.floor(y / pageHeight),
  });

  const cellKey = (col: number, row: number) => `${row}:${col}`;

  // the cells that hold content
  const cells = new Map<string, { col: number; row: number }>();

  for (const element of content) {
    const { col, row } = cellOf(element.x + dx, element.y + dy);
    cells.set(cellKey(col, row), { col, row });
  }

  // row major: the top-left cell first, then left to right, then down
  const ordered = [...cells.values()].sort(
    (a, b) => a.row - b.row || a.col - b.col,
  );

  const pages: ExcalidrawPage[] = ordered.map((_, index) => ({
    id: tiledPageId(index),
    name: `Page ${index + 1}`,
    width: pageWidth,
    height: pageHeight,
  }));

  const pageIndexByCell = new Map<string, number>();

  ordered.forEach((cell, index) => {
    pageIndexByCell.set(cellKey(cell.col, cell.row), index);
  });

  const pitch = pageWidth + spacing;

  const nextElements = elements.map((element) => {
    if (element.floating) {
      // a floating element is not owned by its page: it is left exactly where
      // it is
      return element;
    }

    const x = element.x + dx;
    const y = element.y + dy;

    if (element.isDeleted) {
      // a deleted element is not content: it is re-anchored with the rest (so
      // it stays where it was relative to its neighbours) but it is never
      // tiled onto a page
      return {
        ...element,
        x,
        y,
        version: element.version + 1,
        versionNonce: randomInteger(),
      };
    }

    const { col, row } = cellOf(x, y);
    const pageIndex = pageIndexByCell.get(cellKey(col, row))!;
    const page = pages[pageIndex];

    return {
      ...element,
      // the element keeps its position within its cell, and the cell is
      // placed on its page
      x: pageIndex * pitch + (x - col * pageWidth),
      y: y - row * pageHeight,
      pageId: page.id,
      // the geometry changed, so this is a proper element delta for the
      // history and the collab stream
      version: element.version + 1,
      versionNonce: randomInteger(),
    };
  });

  return { elements: nextElements, pages };
};

/**
 * The rect the camera is clamped to: the page rect, widened by the bounding
 * box of the page's floating elements.
 *
 * A floating element is not owned by its page's coordinate space, so it may
 * sit outside the page rect — and the camera has to be able to reach it.
 */
export const getPageClampRect = (
  pageRect: PageRect,
  floatingElements: readonly ExcalidrawElement[],
): PageRect => {
  if (!floatingElements.length) {
    return pageRect;
  }

  const [minX, minY, maxX, maxY] = getCommonBounds(floatingElements);

  const x = Math.min(pageRect.x, minX);
  const y = Math.min(pageRect.y, minY);

  return {
    x,
    y,
    width: Math.max(pageRect.x + pageRect.width, maxX) - x,
    height: Math.max(pageRect.y + pageRect.height, maxY) - y,
  };
};
