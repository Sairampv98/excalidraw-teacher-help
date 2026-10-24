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
  PageDecoration,
  PageRect,
  ResolvedExcalidrawPage,
} from "../types";

import type { TranslationKeys } from "../i18n";

/** how far the page's number sits from the page's bottom edge, in scene units */
export const PAGE_NUMBER_MARGIN = 48;

/** the page's number font size, in scene units */
export const PAGE_NUMBER_FONT_SIZE = 28;

/**
 * The pages system.
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
 * A page size **preset** (D-144).
 *
 * A preset is a *shape*, not an absolute size: the widths and heights below
 * are the shapes a page of that paper size has (96 dpi), and what the teacher
 * picks is the **ratio** - the thing that decides how the page's text is laid
 * out and how the exported image comes out.
 *
 * The sizes are in document units rather than scene units on purpose: a
 * scene unit is not a physical size, so the honest thing a preset can carry is
 * the shape of the paper.
 */
export type PageSizePreset = {
  id: string;
  /** the label of the preset, in the locales */
  labelKey: TranslationKeys;
  /** the shape's width, in document units (96 dpi) */
  width: number;
  /** the shape's height, in document units (96 dpi) */
  height: number;
};

/**
 * The page sizes the teacher may pick from (D-144).
 *
 * The list is deliberately short and fixed: A4 and Letter, portrait and
 * landscape, the two screen ratios, and the project's own default.
 */
export const PAGE_SIZE_PRESETS: readonly PageSizePreset[] = [
  {
    id: "project",
    labelKey: "labels.pages.presets.project",
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
  },
  {
    id: "a4-portrait",
    labelKey: "labels.pages.presets.a4Portrait",
    width: 794,
    height: 1123,
  },
  {
    id: "a4-landscape",
    labelKey: "labels.pages.presets.a4Landscape",
    width: 1123,
    height: 794,
  },
  {
    id: "letter-portrait",
    labelKey: "labels.pages.presets.letterPortrait",
    width: 816,
    height: 1056,
  },
  {
    id: "letter-landscape",
    labelKey: "labels.pages.presets.letterLandscape",
    width: 1056,
    height: 816,
  },
  {
    id: "16-9",
    labelKey: "labels.pages.presets.wide169",
    width: 1280,
    height: 720,
  },
  {
    id: "4-3",
    labelKey: "labels.pages.presets.standard43",
    width: 1024,
    height: 768,
  },
];

/**
 * The page size a preset stands for, in scene units.
 *
 * A page may only grow (D-1), so the preset's **shape** is scaled up until
 * both of its sides are at least the minimum page size. The ratio - the part
 * the teacher sees in the export - is the preset's own; the absolute size
 * stays inside the project's rule that a page is never smaller than the
 * minimum.
 */
export const getPageSizeForPreset = (
  preset: PageSizePreset,
): { width: number; height: number } => {
  const factor = Math.max(
    PAGE_WIDTH / preset.width,
    PAGE_HEIGHT / preset.height,
  );

  return {
    width: Math.round(preset.width * factor),
    height: Math.round(preset.height * factor),
  };
};

/**
 * The preset a page's size came from, or null when it is a size of its own.
 *
 * The page remembers the preset it was picked from (two presets may share a
 * shape - 16:9 and the project's own 1920x1080 are the same page - and the
 * teacher has to see the one they picked). A page that has no preset of its
 * own is matched by its size, so a page written by an older version still
 * shows the preset it looks like.
 */
export const getPageSizePresetForPage = (
  page: ExcalidrawPage,
): PageSizePreset | null => {
  if (page.sizePreset) {
    const chosen = PAGE_SIZE_PRESETS.find(
      (preset) => preset.id === page.sizePreset,
    );

    if (chosen) {
      return chosen;
    }
  }

  const { width, height } = getPageSize(page);

  return (
    PAGE_SIZE_PRESETS.find((preset) => {
      const size = getPageSizeForPreset(preset);
      return size.width === width && size.height === height;
    }) ?? null
  );
};

/**
 * The properties of a page the teacher may change (D-144).
 *
 * A size is clamped to the minimum page size, exactly as a page that grew to
 * contain imported content is (D-1, D-5).
 */
export type PageProperties = Partial<
  Pick<ExcalidrawPage, "frame" | "number" | "width" | "height" | "sizePreset">
