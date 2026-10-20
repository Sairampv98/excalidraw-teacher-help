/**
 * The app side of the page document model — AC-6..AC-9 and AC-11.
 *
 * The library side (AC-1..AC-5 and AC-10) lives in
 * `packages/excalidraw/tests/pages.test.tsx`. This file covers what only the
 * *app* can show:
 *
 *  - AC-6 the page bar: a virtualised page list, and a single-page delete
 *    behind the two-step confirmation
 *  - AC-7 unbounded pages: 10,000 pages created, switched between, and
 *    surviving a reload — with the page index and the element buckets written
 *    independently, so a failed element write cannot lose the page list
 *  - AC-8 storage: IndexedDB when it is available, the localStorage backend
 *    when it is not, and the active backend reported
 *  - AC-9 the single scaling axis: the page bar scales the page's *content*,
 *    reversibly, confined to the current page, surviving a reload — and it
 *    offers no grow-page / shrink-page control at all
 *  - AC-11 the app's own sidebar insert path: an image inserted while a later
 *    page is active lands on that page
 *
 * Assertions go through the library's own conversions (`getPageRect`,
 * `getCameraForPage`, `sceneCoordsToViewportCoords`) rather than re-deriving
 * their formulas here — a copied formula is how a wrong sign once shipped a
 * real bug.
 */

import {
  Excalidraw,
  getCameraForPage,
  getPageRect,
} from "@excalidraw/excalidraw";
import { MAX_ZOOM, sceneCoordsToViewportCoords } from "@excalidraw/common";
import { newElementWith } from "@excalidraw/element";
import { PAGE_HEIGHT, PAGE_WIDTH } from "@excalidraw/excalidraw/types";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  act,
  fireEvent,
  render,
} from "@excalidraw/excalidraw/tests/test-utils";

import type {
  ExcalidrawPage,
  NormalizedZoomValue,
  PageRect,
} from "@excalidraw/excalidraw/types";

import { Provider, appJotaiStore } from "../app-jotai";
import { STORAGE_KEYS } from "../app_constants";
import PageBar from "../components/PageBar";
import {
  LocalData,
  documentStoreErrorAtom,
  getDocumentStore,
  resetDocumentStore,
} from "../data/LocalData";
import { createDocumentStore } from "../data/documentStore";
import { getDocumentStats, resetDocumentStats } from "../data/documentStats";
import { insertImageIntoScene } from "../sidebar/insertIntoScene";

const { h } = window;

const TWO_PAGES: ExcalidrawPage[] = [
  { id: "page-1", name: "Page 1" },
  { id: "page-2", name: "Page 2" },
];

const makePages = (count: number): ExcalidrawPage[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `page-${index + 1}`,
    name: `Page ${index + 1}`,
  }));

/** an element that belongs to a page */
const elementOn = (pageId: string, x: number, y: number) =>
  newElementWith(
    API.createElement({ type: "rectangle", x, y, width: 200, height: 100 }),
    { pageId },
  );

/** tolerance for float drift, in CSS px */
const EPS = 0.001;

const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 800;

/**
 * Asserts that the content is inside the page it belongs to.
 *
 * The check goes through the library's own conversion: the camera that frames
 * the whole page has to show the content, so the user sees it when they
 * switch to that page.
 */
const expectInsideItsPage = (
  element: { x: number; y: number },
  pageRect: PageRect,
) => {
  const camera = getCameraForPage({
    viewportWidth: VIEWPORT_WIDTH,
    viewportHeight: VIEWPORT_HEIGHT,
    pageRect,
    maxZoom: MAX_ZOOM,
  });

  const viewport = sceneCoordsToViewportCoords(
    { sceneX: element.x, sceneY: element.y },
    {
      zoom: { value: camera.zoom as NormalizedZoomValue },
      offsetLeft: 0,
      offsetTop: 0,
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
    },
  );

  expect(viewport.x).toBeGreaterThanOrEqual(-EPS);
  expect(viewport.x).toBeLessThanOrEqual(VIEWPORT_WIDTH + EPS);
  expect(viewport.y).toBeGreaterThanOrEqual(-EPS);
  expect(viewport.y).toBeLessThanOrEqual(VIEWPORT_HEIGHT + EPS);
};

