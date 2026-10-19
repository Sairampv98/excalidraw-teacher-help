import { MIN_ZOOM } from "@excalidraw/common";
import { clamp } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";

import { DEFAULT_PAGE_ID, PAGE_GAP, PAGE_HEIGHT, PAGE_WIDTH } from "../types";

import type { ExcalidrawPage, NormalizedZoomValue, PageRect } from "../types";

/**
 * Pages system.
 *
 * A page is a fixed-resolution rect laid out left-to-right in scene space:
 *
 *     page N  ->  x: (N - 1) * PAGE_GAP,  y: 0,  PAGE_WIDTH x PAGE_HEIGHT
 *
 * The page — not the infinite canvas — is the viewport universe: the camera is
 * clamped so the visible region can never leave the current page's rect, and
 * zoom only ever reveals *part* of that rect. Because every display maps the
 * same rect the same way, the editor and the presenter stay in lockstep.
 */

/** rect occupied by the page at `pageIndex` (0-based) in scene coords */
export const getPageRectByIndex = (pageIndex: number): PageRect => ({
  x: pageIndex * PAGE_GAP,
  y: 0,
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
});

/** index of `pageId` within `pages`, falling back to the first page */
export const getPageIndex = (
  pages: readonly ExcalidrawPage[],
  pageId: string,
): number => {
  const index = pages.findIndex((page) => page.id === pageId);
  return index >= 0 ? index : 0;
};

/** rect of the currently selected page */
export const getCurrentPageRect = (
  pages: readonly ExcalidrawPage[],
  currentPageId: string,
): PageRect => getPageRectByIndex(getPageIndex(pages, currentPageId));

/**
 * Zoom at which the whole page fits inside the viewport. This is the minimum
 * zoom — you can always see the entire page, and zooming in just crops into it.
 */
export const getFitPageZoom = (
  viewportWidth: number,
  viewportHeight: number,
): NormalizedZoomValue => {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return 1 as NormalizedZoomValue;
  }

  const fit = Math.min(
    viewportWidth / PAGE_WIDTH,
    viewportHeight / PAGE_HEIGHT,
  );

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
  const minZoom = getFitPageZoom(viewportWidth, viewportHeight);
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
    getFitPageZoom(viewportWidth, viewportHeight),
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