>;

/**
 * Applies the teacher's changes to a page.
 *
 * The page is a fact about the document, so the change is a change of the
 * page - not of the elements on it, and not of the view.
 */
export const updatePage = ({
  pages,
  pageId,
  properties,
}: {
  pages: readonly ExcalidrawPage[];
  pageId: string;
  properties: PageProperties;
}): readonly ExcalidrawPage[] => {
  if (!pages.some((page) => page.id === pageId)) {
    return pages;
  }

  return pages.map((page) => {
    if (page.id !== pageId) {
      return page;
    }

    const next: ExcalidrawPage = { ...page, ...properties };

    if (properties.width !== undefined) {
      next.width = Math.max(properties.width, PAGE_WIDTH);
    }

    if (properties.height !== undefined) {
      next.height = Math.max(properties.height, PAGE_HEIGHT);
    }

    return next;
  });
};

/**
 * The frame and the number a page draws (D-144).
 *
 * The frame is the page's **own** rectangle - the page is the frame, so there
 * is nothing to place. The number is the page's number (its place in the
 * page list, counting from one), in the page's footer, the way Word puts a
 * page number in a footer.
 *
 * Both are facts about the page, so they are derived here from the page list
 * alone: the editor and the exporter ask the same question and get the same
 * answer.
 */
export const getPageDecoration = ({
  pages,
  pageId,
}: {
  pages: readonly ExcalidrawPage[];
  pageId: string;
}): PageDecoration => {
  const page = pages.find((candidate) => candidate.id === pageId);

  if (!page) {
    return { frame: null, number: null };
  }

  const pageRect = getPageRect(pages, pageId);

  return {
    frame: page.frame ? pageRect : null,
    number: page.number
      ? {
          text: String(getPageIndex(pages, pageId) + 1),
          x: pageRect.x + pageRect.width / 2,
          y: pageRect.y + pageRect.height - PAGE_NUMBER_MARGIN,
        }
      : null,
  };
};

