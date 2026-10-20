/**
 * Pages system.
 *
 * Regression guard for: `newElement()` in @excalidraw/element cannot know the
 * current page (dependency cycle), so it defaults to the first page. Every
 * creation path funnels through `App.insertNewElements()`, which stamps the real
 * page — without that stamp, anything drawn while a later page was active landed
 * on page 1 and therefore vanished from the editor.
 *
 * The `AC-1`..`AC-5` block below covers the *document* model: a file's pages
 * are the file's own, never the running app's, and imported content has to be
 * reachable by the clamped camera. `AC-10` covers the *insertion* rule: a
 * paste is an insertion into the live scene, so it belongs to the page the
 * user is on.
 */

import {
  MAX_ZOOM,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import { getCommonBounds, newElementWith } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
} from "@excalidraw/element/types";
import type { LocalPoint } from "@excalidraw/math";

import type { AppState, ToolType } from "@excalidraw/excalidraw/types";

import { getDefaultAppState } from "../appState";
import { actionWrapTextInContainer } from "../actions/actionBoundText";
import { actionWrapSelectionInFrame } from "../actions/actionFrame";
import { createPasteEvent, serializeAsClipboardJSON } from "../clipboard";
import { loadFromBlob } from "../data";
import { Excalidraw } from "../index";
import {
  clampCameraToPage,
  deletePage,
  deletePageElements,
  getElementsForPage,
  getPageClampRect,
  getPageRect,
  paginateContentIntoPages,
  scalePageContent,
  translateContentForPageLayout,
} from "../scene/pages";
import {
  DEFAULT_PAGE_ID,
  PAGE_HEIGHT,
  PAGE_SPACING,
  PAGE_WIDTH,
} from "../types";

import { render, fireEvent, act, waitFor, GlobalTestState } from "./test-utils";
import { API } from "./helpers/api";
import { UI } from "./helpers/ui";

import type { NormalizedZoomValue, PageRect } from "../types";

const { h } = window;

const TWO_PAGES = [
  { id: "page-1", name: "Page 1" },
  { id: "page-2", name: "Page 2" },
];

const drawRectangle = async (
  getByToolName: (...names: (ToolType | "lock")[]) => HTMLElement,
  canvas: Element,
) => {
  fireEvent.click(getByToolName("rectangle"));
  fireEvent.pointerDown(canvas, { clientX: 30, clientY: 20 });
  fireEvent.pointerMove(canvas, { clientX: 160, clientY: 120 });
  fireEvent.pointerUp(canvas);
};

const nonDeleted = () => h.elements.filter((el) => !el.isDeleted);

