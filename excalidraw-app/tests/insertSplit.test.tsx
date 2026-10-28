/**
 * AC-301 - a card of code that is taller than the page raises the offer.
 *
 * A teacher inserted a whole markdown file as a code block and got one card
 * hanging far below the page, with no way to split it. The offer is the one a
 * paste that does not fit already raises: place what fits and keep the rest on
 * the clipboard, keep it all on the page, or split it over pages.
 */

import { vi } from "vitest";

import { editorJotaiStore } from "@excalidraw/excalidraw/editor-jotai";
import { pasteOverflowStateAtom } from "@excalidraw/excalidraw/components/PasteOverflowDialog/PasteOverflowState";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { insertCodeIntoScene } from "../sidebar/insertIntoScene";

type Update = { elements?: readonly any[]; appState?: any };

const createApi = () => {
  const appState: any = {
    scrollX: 0,
    scrollY: 0,
    width: 1000,
    height: 800,
    zoom: { value: 1 },
    selectedElementIds: {},
    pages: [{ id: "page-1", name: "Page 1" }],
    currentPageId: "page-1",
  };

  let elements: readonly any[] = [];

  const api = {
    id: "test-app",
    getSceneElements: () => elements,
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => appState,
    addFiles: () => {},
    updateScene: (data: Update) => {
      if (data.elements) {
        elements = data.elements;
      }
      Object.assign(appState, data.appState ?? {});
    },
  };

  return {
    api: api as unknown as ExcalidrawImperativeAPI,
    appState,
    elements: () => elements,
  };
};

const LONG = Array.from({ length: 200 }, (_, i) => `const v${i} = ${i};`).join(
  "\n",
);

const offer = () => editorJotaiStore.get(pasteOverflowStateAtom);

const waitForOffer = () => vi.waitFor(() => expect(offer().active).toBe(true));

const answer = (which: "onDiscard" | "onAllOnPage" | "onMultiPage") => {
  const state = offer();

  if (!state.active) {
    throw new Error("no offer is open");
  }

  state[which]();
  editorJotaiStore.set(pasteOverflowStateAtom, { active: false });
};

const textRows = (elements: readonly any[]) =>
  new Set(elements.filter((el) => el.type === "text").map((el) => el.y)).size;

describe("AC-301 a code card taller than the page", () => {
  afterEach(() => {
    editorJotaiStore.set(pasteOverflowStateAtom, { active: false });
    vi.unstubAllGlobals();
  });

  it("AC-301 a big insert raises the offer", async () => {
    const { api } = createApi();

    const done = insertCodeIntoScene(api, LONG, { language: "typescript" });

    await waitForOffer();

    const state = offer();

    expect(state.active && state.totalLineCount).toBe(200);
    expect(state.active && state.fittingLineCount).toBeLessThan(200);

    answer("onAllOnPage");
    await done;
  });

  it("AC-301 a card that fits raises no offer", async () => {
    const { api } = createApi();

    await insertCodeIntoScene(api, "const a = 1;", { language: "typescript" });

    expect(offer().active).toBe(false);
  });

  it("AC-301 split makes pages", async () => {
    const { api, appState, elements } = createApi();

    const done = insertCodeIntoScene(api, LONG, { language: "typescript" });

    await waitForOffer();

    const state = offer();
    const fitting = state.active ? state.fittingLineCount : 0;

    answer("onMultiPage");
    await done;

    const pages = appState.pages.map((page: { id: string }) => page.id);

    expect(pages).toHaveLength(Math.ceil(200 / fitting));

    // every page holds its rows, and no page holds more than fits
    let rows = 0;

    for (const pageId of pages) {
      const onPage = elements().filter((el) => el.pageId === pageId);

      expect(onPage.length).toBeGreaterThan(0);
      expect(textRows(onPage)).toBeLessThanOrEqual(fitting);
      rows += textRows(onPage);
    }

    expect(rows).toBe(200);
  });

  it("AC-301 keep stays on one page", async () => {
    const { api, appState, elements } = createApi();

    const done = insertCodeIntoScene(api, LONG, { language: "typescript" });

    await waitForOffer();
    answer("onAllOnPage");
    await done;

    expect(appState.pages).toHaveLength(1);
    expect(textRows(elements())).toBe(200);
  });

  it("AC-301 discard places what fits and keeps the rest on the clipboard", async () => {
    const { api, elements } = createApi();
    const writeText = vi.fn(async () => {});

    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const done = insertCodeIntoScene(api, LONG, { language: "typescript" });

    await waitForOffer();

    const state = offer();
    const fitting = state.active ? state.fittingLineCount : 0;

    answer("onDiscard");
    await done;

    expect(textRows(elements())).toBe(fitting);
    expect(writeText).toHaveBeenCalledTimes(1);

    const rest = (writeText.mock.calls[0] as unknown as [string])[0];

    expect(rest.split("\n")).toHaveLength(200 - fitting);
    expect(rest.split("\n")[0]).toContain(`v${fitting}`);
  });
});
