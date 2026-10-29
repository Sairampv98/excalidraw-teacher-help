/**
 * AC-299 - deleting a page can be undone, and the page comes back with its
 * content.
 *
 * A teacher deleted a page, pressed undo and got the page back empty: the
 * page list is part of the history, but the soft-deleted elements were
 * written to the scene without being recorded.
 */

import { Excalidraw, CaptureUpdateAction } from "@excalidraw/excalidraw";
import { newElementWith } from "@excalidraw/element";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { Keyboard } from "@excalidraw/excalidraw/tests/helpers/ui";
import {
  act,
  fireEvent,
  render,
} from "@excalidraw/excalidraw/tests/test-utils";

import type { ExcalidrawPage } from "@excalidraw/excalidraw/types";

import { Provider, appJotaiStore } from "../app-jotai";
import PageBar from "../components/PageBar";
import { resetDocumentStore } from "../data/LocalData";
import { resetDocumentStats } from "../data/documentStats";

const { h } = window;

const TWO_PAGES: ExcalidrawPage[] = [
  { id: "page-1", name: "Page 1" },
  { id: "page-2", name: "Page 2" },
];

const drawnOn = (pageId: string, type: "freedraw" | "rectangle") =>
  newElementWith(
    API.createElement({ type, x: 3000, y: 100, width: 200, height: 100 }),
    { pageId },
  );

const deleteCurrentPage = (getByLabelText: (label: string) => HTMLElement) => {
  const button = getByLabelText("Delete this page");

  // the first click arms the control, the second deletes the page
  fireEvent.click(button);
  fireEvent.click(button);
};

describe("AC-299 undo of a page delete", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDocumentStore();
    resetDocumentStats();
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

    const stroke = drawnOn("page-2", "freedraw");
    const shape = drawnOn("page-2", "rectangle");

    act(() => {
      h.app.updateScene({
        elements: [stroke, shape],
        appState: { pages: TWO_PAGES, currentPageId: "page-2" },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });

    return { ...result, stroke, shape };
  };

  const live = () => h.elements.filter((element) => !element.isDeleted);

  it("AC-299 undo of a page delete restores its elements", async () => {
    const { getByLabelText, stroke, shape } = await setup();

    deleteCurrentPage(getByLabelText);

    expect(h.state.pages.map((page) => page.id)).toEqual(["page-1"]);
    expect(live()).toHaveLength(0);

    Keyboard.undo();

    expect(h.state.pages.map((page) => page.id)).toEqual(["page-1", "page-2"]);
    expect(live().map((element) => element.id)).toEqual([stroke.id, shape.id]);
    expect(live().every((element) => element.pageId === "page-2")).toBe(true);
  });

  it("AC-299 redo deletes the page again", async () => {
    const { getByLabelText } = await setup();

    deleteCurrentPage(getByLabelText);
    Keyboard.undo();
    Keyboard.redo();

    expect(h.state.pages.map((page) => page.id)).toEqual(["page-1"]);
    expect(live()).toHaveLength(0);
  });
});
