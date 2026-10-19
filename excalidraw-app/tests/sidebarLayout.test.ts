import { describe, expect, it } from "vitest";

import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import {
  DEFAULT_SIDEBAR_WIDTH,
  getCurrentPageRect,
  getFitPageZoom,
  getPageViewportWidth,
  MIN_PAGE_VIEWPORT_WIDTH,
} from "@excalidraw/excalidraw";

import type { ExcalidrawPage } from "@excalidraw/excalidraw/types";

import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH as APP_DEFAULT_SIDEBAR_WIDTH,
  getAutoFitCamera,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from "../sidebar/useSidebarLayout";

const PAGES: ExcalidrawPage[] = [
  { id: "page-1", name: "Page 1" },
  { id: "page-2", name: "Page 2" },
];

describe("clampSidebarWidth", () => {
  it("keeps a drag inside the usable range", () => {
    expect(clampSidebarWidth(50)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(5000)).toBe(MAX_SIDEBAR_WIDTH);
  });

  it("rounds to whole pixels", () => {
    expect(clampSidebarWidth(321.4)).toBe(321);
    expect(clampSidebarWidth(321.6)).toBe(322);
  });

  it("falls back to the default for nonsense input", () => {
    expect(clampSidebarWidth(NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(0)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("agrees with the library default, so nothing changes until dragged", () => {
    expect(APP_DEFAULT_SIDEBAR_WIDTH).toBe(DEFAULT_SIDEBAR_WIDTH);
  });
});

describe("getPageViewportWidth", () => {
  it("discounts the space the sidebar covers", () => {
    expect(getPageViewportWidth(1400, 300)).toBe(1100);
  });

  it("is a no-op when nothing is covered", () => {
    expect(getPageViewportWidth(1400, 0)).toBe(1400);
  });

  it("never shrinks below the floor, so a huge sidebar cannot hide the page", () => {
    expect(getPageViewportWidth(1000, 900)).toBe(MIN_PAGE_VIEWPORT_WIDTH);
  });

  it("does not invent width on a tiny viewport", () => {
    // 300 < the floor, so the floor must yield rather than force the page wider
    expect(getPageViewportWidth(300, 200)).toBe(300);
  });

  it("passes through an unmeasured viewport", () => {
    expect(getPageViewportWidth(0, 300)).toBe(0);
  });
});

describe("getAutoFitCamera", () => {
  const fit = (viewportWidth: number, sidebarWidth: number, covered: boolean) =>
    getAutoFitCamera({
      viewportWidth,
      viewportHeight: 800,
      pages: PAGES,
      currentPageId: "page-1",
      sidebarWidth,
      sidebarCoversCanvas: covered,
    });

  it("fits the page into what the sidebar leaves behind", () => {
    const withoutSidebar = fit(1400, 300, false);
    const withSidebar = fit(1400, 300, true);

    // the whole point: a wider sidebar means a smaller page, and the page
    // shrinks by exactly the sidebar's share
    expect(withSidebar.zoom).toBeLessThan(withoutSidebar.zoom);
    expect(withSidebar.zoom).toBeCloseTo(getFitPageZoom(1100, 800), 6);
  });

  it("keeps the page flush with the left edge so the sidebar never covers it", () => {
    const { scrollX, zoom } = fit(1400, 300, true);

    // page 1 starts at scene x = 0, so the page's left edge lands at screen x=0
    expect(scrollX).toBeCloseTo(0, 6);
    // and it ends exactly where the sidebar begins
    expect(1920 * zoom).toBeCloseTo(1100, 6);
  });

  it("uses the full canvas when the sidebar is closed", () => {
    expect(fit(1400, 300, false).zoom).toBeCloseTo(
      getFitPageZoom(1400, 800),
      6,
    );
  });

  it("frames the requested page, not always the first one", () => {
    const camera = getAutoFitCamera({
      viewportWidth: 1400,
      viewportHeight: 800,
      pages: PAGES,
      currentPageId: "page-2",
      sidebarWidth: 300,
      sidebarCoversCanvas: true,
    });

    // page 2 sits a whole PAGE_GAP further along, and the camera has to
    // account for it. `scrollX` is a *negated* scene offset, so reaching a page
    // that starts further right means scrolling negative — the old expectation
    // of `+page2Rect.x` is what framed a viewport nowhere near page 2.
    //
    // Checked through the renderer's own conversion rather than the arithmetic,
    // so a camera that disagrees with the renderer cannot pass.
    const page2Rect = getCurrentPageRect(PAGES, "page-2");
    expect(page2Rect.x).toBeGreaterThan(0);

    const freeWidth = 1400 - 300;
    const screenX = (sceneX: number) =>
      sceneCoordsToViewportCoords(
        { sceneX, sceneY: page2Rect.y },
        {
          zoom: { value: camera.zoom },
          offsetLeft: 0,
          offsetTop: 0,
          scrollX: camera.scrollX,
          scrollY: camera.scrollY,
        },
      ).x;

    // the page fills exactly the strip the sidebar leaves behind
    expect(screenX(page2Rect.x)).toBeCloseTo(0, 3);
    expect(screenX(page2Rect.x + page2Rect.width)).toBeCloseTo(freeWidth, 3);
  });

  it("survives a degenerate viewport", () => {
    const camera = fit(0, 300, true);
    expect(Number.isFinite(camera.scrollX)).toBe(true);
    expect(Number.isFinite(camera.zoom)).toBe(true);
  });
});
