/**
 * AC-324 - a text that goes on the page as a box is a flexible one: it has a
 * width of its own, wraps its text, and keeps the whole text so a side can be
 * dragged and the text flows into the new width. Table columns are measured
 * once the font is there.
 */

import { vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { insertTextBoxIntoScene } from "../sidebar/insertIntoScene";
import { insertTextAsTable } from "../sidebar/reformat";

const createApi = () => {
  const appState = {
    scrollX: 0,
    scrollY: 0,
    width: 1000,
    height: 800,
    zoom: { value: 1 },
    selectedElementIds: {} as Record<string, boolean>,
    pages: [{ id: "page-1", name: "Page 1" }],
    currentPageId: "page-1",
  };
  let elements: readonly any[] = [];
  const scrolled = vi.fn();

  const api = {
    getSceneElements: () => elements,
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => appState,
    scrollToContent: scrolled,
    updateScene: (data: { elements?: readonly any[] }) => {
      if (data.elements) {
        elements = data.elements;
      }
    },
  };

  return {
    api: api as unknown as ExcalidrawImperativeAPI,
    elements: () => elements,
  };
};

const LONG = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");

describe("AC-324 a text goes on the page as a flexible box", () => {
  it("AC-324 the box wraps its text and keeps the whole of it", () => {
    const { api, elements } = createApi();

    insertTextBoxIntoScene(api, LONG);

    const [box] = elements().filter((el) => el.type === "text");

    // a box with a width of its own, not one that fits its text
    expect(box.autoResize).toBe(false);
    expect(box.width).toBeLessThanOrEqual(640);

    // the text flows over several lines, and the whole text is kept, so that a
    // new width can wrap it again
    expect(box.text.split("\n").length).toBeGreaterThan(1);
    expect(box.originalText).toBe(LONG);
  });

  it("AC-324 a monospace box keeps the indents", () => {
    const { api, elements } = createApi();

    insertTextBoxIntoScene(api, "def f():\n    return 1", { monospace: true });

    const [box] = elements().filter((el) => el.type === "text");

    expect(box.text).toContain("    return 1");
    expect(box.autoResize).toBe(false);
  });

  it("AC-324 the box goes to the middle of the page and the view goes to it", () => {
    const { api, elements } = createApi();

    insertTextBoxIntoScene(api, "hello");

    const [box] = elements().filter((el) => el.type === "text");

    expect(box.x + box.width / 2).toBeLessThan(1920);
    expect(
      (api as unknown as { scrollToContent: ReturnType<typeof vi.fn> })
        .scrollToContent,
    ).toHaveBeenCalledTimes(1);
  });

  it("AC-324 a table is laid out once its font has loaded", async () => {
    const { api } = createApi();
    const fonts = document.fonts as unknown as {
      load: (...args: unknown[]) => Promise<unknown>;
    };
    const original = fonts.load;
    const load = vi.fn(async () => []);

    fonts.load = load;

    try {
      const placed = await insertTextAsTable(api, "A\tB\n1\t2");

      expect(placed).toBe(true);
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      fonts.load = original;
    }
  });
});