describe("pages", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stamps newly created elements with the page being edited", async () => {
    const { getByToolName, container } = await render(
      <Excalidraw pagesEnabled={true} />,
    );
    h.state.width = 1000;
    h.state.height = 1000;

    h.setState({ pages: TWO_PAGES, currentPageId: "page-2" });

    await drawRectangle(
      getByToolName,
      container.querySelector("canvas.interactive")!,
    );

    const created = nonDeleted();
    expect(created.length).toBe(1);
    expect(created[0].pageId).toBe("page-2");
  });

  it("still stamps the first page when it is the active page", async () => {
    const { getByToolName, container } = await render(
      <Excalidraw pagesEnabled={true} />,
    );
    h.state.width = 1000;
    h.state.height = 1000;

    h.setState({ pages: TWO_PAGES, currentPageId: "page-1" });

    await drawRectangle(
      getByToolName,
      container.querySelector("canvas.interactive")!,
    );

    const created = nonDeleted();
    expect(created.length).toBe(1);
    expect(created[0].pageId).toBe("page-1");
  });

  it("keeps elements in the scene when the other page is shown", async () => {
    const { getByToolName, container } = await render(
      <Excalidraw pagesEnabled={true} />,
    );
    h.state.width = 1000;
    h.state.height = 1000;

    h.setState({ pages: TWO_PAGES, currentPageId: "page-2" });

    await drawRectangle(
      getByToolName,
      container.querySelector("canvas.interactive")!,
    );

    // switching away must only filter what is *drawn*, never drop elements
    h.setState({ currentPageId: "page-1" });
    expect(nonDeleted().length).toBe(1);

    h.setState({ currentPageId: "page-2" });
    expect(nonDeleted()[0].pageId).toBe("page-2");
  });

  it("AC-10 pastes onto the page being edited", async () => {
    await render(<Excalidraw pagesEnabled={true} autoFocus={true} />);
    h.state.width = 1000;
    h.state.height = 1000;

    act(() => {
      h.setState({ pages: TWO_PAGES, currentPageId: "page-2" });
    });

    // the content was copied on page 1 and is pasted on page 2 — the case that
    // used to break: the paste kept the clipboard's own page, so the content
    // landed on page 1 and the canvas (which draws the current page only)
    // showed nothing
    const copiedOnPage1 = newElementWith(
      API.createElement({ type: "rectangle" }),
      { pageId: "page-1" },
    );

    const clipboardJSON = await serializeAsClipboardJSON({
      elements: [copiedOnPage1],
      files: null,
    });

    // jsdom has no layout, so `elementFromPoint` cannot resolve the canvas on
    // its own — the paste handler needs it to know the paste targets the canvas
    const elementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => GlobalTestState.canvas;

    try {
      document.dispatchEvent(
        createPasteEvent({ types: { "text/plain": clipboardJSON } }),
      );

      await waitFor(() => {
        expect(h.elements.length).toBe(1);
      });
    } finally {
      document.elementFromPoint = elementFromPoint;
    }

    // the pasted content belongs to the page the user is on — it used to land
    // on the first page, which made it invisible on every later page
    expect(h.elements[0].pageId).toBe("page-2");
  });

  it("puts a frame wrapped around the selection on the page being edited", async () => {
    await render(<Excalidraw pagesEnabled={true} />);
    h.state.width = 1000;
    h.state.height = 1000;

    act(() => {
      h.setState({ pages: TWO_PAGES, currentPageId: "page-2" });
    });

    const rectangle = API.createElement({ type: "rectangle" });
    act(() => {
      h.elements = [rectangle];
    });
    API.setSelectedElements([rectangle]);

    act(() => {
      (h.app as any).actionManager.executeAction(
        actionWrapSelectionInFrame,
        "ui",
      );
    });

    // the frame is new content in the live scene, so it belongs to the page
    // the user is on
    const frame = nonDeleted().find((el) => el.type === "frame");
    expect(frame).toBeDefined();
    expect(frame!.pageId).toBe("page-2");
  });

  it("puts a container wrapped around text on the page being edited", async () => {
    await render(<Excalidraw pagesEnabled={true} />);
    h.state.width = 1000;
    h.state.height = 1000;

    act(() => {
      h.setState({ pages: TWO_PAGES, currentPageId: "page-2" });
    });

    const text = API.createElement({ type: "text" });
    act(() => {
      h.elements = [text];
    });
    API.setSelectedElements([text]);

    act(() => {
      (h.app as any).actionManager.executeAction(
        actionWrapTextInContainer,
        "ui",
      );
    });

    // the container is new content in the live scene, so it belongs to the
    // page the user is on
    const container = nonDeleted().find((el) => el.type === "rectangle");
    expect(container).toBeDefined();
    expect(container!.pageId).toBe("page-2");
  });
});

/**
 * The document model: a file's pages are the file's own.
 *
 * Every camera assertion goes through `sceneCoordsToViewportCoords` — the
 * library's own conversion — rather than re-deriving the formula, so a
 * self-consistent-but-wrong implementation cannot pass.
 */
