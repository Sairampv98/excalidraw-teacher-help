import { afterEach, describe, expect, it } from "vitest";

import {
  NO_COVER,
  readCover,
  viewportCenterScene,
  viewportToScene,
} from "../sidebar/insertIntoScene";

import type { ViewportFrame } from "../sidebar/insertIntoScene";

const PAGE_WIDTH = 1920;
const PAGE_HEIGHT = 1080;

/**
 * The scene numbers below are the ones the video showed: a ~1163x800 canvas at
 * 55% zoom showing the whole 1920x1080 page.
 *
 * Sign convention (this is the part that is easy to get wrong, and getting it
 * wrong is what the old code did): the library derives the leftmost visible
 * scene x as `-scrollX`, so a page *smaller* than the visible extent — i.e.
 * fitted and centred — has a **positive** `scrollX`. Here the canvas shows
 * 1163 / 0.55 = 2114.5 scene px, so the page is over-scrolled by
 * (2114.5 - 1920) / 2 = 97.3 on each axis.
 */
const FITTED_PAGE: ViewportFrame = {
  left: 0,
  top: 40,
  width: 1163,
  height: 800,
  scrollX: 97.27,
  scrollY: 187.27,
  zoom: 0.55,
};

/** what the pre-pages formula in this file used to compute, kept as the foil */
const oldFormula = (
  { clientX, clientY }: { clientX: number; clientY: number },
  frame: ViewportFrame,
) => ({
  x: (clientX - frame.left) * frame.zoom + frame.scrollX,
  y: (clientY - frame.top) * frame.zoom + frame.scrollY,
});

describe("viewportToScene", () => {
  it("divides by the zoom and subtracts the scroll", () => {
    const point = viewportToScene(
      { clientX: 500, clientY: 400 },
      { ...FITTED_PAGE, scrollX: 0, scrollY: 0, zoom: 2 },
    );

    expect(point.x).toBe(250);
    expect(point.y).toBe(180);
  });

  it("is the identity at 100% with no scroll", () => {
    const point = viewportToScene(
      { clientX: 123, clientY: 456 },
      { ...FITTED_PAGE, left: 0, top: 0, scrollX: 0, scrollY: 0, zoom: 1 },
    );

    expect(point).toEqual({ x: 123, y: 456 });
  });

  it("accounts for a canvas that does not start at the viewport origin", () => {
    const point = viewportToScene(
      { clientX: 200, clientY: 150 },
      { ...FITTED_PAGE, left: 100, top: 50, scrollX: 0, scrollY: 0, zoom: 1 },
    );

    expect(point).toEqual({ x: 100, y: 100 });
  });

  it("keeps a drop in the right half of the canvas in the right half of the page", () => {
    // the case from the video: released around two thirds across, and it used
    // to land in the top-left of the page
    const at = { clientX: 972, clientY: 384 };
    const point = viewportToScene(at, FITTED_PAGE);

    expect(point.x).toBeGreaterThan(PAGE_WIDTH * 0.75);
    expect(point.y).toBeGreaterThan(PAGE_HEIGHT * 0.3);
  });

  it("does not agree with the pre-pages formula it replaced", () => {
    const at = { clientX: 600, clientY: 440 };

    const now = viewportToScene(at, FITTED_PAGE);
    const before = oldFormula(at, FITTED_PAGE);

    // the two error compounds in the same direction: ~566 scene px (30% of
    // the page) off horizontally and ~133 (12% of the page height) off
    // vertically, both pulled back towards the page origin
    expect(now.x - before.x).toBeGreaterThan(PAGE_WIDTH * 0.2);
    expect(now.y - before.y).toBeGreaterThan(PAGE_HEIGHT * 0.1);
  });

  it("never collapses a mid-canvas drop towards the page origin", () => {
    const point = viewportToScene({ clientX: 600, clientY: 440 }, FITTED_PAGE);

    expect(point.x).toBeGreaterThan(PAGE_WIDTH * 0.4);
    expect(point.y).toBeGreaterThan(PAGE_HEIGHT * 0.3);
  });
});