const renderPageBar = async (
  pages: ExcalidrawPage[],
  currentPageId: string = pages[0]?.id,
) => {
  const result = await render(
    <Provider store={appJotaiStore}>
      <Excalidraw pagesEnabled={true}>
        <PageBar />
      </Excalidraw>
    </Provider>,
  );

  act(() => {
    h.setState({ pages, currentPageId });
  });

  return result;
};

describe("page bar", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDocumentStore();
    resetDocumentStats();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetDocumentStore();
  });

  it("AC-6 virtualises the page list", async () => {
    const pages = makePages(10_000);

    const { container, getByLabelText } = await renderPageBar(pages);

    // the list is closed to begin with
    expect(
      container.querySelectorAll(".excalidraw-page-bar__page-row"),
    ).toHaveLength(0);

    fireEvent.click(getByLabelText("Show the page list"));

    const rows = container.querySelectorAll(".excalidraw-page-bar__page-row");

    // 10,000 pages must not create 10,000 DOM nodes
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    expect(rows.length).toBeLessThan(pages.length);

    // the window follows the scroll position — and stays just as small
    const list = container.querySelector(".excalidraw-page-bar__page-list")!;
    Object.defineProperty(list, "scrollTop", { value: 5000, writable: true });
    fireEvent.scroll(list);

    const scrolledRows = container.querySelectorAll(
      ".excalidraw-page-bar__page-row",
    );

    expect(scrolledRows.length).toBeLessThan(100);
    expect(
      Number(scrolledRows[0].getAttribute("data-page-index")),
    ).toBeGreaterThan(100);
  });

  it("AC-6 deletes a single page behind the two-step confirmation", async () => {
    const { getByLabelText } = await renderPageBar(TWO_PAGES, "page-2");

    const element = elementOn("page-2", 100, 100);
    act(() => {
      h.elements = [element];
    });

    const deleteButton = getByLabelText("Delete this page");

    // the first click only arms the control
    fireEvent.click(deleteButton);

    expect(h.state.pages.map((page) => page.id)).toEqual(["page-1", "page-2"]);
    expect(deleteButton.getAttribute("data-armed")).toBe("true");
    expect(h.elements[0].isDeleted).toBe(false);

    // the second click deletes the page — and only that page
    fireEvent.click(deleteButton);

    expect(h.state.pages.map((page) => page.id)).toEqual(["page-1"]);
    expect(h.state.currentPageId).toBe("page-1");

    // the deleted page's content goes with it
    expect(h.elements[0].isDeleted).toBe(true);
  });

  it("AC-6 moves the pages that follow the deleted one, with their content", async () => {
    const pages = makePages(3);

    const { getByLabelText } = await renderPageBar(pages, "page-2");

    const onPage2 = elementOn("page-2", 100, 100);
    const onPage3 = elementOn(
      "page-3",
      getPageRect(pages, "page-3").x + 100,
      200,
    );

    act(() => {
      h.elements = [onPage2, onPage3];
    });

    const deleteButton = getByLabelText("Delete this page");

    // the first click only arms the control
    fireEvent.click(deleteButton);

    expect(deleteButton.getAttribute("data-armed")).toBe("true");

    // the second click deletes the page — and only that page
    fireEvent.click(deleteButton);

    expect(h.state.pages.map((page) => page.id)).toEqual(["page-1", "page-3"]);

    // the deleted page's content goes with it
    expect(h.elements[0].isDeleted).toBe(true);

    // the page that followed moved one pitch to the left ...
    expect(getPageRect(h.state.pages, "page-3").x).toBeLessThan(
      getPageRect(pages, "page-3").x,
    );

    // ... and its content moved with it, so the page is not empty
    expect(h.elements[1].x).toBe(getPageRect(h.state.pages, "page-3").x + 100);

    expectInsideItsPage(h.elements[1], getPageRect(h.state.pages, "page-3"));
  });

  it("AC-17 inserts a page after the current one and moves the later pages with it", async () => {
    const pages = makePages(3);

    const { getByLabelText } = await renderPageBar(pages, "page-2");

    const onPage3 = elementOn(
      "page-3",
      getPageRect(pages, "page-3").x + 100,
      200,
    );

    act(() => {
      h.elements = [onPage3];
    });

    fireEvent.click(getByLabelText("Add a page"));

    // the new page went in right after the page the user was on
    expect(h.state.pages).toHaveLength(4);
    expect(h.state.pages[1].id).toBe("page-2");
    expect(h.state.pages[2].id).not.toBe("page-3");
    expect(h.state.pages[3].id).toBe("page-3");
    expect(h.state.currentPageId).toBe(h.state.pages[2].id);

    // the pages that followed moved one pitch to the right ...
    expect(getPageRect(h.state.pages, "page-3").x).toBeGreaterThan(
      getPageRect(pages, "page-3").x,
    );

    // ... and their content moved with them, so they are not empty
    expect(h.elements[0].x).toBe(getPageRect(h.state.pages, "page-3").x + 100);

    expectInsideItsPage(h.elements[0], getPageRect(h.state.pages, "page-3"));
  });

  it("AC-7 persists 10,000 pages through the document store", async () => {
    // the store's localStorage backend — writing 10,000 pages through
    // IndexedDB would mean 10,000 transactions, and this row is about the
    // document model, not about the backend (AC-8 covers the backend)
    vi.stubGlobal("indexedDB", undefined);
    resetDocumentStore();

    const pages = makePages(10_000);

    await LocalData.saveDocument([], { pages, currentPageId: pages[0].id });

    // a reload reads the whole document back
    const reloaded = await LocalData.loadDocument();

    expect(reloaded).not.toBeNull();
    expect(reloaded?.pages).toHaveLength(10_000);
    expect(reloaded?.pages[9_999].id).toBe("page-10000");
    expect(reloaded?.currentPageId).toBe("page-1");

    // the pages are switchable — the library lays them out itself
    expect(getPageRect(reloaded!.pages, "page-10000").width).toBe(PAGE_WIDTH);
    expect(getPageRect(reloaded!.pages, "page-2").x).toBeGreaterThan(0);
  });

  it("AC-7 switches between 10,000 pages without rendering them all", async () => {
    const pages = makePages(10_000);

    const { container, getByLabelText } = await renderPageBar(pages);

    fireEvent.click(getByLabelText("Show the page list"));

    const rows = container.querySelectorAll(".excalidraw-page-bar__page-row");
    expect(rows.length).toBeLessThan(100);

    // click the fifth row of the window
    fireEvent.click(rows[4]);

    expect(h.state.currentPageId).toBe("page-5");

    // the switch is measured (D-10)
    expect(getDocumentStats().pageSwitchLatencies.length).toBeGreaterThan(0);
  });

  it("AC-7 rewrites only the page buckets whose content changed", async () => {
    vi.stubGlobal("indexedDB", undefined);
    resetDocumentStore();

    const pages = makePages(2);
    const element = elementOn("page-1", 100, 100);

    await LocalData.saveDocument([element], {
      pages,
      currentPageId: pages[0].id,
    });

    const written: string[] = [];
    const setItem = localStorage.setItem.bind(localStorage);
    const setItemSpy = vi
      .spyOn(localStorage, "setItem")
      .mockImplementation((key: string, value: string) => {
        written.push(key);
        setItem(key, value);
      });

    // the same content — only the page index has to be written again
    await LocalData.saveDocument([element], {
      pages,
      currentPageId: pages[1].id,
    });

    setItemSpy.mockRestore();

    expect(written).toContain(STORAGE_KEYS.LOCAL_STORAGE_DOCUMENT_PAGES);
    expect(
      written.filter((key) =>
        key.startsWith(STORAGE_KEYS.LOCAL_STORAGE_DOCUMENT_ELEMENTS),
      ),
    ).toEqual([]);
  });

  it("AC-7 keeps the page list when an element write fails", async () => {
    vi.stubGlobal("indexedDB", undefined);
    resetDocumentStore();

    const pages = makePages(3);
    const element = elementOn("page-1", 100, 100);

    // the element write fails (a quota error, say) — the page index must not
    // go down with it
    const setItem = localStorage.setItem.bind(localStorage);
    const setItemSpy = vi
      .spyOn(localStorage, "setItem")
      .mockImplementation((key: string, value: string) => {
        if (key.startsWith(STORAGE_KEYS.LOCAL_STORAGE_DOCUMENT_ELEMENTS)) {
          throw new DOMException("quota", "QuotaExceededError");
        }
        setItem(key, value);
      });

    // the failure is surfaced, not swallowed
    await expect(
      LocalData.saveDocument([element], { pages, currentPageId: pages[0].id }),
    ).rejects.toThrow();

    setItemSpy.mockRestore();

    expect(appJotaiStore.get(documentStoreErrorAtom)).toBeTruthy();

    // the page list is still there
    const reloaded = await LocalData.loadDocument();

    expect(reloaded).not.toBeNull();
    expect(reloaded?.pages).toHaveLength(3);
    expect(reloaded?.pages.map((page) => page.id)).toEqual([
      "page-1",
      "page-2",
      "page-3",
    ]);
  });

  it("AC-8 uses IndexedDB when it is available", async () => {
    const store = await createDocumentStore();

    expect(store.backend).toBe("indexeddb");

    await store.clear();

    const pages = makePages(3);
    await store.savePages(pages, pages[1].id);
    await store.savePageElements(pages[1].id, []);

    // a fresh store reads the same database back
    const reloaded = await createDocumentStore();
    const document = await reloaded.load();

    expect(reloaded.backend).toBe("indexeddb");
    expect(document.pages).toHaveLength(3);
    expect(document.currentPageId).toBe("page-2");

    await reloaded.clear();

    // the active backend is reported
    resetDocumentStore();
    await getDocumentStore();

    const { container } = await renderPageBar(TWO_PAGES);

    expect(
      container.querySelector(".excalidraw-page-bar__storage")?.textContent,
    ).toBe("IndexedDB");
  });

  it("AC-8 falls back to localStorage when IndexedDB cannot be opened", async () => {
    // IndexedDB cannot be opened — private mode, disabled, or throwing on open
    vi.stubGlobal("indexedDB", undefined);
    resetDocumentStore();

    const store = await createDocumentStore();

    expect(store.backend).toBe("localstorage");

    // the document still persists
    const pages = makePages(2);
    await store.savePages(pages, pages[0].id);
    await store.savePageElements(pages[0].id, []);

    const reloaded = await createDocumentStore();
    const document = await reloaded.load();

    expect(document.pages).toHaveLength(2);
    expect(document.pages[0].id).toBe("page-1");

    // and the degraded backend is reported
    await getDocumentStore();

    const { container } = await renderPageBar(TWO_PAGES);

    expect(
      container.querySelector(".excalidraw-page-bar__storage")?.textContent,
    ).toBe("localStorage");
  });

  it("AC-9 scales the page content on its own", async () => {
    const { getByLabelText } = await renderPageBar(TWO_PAGES, "page-1");

    const onPage1 = elementOn("page-1", 400, 300);
    const onPage2 = elementOn("page-2", 100, 100);

    act(() => {
      h.elements = [onPage1, onPage2];
    });

    // scale the content down: that page's content geometry is halved ...
    fireEvent.click(getByLabelText("Scale this page's content down"));

    expect(h.elements[0].x).toBe(200);
    expect(h.elements[0].y).toBe(150);
    expect(h.elements[0].width).toBe(100);
    expect(h.elements[0].height).toBe(50);
    expect(h.state.pages[0].contentScale).toBe(0.5);

    // ... and the page rect is left alone — scaling the content is the only
    // way to get more room on a page
    expect(getPageRect(h.state.pages, "page-1").width).toBe(PAGE_WIDTH);
    expect(getPageRect(h.state.pages, "page-1").height).toBe(PAGE_HEIGHT);

    // the other page is untouched — its rect and its content
    expect(getPageRect(h.state.pages, "page-2").width).toBe(PAGE_WIDTH);
    expect(h.elements[1].x).toBe(100);
    expect(h.elements[1].width).toBe(200);
    expect(h.state.pages[1].contentScale).toBeUndefined();

    // the scaled content is still inside its own page — checked through the
    // library's own camera, the way the user sees it
    expectInsideItsPage(h.elements[0], getPageRect(h.state.pages, "page-1"));

    // and it is reversible
    fireEvent.click(getByLabelText("Scale this page's content up"));

    expect(h.elements[0].x).toBe(400);
    expect(h.elements[0].y).toBe(300);
    expect(h.elements[0].width).toBe(200);
    expect(h.elements[0].height).toBe(100);
    expect(h.state.pages[0].contentScale).toBe(1);
  });

  it("AC-9 has no grow or shrink page control", async () => {
    const { getByLabelText, queryByLabelText } = await renderPageBar(
      TWO_PAGES,
      "page-1",
    );

    // there is one way to get more room on a page: scale the content
    expect(queryByLabelText("Grow this page")).toBeNull();
    expect(queryByLabelText("Shrink this page")).toBeNull();

    // and the content controls are still there
    expect(getByLabelText("Scale this page's content down")).toBeTruthy();
    expect(getByLabelText("Scale this page's content up")).toBeTruthy();
  });

  it("AC-9 keeps the content scale across a reload", async () => {
    vi.stubGlobal("indexedDB", undefined);
    resetDocumentStore();

    const { getByLabelText } = await renderPageBar(TWO_PAGES, "page-1");

    act(() => {
      h.elements = [elementOn("page-1", 400, 300)];
    });

    fireEvent.click(getByLabelText("Scale this page's content down"));

    await LocalData.saveDocument(h.elements, {
      pages: h.state.pages,
      currentPageId: h.state.currentPageId,
    });

    const reloaded = await LocalData.loadDocument();

    expect(reloaded).toBeTruthy();

    const reloadedPages = reloaded!.pages;

    expect(reloadedPages[0].contentScale).toBe(0.5);

    // the page rect was never touched by the scaling
    expect(getPageRect(reloadedPages, "page-1").width).toBe(PAGE_WIDTH);
    expect(getPageRect(reloadedPages, "page-1").height).toBe(PAGE_HEIGHT);
  });

  it("AC-11 inserts an image onto the page being edited", async () => {
    // jsdom cannot decode an image, so the size probe is stubbed: the insert
    // path only needs the natural size to scale the element
    class StubImage {
      naturalWidth = 120;
      naturalHeight = 60;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("Image", StubImage);

    await renderPageBar(TWO_PAGES, "page-2");

    const file = new File(["not-really-a-png"], "shot.png", {
      type: "image/png",
    });

    await act(async () => {
      await insertImageIntoScene(h.app.api, file);
    });

    expect(h.elements.length).toBe(1);

    // the inserted image belongs to the page the user is on — it used to land
    // on the first page, which made it invisible on every later page
    expect(h.elements[0].pageId).toBe("page-2");
  });
});
