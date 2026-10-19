/**
 * Page camera maths.
 *
 * Every assertion here goes through `sceneCoordsToViewportCoords` — the
 * library's own conversion — rather than re-deriving the formula. That is the
 * whole point of the file: a camera implementation that is internally
 * self-consistent but disagrees with the renderer about which way is "right"
 * would sail past any test written against its own arithmetic, and would put
 * page 2+ off the side of the screen while looking perfectly correct on paper.
 */

import { describe, expect, it } from "vitest";

import { sceneCoordsToViewportCoords, MAX_ZOOM } from "@excalidraw/common";

import {
  clampCameraToPage,
  getCameraForPage,
  getCameraFromPageRelative,
  getFitPageZoom,
  getPageRectByIndex,
  getPageRelativeCamera,
} from "../scene/pages";

import type { NormalizedZoomValue, PageRect } from "../types";

const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 800;

/** tolerance for float drift, in CSS px */
const EPS = 0.001;

/** the page at `index`, and the same page again as "page 2" for readability */
const PAGE_2 = getPageRectByIndex(1);

/** maps a scene point through the library's renderer maths onto the viewport */
const toViewport = (
  camera: { scrollX: number; scrollY: number; zoom: number },
  sceneX: number,
  sceneY: number,
) =>
  sceneCoordsToViewportCoords(
    { sceneX, sceneY },
    {
      zoom: { value: camera.zoom as NormalizedZoomValue },
      offsetLeft: 0,
      offsetTop: 0,
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
    },
  );

const clamp = (
  pageRect: PageRect,
  {
    scrollX,
    scrollY,
    zoom,
  }: { scrollX: number; scrollY: number; zoom: NormalizedZoomValue },
  viewportWidth = VIEWPORT_WIDTH,
) =>
  clampCameraToPage({
    scrollX,
    scrollY,
    zoom,
    viewportWidth,
    viewportHeight: VIEWPORT_HEIGHT,
    pageRect,
    maxZoom: MAX_ZOOM,
  });

const fit = (pageRect: PageRect, viewportWidth = VIEWPORT_WIDTH) =>
  getCameraForPage({
    viewportWidth,
    viewportHeight: VIEWPORT_HEIGHT,
    pageRect,
    maxZoom: MAX_ZOOM,
  });