describe("viewportCenterScene", () => {
  it("returns the middle of what is on screen", () => {
    const point = viewportCenterScene({
      ...FITTED_PAGE,
      left: 0,
      top: 0,
      scrollX: 0,
      scrollY: 0,
      zoom: 1,
    });

    expect(point).toEqual({
      x: FITTED_PAGE.width / 2,
      y: FITTED_PAGE.height / 2,
    });
  });

  it("centres on the page, not the top-left corner, when the page is fitted", () => {
    // this is what the "Insert into canvas" button used to get wrong
    const point = viewportCenterScene(FITTED_PAGE);

    expect(point.x).toBeCloseTo(PAGE_WIDTH / 2, 0);
    expect(point.y).toBeCloseTo(PAGE_HEIGHT / 2, 0);
  });

  it("moves the centre when the user pans", () => {
    const base = viewportCenterScene({
      ...FITTED_PAGE,
      scrollX: 0,
      scrollY: 0,
    });
    const panned = viewportCenterScene({
      ...FITTED_PAGE,
      scrollX: FITTED_PAGE.scrollX + 500,
    });

    // scrolling right reveals scene further along the page
    expect(panned.x).toBeLessThan(base.x);
  });
});

/**
 * The sidebar is an overlay, not a docked panel: it does not shrink the canvas
 * wrapper, it sits on top of it. So "the centre of the canvas" is not "the
 * centre of what you can see", and an insert placed at the former lands under
 * the panel.
 */
describe("viewportCenterScene with a panel covering the canvas", () => {
  // the narrow window from the video: a 337px canvas with the sidebar
  // covering its right-hand 157px, leaving a 180px visible strip
  const NARROW: ViewportFrame = {
    left: 0,
    top: 0,
    width: 337,
    height: 400,
    scrollX: 0,
    scrollY: 0,
    zoom: 1,
  };

  it("ignores an empty cover", () => {
    expect(viewportCenterScene(NARROW, NO_COVER)).toEqual(
      viewportCenterScene(NARROW),
    );
  });

  it("pulls the centre away from a right-hand panel", () => {
    const hidden = viewportCenterScene(NARROW);
    const shown = viewportCenterScene(NARROW, { left: 0, right: 157 });

    expect(hidden.x).toBeCloseTo(337 / 2, 5);
    // the visible strip is [0, 180], so its middle is 90
    expect(shown.x).toBeCloseTo(90, 5);
    expect(shown.x).toBeLessThan(hidden.x);
  });

  it("pushes the centre away from a left-hand panel, for right-to-left", () => {
    const hidden = viewportCenterScene(NARROW);
    const shown = viewportCenterScene(NARROW, { left: 157, right: 0 });

    // the visible strip is [157, 337], so its middle is 247
    expect(shown.x).toBeCloseTo(247, 5);
    expect(shown.x).toBeGreaterThan(hidden.x);
  });

  it("keeps the insert inside the visible strip in the video's geometry", () => {
    // the bug: centred on the raw box, the image straddled the panel edge and
    // read as "nothing happened"
    const cover = { left: 0, right: 157 };
    const edge = NARROW.width - cover.right;
    const centre = viewportCenterScene(NARROW, cover);

    expect(centre.x).toBeGreaterThanOrEqual(0);
    expect(centre.x).toBeLessThanOrEqual(edge);
  });

  it("leaves the vertical centre alone", () => {
    expect(viewportCenterScene(NARROW, { left: 0, right: 157 }).y).toBeCloseTo(
      viewportCenterScene(NARROW).y,
      5,
    );
  });

  it("does not go negative when the panel is wider than the canvas", () => {
    const centre = viewportCenterScene(NARROW, { left: 0, right: 900 });

    expect(centre.x).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(centre.x)).toBe(true);
  });

  it("scales the shift with the zoom, since the cover is in screen px", () => {
    const cover = { left: 0, right: 157 };
    const atOne = viewportCenterScene(NARROW, cover);
    const atTwo = viewportCenterScene({ ...NARROW, zoom: 2 }, cover);

    // the same 157px of panel is half as much scene at twice the zoom
    expect(atTwo.x).toBeCloseTo(atOne.x / 2, 5);
  });
});