/**
 * Zoom at which the whole page fits inside the viewport.
 *
 * This is the zoom the page is **framed** at - it is not the zoom's **floor**
 * (D-117): the page is the bound for **panning**, not for **zooming out**, so
 * the camera may go below this and the page is simply smaller on the screen.
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
  // The zoom's **floor** is a fixed small value, not the page's fit zoom
  // (D-117). The page is the bound for **panning** - the teacher may scroll to
  // the page and no further - but it is not a bound on how far **out** the view
  // may zoom: below the fit zoom the page is simply smaller on the screen, with
  // more of it visible, and the chrome can be inspected at a small zoom. The
  // − button used to be a no-op at exactly the fit zoom, because the clamp
  // pinned the zoom back to it (the owner measured 56 %, 36 % and 73 % in the
  // three window sizes).
  //
  // The floor is `MIN_ZOOM` - the **one** number it is written in, and the same
  // number the zoom-out button's disabled state uses, so the button and the
  // camera can never disagree about where the floor is.
  const minZoom = MIN_ZOOM;
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
 * Where the view sits on the current page, as a **signed** ratio of the page's
 * size.
 *
 * The offset is how far the page's near edge sits behind the viewport's near
 * edge, measured in page widths (and heights). It is positive when the page
 * has been scrolled past, and **negative** when the page overhangs the
 * viewport's near edge — which is exactly what centring a page that is wider
 * than the viewport looks like.
 *
 * The offset is bounded **above** at 1 (the camera clamp guarantees the view
 * never travels past the page's far edge) and is **not** bounded below: a page
 * that is much narrower than the viewport produces a ratio of -80 or worse, and
 * clamping that away would throw away real geometry.
 *
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
  // `-pageRect.x` the camera has travelled.
  //
  // The `+ 0` normalises the negative zero that negating a zero produces, so
  // a page whose near edge sits exactly on the viewport's near edge still
  // reports a plain `0`.
  /** signed ratio: how far the page's near edge is behind the viewport's near edge, in page widths */
  offsetX: Math.min(-(pageRect.x + scrollX) / pageRect.width, 1) + 0,
  /** signed ratio: how far the page's near edge is behind the viewport's near edge, in page heights */
  offsetY: Math.min(-(pageRect.y + scrollY) / pageRect.height, 1) + 0,
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
 * 4. **Size**: a page is as big as the content of its own cell needs: its
 *    size is the bounding box of that content, measured in **cell-relative**
 *    coordinates, with a minimum of `PAGE_WIDTH` x `PAGE_HEIGHT`. An element
 *    that straddles a cell border therefore still fits — wholly — on its
 *    page, instead of hanging over the page's edge where the camera cannot
 *    reach it.
 * 5. **Place**: the surviving cells become the pages, in **row major** order
 *    (the top-left cell first, then left to right, then down), so the board
 *    reads in reading order. The pages are laid out in the **cumulative**
 *    order the library uses ({@link getPageRectAtIndex}): the pages have
 *    differing widths, so they do not share a constant pitch, and the content
 *    of a cell keeps its position *within* that cell.
 *
 * The cell of an element is decided by the element's **origin** — the same
 * `x` / `y` the renderer places it by. A free-draw stroke's origin is
 * *inside* the stroke rather than at its top-left corner, so a stroke can
 * reach left of / above the cell it was assigned to, and a page — which can
 * only grow to the right and downwards (D-5) — cannot contain it there. The
 * content of such a cell is therefore pushed into its page by as much as it
 * must be, and by no more; for everything else the push is zero.
 *
 * ## What it does not do
 *
 * - It does not **scale** anything: an element keeps its size, type and style.
 * - It does not move a **floating** element: a floating element is not owned
 *   by a page, so it is left exactly where it is.
 * - It does not **tile** a **deleted** element: a deleted element is a
 *   tombstone, not content, so it is re-anchored with the rest (it keeps its
 *   place relative to its neighbours) but it is never given a page of its own.
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
 * `PAGE_HEIGHT`), which is also the minimum: a page may only grow (D-1). The
 * gap between two page rects belongs to the **page layout**, and the layout
 * is the library's own cumulative one ({@link getPageRectAtIndex}), whose gap
 * is the fixed `PAGE_SPACING` — a `spacing` of its own is therefore not
 * supported, and asking for one is an error rather than a silent no-op.
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
  const pageHeight = Math.max(options?.pageHeight ?? PAGE_HEIGHT, PAGE_HEIGHT);

  // the gap between two page rects belongs to the page layout, and the
  // layout is the library's own cumulative one — its gap is fixed
  const spacing = options?.spacing ?? PAGE_SPACING;

  if (spacing !== PAGE_SPACING) {
    throw new Error(
      `paginateContentIntoPages: the gap between two page rects is fixed at PAGE_SPACING (${PAGE_SPACING}) — the pages are laid out by the library's own cumulative layout, so a custom spacing is not supported.`,
    );
  }

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

  // the cells that hold content, and the elements in them
  const cells = new Map<
    string,
    { col: number; row: number; elements: ExcalidrawElement[] }
  >();

  for (const element of content) {
    const { col, row } = cellOf(element.x + dx, element.y + dy);
    const key = cellKey(col, row);
    const cell = cells.get(key);

    if (cell) {
      cell.elements.push(element);
    } else {
      cells.set(key, { col, row, elements: [element] });
    }
  }

  // row major: the top-left cell first, then left to right, then down
  const ordered = [...cells.values()].sort(
    (a, b) => a.row - b.row || a.col - b.col,
  );

  /**
   * The page that holds a cell, and how much the cell's content had to be
   * pushed into it.
   *
   * The size of the page is the bounding box of the cell's own elements,
   * measured in **cell-relative** coordinates — the position the element has
   * inside its cell. The cell-relative box does not depend on the page
   * layout, so the sizing cannot feed back into the placement: the sizes are
   * settled first, and the origins follow from them.
   *
   * A page grows to the right and downwards only — its origin is derived from
   * the layout and is not stored (D-5). A free-draw stroke's origin is
   * *inside* the stroke rather than at its top-left corner, so a stroke can
   * reach left of / above the cell it was assigned to. The cell's content is
   * therefore pushed into its page by as much as it must be, and by no more:
   * the shift is the negative part of the cell's bounding box, and it is zero
   * for the common case (a rectangle, or a stroke that stays inside its
   * cell).
   */
  const sized = ordered.map((cell, index) => {
    const relative = cell.elements.map((element) => ({
      ...element,
      x: element.x + dx - cell.col * pageWidth,
      y: element.y + dy - cell.row * pageHeight,
    }));

    const [minX, minY, maxX, maxY] = getCommonBounds(relative);

    const shiftX = Math.min(0, minX);
    const shiftY = Math.min(0, minY);

    return {
      shiftX,
      shiftY,
      page: {
        id: tiledPageId(index),
        name: `Page ${index + 1}`,
        width: Math.max(pageWidth, maxX - shiftX),
        height: Math.max(pageHeight, maxY - shiftY),
      } as ExcalidrawPage,
    };
  });

  const pages: ExcalidrawPage[] = sized.map((entry) => entry.page);

  // the page origins: the library's own cumulative layout. The pages have
  // differing widths, so the pitch is not a constant.
  const pageRects = pages.map((_, index) => getPageRectAtIndex(pages, index));

  const pageIndexByCell = new Map<string, number>();

  ordered.forEach((cell, index) => {
    pageIndexByCell.set(cellKey(cell.col, cell.row), index);
  });

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
    const { shiftX, shiftY } = sized[pageIndex];
    const rect = pageRects[pageIndex];

    return {
      ...element,
      // the element keeps its position within its cell, and the cell is
      // placed on its page
      x: rect.x + (x - col * pageWidth) - shiftX,
      y: rect.y + (y - row * pageHeight) - shiftY,
      pageId: pages[pageIndex].id,
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

/**
 * Whether an element lies **entirely** inside a page's rect.
 *
 * The measurement is the library's own: the element's bounding box, taken
 * with `getCommonBounds` (so an element is measured the way it is drawn),
 * against the page's rect.
 *
 * A line that straddles the page's edge is **not** inside it: half a line
 * hanging over the edge is not readable, and the camera — which is clamped to
 * the page rect — cannot reach it (D-25).
 */
export const isElementInsidePageRect = (
  element: ExcalidrawElement,
  pageRect: PageRect,
): boolean => {
  const [minX, minY, maxX, maxY] = getCommonBounds([element]);

  return (
    minX >= pageRect.x &&
    minY >= pageRect.y &&
    maxX <= pageRect.x + pageRect.width &&
    maxY <= pageRect.y + pageRect.height
  );
};

/**
 * How many of the elements lie entirely inside a page's rect.
 *
 * The count stops at the first element that does not: the text is a run of
 * lines, and the lines that follow the first one that does not fit are the
 * ones that overflow (D-25).
 */
export const countElementsInsidePageRect = (
  elements: readonly ExcalidrawElement[],
  pageRect: PageRect,
): number => {
  let count = 0;

  for (const element of elements) {
    if (!isElementInsidePageRect(element, pageRect)) {
      break;
    }

    count++;
  }

  return count;
};

/**
 * Moves a block of elements so that it lies inside a page's rect.
 *
 * A page's origin is derived from the layout and cannot be stored, so a page
 * grows to the right and downwards only (D-5): content that lies left of /
 * above the page's origin can never be contained by growing the page, and the
 * camera — which is clamped to the page rect — cannot reach it. Nudging the
 * block into the page is what makes it reachable at all.
 *
 * The block keeps its shape: it is moved as a whole.
 */
export const moveElementsIntoPageRect = <T extends ExcalidrawElement>(
  elements: readonly T[],
  pageRect: PageRect,
): T[] => {
  if (!elements.length) {
    return [];
  }

  const [minX, minY] = getCommonBounds(elements);

  const dx = minX < pageRect.x ? pageRect.x - minX : 0;
  const dy = minY < pageRect.y ? pageRect.y - minY : 0;

  if (!dx && !dy) {
    return [...elements];
  }

  return elements.map(
    (element) =>
      ({
        ...element,
        x: element.x + dx,
        y: element.y + dy,
      } as T),
  );
};

/**
 * Places a run of elements on a page.
 *
 * The run keeps its shape — the lines stay where they were relative to each
 * other — and is stacked from the top of the page. `offsetX` is the distance
 * between the page's left edge and the run's left edge.
 */
export const moveElementsOntoPage = <T extends ExcalidrawElement>(
  elements: readonly T[],
  pageRect: PageRect,
  offsetX: number,
): T[] => {
  if (!elements.length) {
    return [];
  }

  const first = elements[0];

  return elements.map(
    (element) =>
      ({
        ...element,
        x: element.x - first.x + pageRect.x + offsetX,
        y: element.y - first.y + pageRect.y,
      } as T),
  );
};
