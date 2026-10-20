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

import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
} from "@excalidraw/element/types";

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
  getPageClampRect,
  getPageRect,
  growPage,
  scalePageContent,
  translateContentForPageLayout,
} from "../scene/pages";
import { DEFAULT_PAGE_ID, PAGE_HEIGHT, PAGE_WIDTH } from "../types";

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

  it("AC-3 scales the page and its content independently", () => {
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

    // grow page: the page rect doubles, the content is left alone
    const grown = growPage(pages[0]);

    expect(grown.width).toBe(PAGE_WIDTH * 2);
    expect(grown.height).toBe(PAGE_HEIGHT * 2);
    expect(anchored.x).toBe(400);
    expect(anchored.width).toBe(200);

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