describe("readCover", () => {
  /**
   * `readCover` resolves `.sidebar` from the document, so every stub has to be
   * removed again — a leftover one is found first by `querySelector` and turns
   * the next test's numbers into fiction.
   */
  const stubs: HTMLElement[] = [];

  afterEach(() => {
    for (const stub of stubs.splice(0)) {
      stub.remove();
    }
  });

  /** a canvas at the viewport origin with a settable box */
  const stubCanvas = (width: number, height: number) => {
    const el = document.createElement("canvas");
    el.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: width,
        bottom: height,
        width,
        height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
    return el;
  };

  const stubSidebar = (box: {
    left: number;
    top: number;
    width: number;
    height: number;
  }) => {
    const el = document.createElement("div");
    el.className = "sidebar";
    el.getBoundingClientRect = () =>
      ({
        ...box,
        right: box.left + box.width,
        bottom: box.top + box.height,
        x: box.left,
        y: box.top,
        toJSON: () => ({}),
      } as DOMRect);
    document.body.appendChild(el);
    stubs.push(el);
    return el;
  };

  it("reports no cover when there is no sidebar", () => {
    expect(readCover(stubCanvas(800, 600), document.body)).toEqual(NO_COVER);
  });

  it("reports no cover when there is no canvas", () => {
    stubSidebar({ left: 500, top: 0, width: 300, height: 600 });

    expect(readCover(null, document.body)).toEqual(NO_COVER);
  });

  it("measures a right-docked sidebar as right-edge cover", () => {
    // the common case: a 302px sidebar over an 800px canvas
    stubSidebar({ left: 498, top: 0, width: 302, height: 600 });

    expect(readCover(stubCanvas(800, 600), document.body)).toEqual({
      left: 0,
      right: 302,
    });
  });

  it("measures a left-docked sidebar as left-edge cover", () => {
    stubSidebar({ left: 0, top: 0, width: 302, height: 600 });

    expect(readCover(stubCanvas(800, 600), document.body)).toEqual({
      left: 302,
      right: 0,
    });
  });

  it("counts nothing when the panel does not vertically overlap", () => {
    // a docked panel narrows the wrapper instead of covering it, so the
    // canvas rect it is compared against never reaches it
    stubSidebar({ left: 498, top: 600, width: 302, height: 200 });

    expect(readCover(stubCanvas(800, 600), document.body)).toEqual(NO_COVER);
  });

  it("clips to the canvas width when the panel overhangs it", () => {
    stubSidebar({ left: 600, top: 0, width: 400, height: 600 });

    expect(readCover(stubCanvas(800, 600), document.body)).toEqual({
      left: 0,
      right: 200,
    });
  });

  it("reads the live library class name, not an app-specific one", () => {
    // a regression guard: the selector has to keep matching what the library
    // renders (CLASSES.SIDEBAR), or the cover silently becomes zero
    const sidebar = document.createElement("div");
    sidebar.className = "excalidraw sidebar sidebar--docked";
    sidebar.getBoundingClientRect = () =>
      ({
        left: 498,
        top: 0,
        right: 800,
        bottom: 600,
        width: 302,
        height: 600,
        x: 498,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
    document.body.appendChild(sidebar);
    stubs.push(sidebar);

    expect(readCover(stubCanvas(800, 600), document.body)).toEqual({
      left: 0,
      right: 302,
    });
  });
});