describe("pages — document model", () => {
  const VIEWPORT_WIDTH = 1200;
  const VIEWPORT_HEIGHT = 800;

  /** tolerance for float drift, in CSS px */
  const EPS = 0.001;

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

  /**
   * Asserts that the clamped camera can reach every element: the camera is
   * aimed at a corner of the element and then clamped to the page, and the
   * corner has to end up on the viewport.
   */
  const expectReachableByClampedCamera = (
    elements: readonly ExcalidrawElement[],
    pageRect: PageRect,
  ) => {
    expect(elements.length).toBeGreaterThan(0);

    for (const element of elements) {
      const [minX, minY, maxX, maxY] = getCommonBounds([element]);

      for (const [sceneX, sceneY] of [
        [minX, minY],
        [maxX, maxY],
      ]) {
        const camera = clampCameraToPage({
          scrollX: -sceneX,
          scrollY: -sceneY,
          zoom: 1 as NormalizedZoomValue,
          viewportWidth: VIEWPORT_WIDTH,
          viewportHeight: VIEWPORT_HEIGHT,
          pageRect,
          maxZoom: MAX_ZOOM,
        });

        const viewport = toViewport(camera, sceneX, sceneY);

        expect(viewport.x).toBeGreaterThanOrEqual(-EPS);
        expect(viewport.x).toBeLessThanOrEqual(VIEWPORT_WIDTH + EPS);
        expect(viewport.y).toBeGreaterThanOrEqual(-EPS);
        expect(viewport.y).toBeLessThanOrEqual(VIEWPORT_HEIGHT + EPS);
      }
    }
  };

  /** an element as it is written into a `.excalidraw` file */
  const fileElement = (overrides: Record<string, unknown> = {}) => ({
    id: "el-1",
    type: "rectangle",
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a0",
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    ...overrides,
  });

  /** a `.excalidraw` file — `appState` without `pages` is a vanilla file */
  const makeFile = ({
    elements = [fileElement()],
    appState = {},
  }: {
    elements?: Record<string, unknown>[];
    appState?: Record<string, unknown>;
  }) =>
    new Blob(
      [
        JSON.stringify({
          type: "excalidraw",
          version: 2,
          source: "https://excalidraw.com",
          elements,
          appState,
          files: {},
        }),
      ],
      { type: "application/json" },
    );

  /** the running app: two pages, and it is showing the second one */
  const runningAppState = (): AppState => ({
    ...getDefaultAppState(),
    pages: TWO_PAGES,
    currentPageId: "page-2",
    width: 1000,
    height: 1000,
    offsetTop: 0,
    offsetLeft: 0,
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it("AC-1 opens a vanilla file on the first page", async () => {
    const { elements, appState } = await loadFromBlob(
      makeFile({ appState: { viewBackgroundColor: "#ffffff" } }),
      runningAppState(),
      null,
    );

    // the file defines no pages, so it restores to exactly one page — the
    // running app's second page must not be inherited
    expect(appState.pages).toHaveLength(1);
    expect(appState.pages[0].id).toBe(DEFAULT_PAGE_ID);
    expect(appState.currentPageId).toBe(DEFAULT_PAGE_ID);

    // every element is stamped to that page
    for (const element of elements) {
      expect(element.pageId).toBe(DEFAULT_PAGE_ID);
    }

    // ... and every element is reachable by the clamped camera
    expectReachableByClampedCamera(
      elements,
      getPageRect(appState.pages, appState.currentPageId),
    );
  });

  it("AC-2 grows the page to contain imported content", async () => {
    const { elements, appState } = await loadFromBlob(
      makeFile({
        elements: [
          fileElement({
            id: "el-far",
            x: 3000,
            y: 900,
            width: 400,
            height: 200,
          }),
        ],
      }),
      runningAppState(),
      null,
    );

    const pageRect = getPageRect(appState.pages, appState.currentPageId);

    // the content sticks out of the default page, so the page grew to contain
    // it — otherwise the content would be unreachable
    expect(pageRect.width).toBeGreaterThan(PAGE_WIDTH);
    expect(pageRect.width).toBeGreaterThanOrEqual(3400);
    expect(pageRect.height).toBeGreaterThanOrEqual(1100);

    expectReachableByClampedCamera(elements, pageRect);
  });

  it("AC-3 scales the page content and leaves the page rect alone", () => {
    const pages = [
      { id: "page-1", name: "Page 1" },
      { id: "page-2", name: "Page 2" },
    ];

    const anchored = newElementWith(
      API.createElement({
        type: "rectangle",
        x: 400,
        y: 300,
        width: 200,
        height: 100,
      }),
      { pageId: "page-1" },
    );

    const floating = newElementWith(
      API.createElement({
        type: "rectangle",
        // a floating element does not belong to the page: it may sit outside
        // the page rect
        x: 2500,
        y: 600,
        width: 100,
        height: 50,
      }),
      { pageId: "page-1", floating: true },
    );

    const onPage2 = newElementWith(
      API.createElement({
        type: "rectangle",
        x: 100,
        y: 100,
        width: 50,
        height: 50,
      }),
      { pageId: "page-2" },
    );

    const elements = [anchored, floating, onPage2];

    // scale content: the page rect is left alone, the anchored elements of
    // that page are scaled, the floating element is not
    const scaled = scalePageContent({ elements, pages, pageId: "page-1" });

    expect(getPageRect(scaled.pages, "page-1").width).toBe(PAGE_WIDTH);
    expect(getPageRect(scaled.pages, "page-1").height).toBe(PAGE_HEIGHT);

    expect(scaled.elements[0].x).toBe(200);
    expect(scaled.elements[0].y).toBe(150);
    expect(scaled.elements[0].width).toBe(100);
    expect(scaled.elements[0].height).toBe(50);

    expect(scaled.elements[1]).toBe(floating);
    expect(scaled.elements[2]).toBe(onPage2);

    // a floating element is not owned by its page, so the camera clamp widens
    // to reach it
    const clampRect = getPageClampRect(getPageRect(pages, "page-1"), [
      floating,
    ]);

    expect(clampRect.width).toBeGreaterThanOrEqual(2600);
    expect(clampRect.x).toBe(0);

    // the pivot is the page origin, so content keeps its position relative to
    // the page it belongs to
    const page2Origin = getPageRect(pages, "page-2").x;
    const onPage2At = newElementWith(
      API.createElement({
        type: "rectangle",
        x: page2Origin + 400,
        y: 300,
        width: 200,
        height: 100,
      }),
      { pageId: "page-2" },
    );

    const scaledPage2 = scalePageContent({
      elements: [onPage2At],
      pages,
      pageId: "page-2",
    });

    expect(scaledPage2.elements[0].x).toBe(page2Origin + 200);
    expect(scaledPage2.elements[0].y).toBe(150);

    // scaling down and back up is lossless
    const backUp = scalePageContent({
      elements: scaled.elements,
      pages: scaled.pages,
      pageId: "page-1",
      factor: 2,
    });

    expect(backUp.elements[0].x).toBe(anchored.x);
    expect(backUp.elements[0].y).toBe(anchored.y);
    expect(backUp.elements[0].width).toBe(anchored.width);
    expect(backUp.elements[0].height).toBe(anchored.height);
  });

  it("AC-4 deletes a single page", () => {
    const pages = [
      { id: "page-1", name: "Page 1" },
      { id: "page-2", name: "Page 2" },
      { id: "page-3", name: "Page 3" },
    ];

    const elements = ["page-1", "page-2", "page-3"].map((pageId) =>
      newElementWith(API.createElement({ type: "rectangle", x: 10, y: 10 }), {
        pageId,
      }),
    );

    const { pages: nextPages, currentPageId } = deletePage({
      pages,
      currentPageId: "page-2",
      pageId: "page-2",
    });

    // the page is gone, every other page is untouched
    expect(nextPages.map((page) => page.id)).toEqual(["page-1", "page-3"]);

    // and the current page still exists
    expect(nextPages.some((page) => page.id === currentPageId)).toBe(true);
    expect(currentPageId).toBe("page-1");

    // the deleted page's elements go with it, the others are untouched
    const nextElements = deletePageElements(elements, "page-2");

    expect(
      nextElements
        .filter((element) => !element.isDeleted)
        .map((el) => el.pageId),
    ).toEqual(["page-1", "page-3"]);
    expect(nextElements[0]).toBe(elements[0]);
    expect(nextElements[2]).toBe(elements[2]);

    // deleting the last page leaves one empty page
    const last = deletePage({
      pages: [{ id: "page-1", name: "Page 1" }],
      currentPageId: "page-1",
      pageId: "page-1",
    });

    expect(last.pages).toHaveLength(1);
    expect(last.currentPageId).toBe(last.pages[0].id);

    const lastElements = deletePageElements([elements[0]], "page-1");
    expect(lastElements.filter((element) => !element.isDeleted)).toHaveLength(
      0,
    );
  });

  it("AC-16 keeps the later pages' content inside their own pages", () => {
    const pages = [
      { id: "page-1", name: "Page 1" },
      { id: "page-2", name: "Page 2" },
      { id: "page-3", name: "Page 3" },
    ];

    // one element per page, each sitting inside its own page's rect
    const elements = pages.map((page) =>
      newElementWith(
        API.createElement({
          type: "rectangle",
          x: getPageRect(pages, page.id).x + 100,
          y: 200,
          width: 200,
          height: 100,
        }),
        { pageId: page.id },
      ),
    );

    // a floating element is not owned by its page, so it must not move
    const floating = newElementWith(
      API.createElement({
        type: "rectangle",
        x: getPageRect(pages, "page-3").x + 300,
        y: 200,
        width: 100,
        height: 50,
      }),
      { pageId: "page-3", floating: true },
    );

    // deleting the middle page shifts the last page one pitch to the left
    const { pages: nextPages } = deletePage({
      pages,
      currentPageId: "page-2",
      pageId: "page-2",
    });

    const nextElements = deletePageElements(
      translateContentForPageLayout({
        elements: [...elements, floating],
        previousPages: pages,
        nextPages,
      }),
      "page-2",
    );

    const onPage3 = nextElements.filter(
      (element) => element.pageId === "page-3",
    );

    // the content of the last page followed its page — it is still inside
    // that page's rect, and still where it was *relative* to it
    expectReachableByClampedCamera(
      onPage3.filter((element) => !element.floating),
      getPageRect(nextPages, "page-3"),
    );

    expect(onPage3[0].x).toBe(getPageRect(nextPages, "page-3").x + 100);

    // the floating element did not move — it is not owned by its page
    expect(onPage3[1]).toBe(floating);
    expect(floating.x).toBe(getPageRect(pages, "page-3").x + 300);

    // the first page did not move, so neither did its content
    const onPage1 = nextElements.filter(
      (element) => element.pageId === "page-1",
    );

    expect(onPage1[0].x).toBe(elements[0].x);
    expectReachableByClampedCamera(onPage1, getPageRect(nextPages, "page-1"));

    // the deleted page's content goes with it
    expect(
      nextElements.find((element) => element.pageId === "page-2")!.isDeleted,
    ).toBe(true);
  });

  it("AC-5 restores a file's own pages in isolation", async () => {
    // a file that defines its own pages keeps them
    const withPages = await loadFromBlob(
      makeFile({
        appState: {
          pages: [
            { id: "p-a", name: "A" },
            { id: "p-b", name: "B" },
          ],
        },
      }),
      runningAppState(),
      null,
    );

    expect(withPages.appState.pages.map((page) => page.id)).toEqual([
      "p-a",
      "p-b",
    ]);
    expect(withPages.appState.currentPageId).toBe("p-a");

    // elements without a page belong to the file's first page
    for (const element of withPages.elements) {
      expect(element.pageId).toBe("p-a");
    }

    // a file that defines no pages inherits neither the running app's pages
    // nor its current page
    const withoutPages = await loadFromBlob(
      makeFile({}),
      runningAppState(),
      null,
    );

    expect(withoutPages.appState.pages).toHaveLength(1);
    expect(withoutPages.appState.pages[0].id).toBe(DEFAULT_PAGE_ID);
    expect(withoutPages.appState.currentPageId).toBe(DEFAULT_PAGE_ID);
  });

  /**
   * Tiling a legacy scene across pages.
   *
   * A vanilla file has no pages: every element is stamped onto the first
   * page, so a board that sprawls over several pages of area becomes one
   * enormous page whose content is mostly outside the rect the camera is
   * clamped to — unreachable, and drawn on every frame.
   *
   * The assertions go through the library's own page layout (`getPageRect`)
   * and its own camera clamp, not through a re-derivation of the tiling
   * arithmetic, so a self-consistent-but-wrong implementation cannot pass.
   */
  it("AC-18 tiles the content across pages, one cell per page", () => {
    /** a rectangle as it comes out of a legacy file: on the first page */
    const legacyRect = (x: number, y: number) =>
      newElementWith(
        API.createElement({ type: "rectangle", x, y, width: 100, height: 50 }),
        { pageId: DEFAULT_PAGE_ID },
      );

    // a legacy scene: the content sprawls over several pages of area and
    // does not even start at the origin
    const topLeft = legacyRect(-100, -50);
    const topRight = legacyRect(1820, -50);
    const bottomLeft = legacyRect(-100, 1030);
    const far = legacyRect(4000, 3000);
    // a deleted element is not content: it is a tombstone
    const tombstone = newElementWith(legacyRect(100, 100), {
      isDeleted: true,
    });

    const elements = [topLeft, topRight, bottomLeft, far, tombstone];

    const { elements: next, pages } = paginateContentIntoPages(elements);

    // four cells hold content — the top-left one, its right neighbour, the
    // one below it and a far one. The grid the content spans is 3 x 3, so the
    // five empty cells are dropped
    expect(pages).toHaveLength(4);
    expect(pages.map((page) => page.name)).toEqual([
      "Page 1",
      "Page 2",
      "Page 3",
      "Page 4",
    ]);

    // row major: the top-left cell first, then left to right, then down
    const onPage = (index: number) =>
      getElementsForPage(next, pages[index].id)
        .filter((element) => !element.isDeleted)
        .map((element) => element.id);

    expect(onPage(0)).toEqual([topLeft.id]);
    expect(onPage(1)).toEqual([topRight.id]);
    expect(onPage(2)).toEqual([bottomLeft.id]);
    expect(onPage(3)).toEqual([far.id]);

    // every page holds only its own elements, and no element is left without
    // a page
    for (const page of pages) {
      const onIt = getElementsForPage(next, page.id);

      expect(onIt.length).toBeGreaterThan(0);
    }

    expect(
      pages.flatMap((page) =>
        getElementsForPage(next, page.id).filter(
          (element) => !element.isDeleted,
        ),
      ),
    ).toHaveLength(4);

    // the content was re-anchored: nothing sits at a negative coordinate any
    // more
    for (const element of next) {
      expect(element.x).toBeGreaterThanOrEqual(0);
      expect(element.y).toBeGreaterThanOrEqual(0);
    }

    // and every element is inside the rect of the page it is on — the
    // library's own layout, and the camera that is clamped to it
    for (const page of pages) {
      expectReachableByClampedCamera(
        getElementsForPage(next, page.id).filter(
          (element) => !element.isDeleted,
        ),
        getPageRect(pages, page.id),
      );
    }

    // a deleted element is not content: it is re-anchored with the rest, but
    // it is never tiled onto a page of its own
    const reanchoredTombstone = next.find(
      (element) => element.id === tombstone.id,
    )!;

    expect(reanchoredTombstone.x).toBe(200);
    expect(reanchoredTombstone.y).toBe(150);
    expect(reanchoredTombstone.pageId).toBe(tombstone.pageId);

    // nothing was scaled, and everything but the position is preserved
    const moved = next.find((element) => element.id === topLeft.id)!;

    expect(moved.width).toBe(topLeft.width);
    expect(moved.height).toBe(topLeft.height);
    expect(moved.seed).toBe(topLeft.seed);
    expect(moved.version).toBe(topLeft.version + 1);

    // the input was not mutated
    expect(topLeft.x).toBe(-100);
    expect(topLeft.y).toBe(-50);
  });

  it("AC-19 leaves content that already fits on one page alone, and never moves a floating element", () => {
    const legacyRect = (x: number, y: number) =>
      newElementWith(
        API.createElement({ type: "rectangle", x, y, width: 100, height: 50 }),
        { pageId: DEFAULT_PAGE_ID },
      );

    // content that already lies inside the first page's rect
    const fits = legacyRect(100, 100);

    const { elements: unchanged, pages: onePage } = paginateContentIntoPages([
      fits,
    ]);

    // the same single page, and the content is not touched at all — not even
    // re-created
    expect(onePage).toHaveLength(1);
    expect(onePage[0].id).toBe(DEFAULT_PAGE_ID);
    expect(onePage[0].name).toBe("Page 1");

    expect(unchanged).toHaveLength(1);
    expect(unchanged[0]).toBe(fits);
    expect(unchanged[0].x).toBe(100);
    expect(unchanged[0].y).toBe(100);

    // and that page holds the content
    expect(getElementsForPage(unchanged, onePage[0].id)).toHaveLength(1);

    // a floating element is never moved — not even when the content around
    // it is tiled across pages
    const floating = newElementWith(legacyRect(3000, 3000), {
      floating: true,
    });
    const spread = legacyRect(4000, 3000);
    const spreadToo = legacyRect(6000, 3000);

    const { elements: tiled, pages } = paginateContentIntoPages([
      spread,
      spreadToo,
      floating,
    ]);

    expect(pages).toHaveLength(2);

    const tiledFloating = tiled.find((element) => element.id === floating.id)!;

    expect(tiledFloating).toBe(floating);
    expect(tiledFloating.x).toBe(3000);
    expect(tiledFloating.y).toBe(3000);
    expect(tiledFloating.pageId).toBe(floating.pageId);
  });

  it("AC-20 puts every element fully inside its page and lays the pages out cumulatively", () => {
    /** a rectangle as it comes out of a legacy file: on the first page */
    const legacyRect = (x: number, y: number, width = 100, height = 50) =>
      newElementWith(
        API.createElement({ type: "rectangle", x, y, width, height }),
        { pageId: DEFAULT_PAGE_ID },
      );

    // a scene whose content straddles the cell borders: the wide element
    // starts near the right edge of its cell and reaches past it
    const topLeft = legacyRect(-100, -50);
    const straddling = legacyRect(3520, -50, 400);
    const bottomLeft = legacyRect(-100, 1030);

    // a free-draw stroke whose origin is *inside* the stroke: the stroke
    // reaches left of and above its own origin, and a page — which can only
    // grow to the right and downwards — cannot contain it there
    const stroke = newElementWith(
      API.createElement({
        type: "freedraw",
        x: 3790,
        y: 2130,
        points: [
          pointFrom<LocalPoint>(-100, -50),
          pointFrom<LocalPoint>(20, 10),
        ],
      }),
      { pageId: DEFAULT_PAGE_ID },
    );

    const { elements: next, pages } = paginateContentIntoPages([
      topLeft,
      straddling,
      bottomLeft,
      stroke,
    ]);

    // the page that holds the straddling element grew to hold it — a page is
    // as big as its own content needs
    expect(pages).toHaveLength(4);
    expect(pages[0].width).toBe(PAGE_WIDTH);
    expect(pages[1].width).toBeGreaterThan(PAGE_WIDTH);

    // every element lies FULLY inside the rect of the page it is on — the
    // library's own page layout, and its own bounding box
    for (const element of next) {
      const rect = getPageRect(pages, element.pageId);
      const [minX, minY, maxX, maxY] = getCommonBounds([element]);

      expect(minX).toBeGreaterThanOrEqual(rect.x - EPS);
      expect(minY).toBeGreaterThanOrEqual(rect.y - EPS);
      expect(maxX).toBeLessThanOrEqual(rect.x + rect.width + EPS);
      expect(maxY).toBeLessThanOrEqual(rect.y + rect.height + EPS);
    }

    // and the pages follow one another in the library's cumulative order: the
    // distance between two origins is the width of the page before them plus
    // the spacing, so a wider page pushes the pages after it — and they never
    // overlap
    for (let index = 1; index < pages.length; index++) {
      const previous = getPageRect(pages, pages[index - 1].id);
      const current = getPageRect(pages, pages[index].id);

      expect(current.x - previous.x).toBe(previous.width + PAGE_SPACING);
      expect(current.x).toBeGreaterThanOrEqual(previous.x + previous.width);
    }
  });
});

describe("free-draw sampling", () => {
  it("AC-14 keeps every coalesced sample of a free-draw stroke", async () => {
    const { container } = await render(<Excalidraw />);
    h.state.width = 1000;
    h.state.height = 1000;

    const canvas = container.querySelector("canvas.interactive")!;

    UI.clickTool("freedraw");

    fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20 });

    // the browser coalesces the positions the device reported between two
    // frames into a single `pointermove` event; jsdom has no
    // `PointerEvent`, so the event is built here and the coalesced batch is
    // attached to it by hand
    const samples = [
      { clientX: 30, clientY: 25, pressure: 0.25 },
      { clientX: 40, clientY: 30, pressure: 0.25 },
      { clientX: 50, clientY: 35, pressure: 0.25 },
      { clientX: 60, clientY: 40, pressure: 0.25 },
      { clientX: 70, clientY: 45, pressure: 0.25 },
    ];

    const moveEvent = new MouseEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      clientX: 70,
      clientY: 45,
    });
    (moveEvent as unknown as PointerEvent).getCoalescedEvents = () =>
      samples as unknown as PointerEvent[];

    fireEvent(canvas, moveEvent);

    const element = h.elements[
      h.elements.length - 1
    ] as ExcalidrawFreeDrawElement;

    expect(element.type).toBe("freedraw");

    // the stroke's initial point plus one point per coalesced sample — not
    // one point per frame
    expect(element.points.length).toBe(samples.length + 1);

    // every sample made it in, in order, in the element's local coordinates
    samples.forEach((sample, index) => {
      const sceneCoords = viewportCoordsToSceneCoords(sample, h.state);
      expect(element.points[index + 1]).toEqual([
        sceneCoords.x - element.x,
        sceneCoords.y - element.y,
      ]);
    });

    // the pressures stay index-aligned with the points
    expect(element.pressures.length).toBe(element.points.length);

    fireEvent.pointerUp(canvas, { clientX: 70, clientY: 45 });

    // the pointer-up contributes the final point of the stroke
    expect(
      (h.elements[h.elements.length - 1] as ExcalidrawFreeDrawElement).points
        .length,
    ).toBe(samples.length + 2);
  });
});
