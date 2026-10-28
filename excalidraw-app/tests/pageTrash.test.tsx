/**
 * AC-319 - a deleted page is kept in the browser's storage and can be brought
 * back, also after a reload.
 */

import { Excalidraw, getPageRect } from "@excalidraw/excalidraw";
import { newElementWith } from "@excalidraw/element";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawPage } from "@excalidraw/excalidraw/types";

import { Provider, appJotaiStore } from "../app-jotai";
import PageBar from "../components/PageBar";
import { resetDocumentStore } from "../data/LocalData";
import { resetDocumentStats } from "../data/documentStats";
import {
  PAGE_TRASH_LIMIT,
  forgetAllDeletedPages,
  keepDeletedPage,
  listDeletedPages,
} from "../pages/pageTrash";

const { h } = window;

const TWO_PAGES: ExcalidrawPage[] = [
  { id: "page-1", name: "Page 1" },
  { id: "page-2", name: "Lesson 2" },
];

const elementOn = (pageId: string, x: number, y: number) =>
  newElementWith(
    API.createElement({ type: "rectangle", x, y, width: 200, height: 100 }),
    { pageId },
  );

const WAIT = { timeout: 10_000 };

describe("AC-319 deleted pages are kept", () => {
  beforeEach(async () => {
    localStorage.clear();
    resetDocumentStore();
    resetDocumentStats();
    await forgetAllDeletedPages();
  });

  afterEach(() => {
    resetDocumentStore();
  });

  const setup = async () => {
    const result = await render(
      <Provider store={appJotaiStore}>
        <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true}>
          <PageBar />
        </Excalidraw>
      </Provider>,
    );

    const element = elementOn("page-2", 5000, 100);

    act(() => {
      h.setState({
        pages: TWO_PAGES,
        currentPageId: "page-2",
        width: 1200,
        height: 800,
      });
      h.elements = [element];
    });

    return { ...result, element };
  };

  it("AC-319 a deleted page is kept, and can be restored after the scene forgot it", async () => {
    const { getByLabelText, getByTestId, getAllByTestId, element } =
      await setup();

    const deleteButton = getByLabelText("Delete this page");

    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);

    // the page is kept in the store, with what was on it
    await waitFor(async () => {
      expect(await listDeletedPages()).toHaveLength(1);
    }, WAIT);

    const [kept] = await listDeletedPages();

    expect(kept.page.name).toBe("Lesson 2");
    expect(kept.elements.map((kept_) => kept_.id)).toEqual([element.id]);

    // as after a reload: the scene has no trace of the page's elements
    act(() => {
      h.elements = [];
    });

    fireEvent.click(await waitFor(() => getByTestId("deleted-pages-button")));

    expect(getAllByTestId("deleted-page")).toHaveLength(1);

    fireEvent.click(getByTestId("deleted-page-restore"));

    await waitFor(() => expect(h.state.pages).toHaveLength(2), WAIT);

    // the page is back, with its name, and what was on it is on it, in the same
    // place on the page
    const restoredPage = h.state.pages[1];

    expect(restoredPage.name).toBe("Lesson 2");
    expect(h.state.currentPageId).toBe(restoredPage.id);

    const back = h.elements.find((candidate) => candidate.id === element.id)!;
    const rect = getPageRect(h.state.pages, restoredPage.id);
    const before = getPageRect(TWO_PAGES, "page-2");

    expect(back.isDeleted).toBe(false);
    expect(back.pageId).toBe(restoredPage.id);
    expect(back.x - rect.x).toBeCloseTo(element.x - before.x, 5);

    // and it is not in the list any more
    await waitFor(async () => {
      expect(await listDeletedPages()).toHaveLength(0);
    }, WAIT);
  });

  it("AC-319 only the newest pages are kept", async () => {
    const pages = Array.from({ length: PAGE_TRASH_LIMIT + 5 }, (_, index) => ({
      id: `page-${index + 1}`,
      name: `Page ${index + 1}`,
    }));

    const api = {
      getSceneElementsIncludingDeleted: () => [],
      getFiles: () => ({}),
    } as unknown as ExcalidrawImperativeAPI;

    for (const page of pages) {
      await keepDeletedPage(api, pages, page.id);
    }

    const kept = await listDeletedPages();

    expect(kept).toHaveLength(PAGE_TRASH_LIMIT);

    // the newest are the ones that stay
    expect(kept[0].page.name).toBe(`Page ${PAGE_TRASH_LIMIT + 5}`);
    expect(kept.some((entry) => entry.page.name === "Page 1")).toBe(false);
  });

  it("AC-319 the list says how much storage is used", async () => {
    const { getByLabelText, getByTestId } = await setup();

    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: async () => ({
          usage: 50 * 1024 * 1024,
          quota: 8192 * 1024 * 1024,
        }),
      },
    });

    const deleteButton = getByLabelText("Delete this page");

    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);

    fireEvent.click(await waitFor(() => getByTestId("deleted-pages-button")));

    await waitFor(
      () =>
        expect(getByTestId("deleted-pages-storage").textContent).toContain(
          "50 MB of 8192 MB",
        ),
      WAIT,
    );
  });
});