describe("page camera", () => {
  it("frames a page that is not the first one inside the viewport", () => {
    const camera = fit(PAGE_2);

    const topLeft = toViewport(camera, PAGE_2.x, PAGE_2.y);
    const bottomRight = toViewport(
      camera,
      PAGE_2.x + PAGE_2.width,
      PAGE_2.y + PAGE_2.height,
    );

    // the whole page is on screen
    expect(topLeft.x).toBeGreaterThanOrEqual(-EPS);
    expect(topLeft.y).toBeGreaterThanOrEqual(-EPS);
    expect(bottomRight.x).toBeLessThanOrEqual(VIEWPORT_WIDTH + EPS);
    expect(bottomRight.y).toBeLessThanOrEqual(VIEWPORT_HEIGHT + EPS);
  });

  it("keeps the page on screen for the first page too", () => {
    const pageRect = getPageRectByIndex(0);
    const camera = fit(pageRect);

    const topLeft = toViewport(camera, pageRect.x, pageRect.y);
    const bottomRight = toViewport(
      camera,
      pageRect.x + pageRect.width,
      pageRect.y + pageRect.height,
    );

    expect(topLeft.x).toBeGreaterThanOrEqual(-EPS);
    expect(topLeft.y).toBeGreaterThanOrEqual(-EPS);
    expect(bottomRight.x).toBeLessThanOrEqual(VIEWPORT_WIDTH + EPS);
    expect(bottomRight.y).toBeLessThanOrEqual(VIEWPORT_HEIGHT + EPS);
  });

  it("lets a zoomed-in camera reach every part of the page", () => {
    // zoomed in far enough that only part of the page fits
    const fitZoom = getFitPageZoom(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    const zoomed = clamp(PAGE_2, {
      scrollX: 0,
      scrollY: 0,
      zoom: Math.min(fitZoom * 2, MAX_ZOOM) as NormalizedZoomValue,
    });

    // scrolling as far as the clamp allows in each direction
    const far = clamp(PAGE_2, {
      scrollX: zoomed.scrollX - 1e6,
      scrollY: zoomed.scrollY - 1e6,
      zoom: zoomed.zoom,
    });
    const near = clamp(PAGE_2, {
      scrollX: zoomed.scrollX + 1e6,
      scrollY: zoomed.scrollY + 1e6,
      zoom: zoomed.zoom,
    });

    // one end sits on the page's near corner, flush with the viewport origin
    expect(toViewport(near, PAGE_2.x, PAGE_2.y).x).toBeCloseTo(0, 3);
    expect(toViewport(near, PAGE_2.x, PAGE_2.y).y).toBeCloseTo(0, 3);

    // ...and the other reaches its far corner, which is what makes panning
    // down and right possible at all
    expect(
      toViewport(far, PAGE_2.x + PAGE_2.width, PAGE_2.y + PAGE_2.height).x,
    ).toBeCloseTo(VIEWPORT_WIDTH, 3);
    expect(
      toViewport(far, PAGE_2.x + PAGE_2.width, PAGE_2.y + PAGE_2.height).y,
    ).toBeCloseTo(VIEWPORT_HEIGHT, 3);
  });

  it("leaves a legitimate zoom alone instead of yanking the view", () => {
    const start = fit(PAGE_2);
    const nextZoom = Math.min(
      start.zoom * 1.5,
      MAX_ZOOM,
    ) as NormalizedZoomValue;

    // this is what the editor's own zoom does: hold the middle of the viewport
    // still, and work out the scroll that keeps it there
    const sceneCentreX = VIEWPORT_WIDTH / 2 / start.zoom - start.scrollX;
    const sceneCentreY = VIEWPORT_HEIGHT / 2 / start.zoom - start.scrollY;
    const anchored = {
      scrollX: VIEWPORT_WIDTH / 2 / nextZoom - sceneCentreX,
      scrollY: VIEWPORT_HEIGHT / 2 / nextZoom - sceneCentreY,
    };

    const result = clamp(PAGE_2, { ...anchored, zoom: nextZoom });

    // the clamp's job is to stop the user leaving the page, not to overrule a
    // zoom that is already inside it
    expect(result.scrollX).toBeCloseTo(anchored.scrollX, 3);
    expect(result.scrollY).toBeCloseTo(anchored.scrollY, 3);
  });

  it("reports the page-relative anchor the renderer will actually show", () => {
    const camera = fit(PAGE_2);

    const { offsetX, offsetY } = getPageRelativeCamera({
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
      pageRect: PAGE_2,
    });

    // checked against the renderer, not against the formula: a page whose near
    // edge is still on screen has nothing scrolled off it, and the fraction
    // must say so even when the page is centred with slack on both sides
    const leftEdge = toViewport(camera, PAGE_2.x, PAGE_2.y);

    if (leftEdge.x >= -EPS) {
      expect(offsetX).toBe(0);
    }
    if (leftEdge.y >= -EPS) {
      expect(offsetY).toBe(0);
    }
  });

  it("round-trips the page-relative anchor once the page overflows", () => {
    // the round trip is only lossless when there is scroll travel to describe:
    // a page that fits is centred, and "centred" has no distinct fraction
    const fitZoom = getFitPageZoom(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    const zoomed = clamp(PAGE_2, {
      scrollX: 0,
      scrollY: 0,
      zoom: Math.min(fitZoom * 2, MAX_ZOOM) as NormalizedZoomValue,
    });

    const mid = clamp(PAGE_2, {
      scrollX: zoomed.scrollX - 400,
      scrollY: zoomed.scrollY - 300,
      zoom: zoomed.zoom,
    });

    const { offsetX, offsetY } = getPageRelativeCamera({
      scrollX: mid.scrollX,
      scrollY: mid.scrollY,
      pageRect: PAGE_2,
    });

    const back = getCameraFromPageRelative({
      offsetX,
      offsetY,
      pageRect: PAGE_2,
    });

    expect(back.scrollX).toBeCloseTo(mid.scrollX, 3);
    expect(back.scrollY).toBeCloseTo(mid.scrollY, 3);
  });

  it("tracks how far the page has been scrolled, rather than clamping at zero", () => {
    const fitZoom = getFitPageZoom(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    const zoomed = clamp(PAGE_2, {
      scrollX: 0,
      scrollY: 0,
      zoom: Math.min(fitZoom * 2, MAX_ZOOM) as NormalizedZoomValue,
    });

    const near = clamp(PAGE_2, {
      scrollX: zoomed.scrollX + 1e6,
      scrollY: zoomed.scrollY + 1e6,
      zoom: zoomed.zoom,
    });
    const far = clamp(PAGE_2, {
      scrollX: zoomed.scrollX - 1e6,
      scrollY: zoomed.scrollY - 1e6,
      zoom: zoomed.zoom,
    });

    const anchor = (camera: { scrollX: number; scrollY: number }) =>
      getPageRelativeCamera({
        scrollX: camera.scrollX,
        scrollY: camera.scrollY,
        pageRect: PAGE_2,
      });

    expect(anchor(near).offsetX).toBeCloseTo(0, 3);
    expect(anchor(far).offsetX).toBeGreaterThan(0);
    expect(anchor(far).offsetY).toBeGreaterThan(0);
  });
});
