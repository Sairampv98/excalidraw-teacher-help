/**
 * Pages system.
 *
 * Regression guard for: `newElement()` in @excalidraw/element cannot know the
 * current page (dependency cycle), so it defaults to the first page. Every
 * creation path funnels through `App.insertNewElements()`, which stamps the real
 * page — without that stamp, anything drawn while a later page was active landed
 * on page 1 and therefore vanished from the editor.
 */

import type { ToolType } from "@excalidraw/excalidraw/types";

import { Excalidraw } from "../index";

import { render, fireEvent } from "./test-utils";

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
});
