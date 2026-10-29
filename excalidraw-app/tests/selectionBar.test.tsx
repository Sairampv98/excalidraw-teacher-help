/**
 * AC-302 - the text selected in the viewer can go onto the page as a code card
 * or as a table.
 *
 * Selecting copies the text (AC-25); a teacher also wants it on the page in a
 * form they choose, without pasting and finding a menu entry on the canvas.
 */

import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { ExcalidrawAPIContext } from "@excalidraw/excalidraw/components/App";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { resetBrowserState } from "../sidebar/browserState";
import { FilesTab } from "../sidebar/FilesTab";

const PROSE = "Prose that the reader selects with the mouse.";

const SOURCE = [
  "# Notes",
  "",
  PROSE,
  "",
  "| Name | Age |",
  "| --- | --- |",
  "| Ada | 36 |",
  "| Alan | 41 |",
  "",
].join("\n");

const WAIT_MS = 10_000;

const makeFile = (name: string, body: string) => {
  const file = new File([body], name, { type: "" });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: () => Promise.resolve(body),
  });
  return file;
};

const fakeApi = () => {
  const appState = {
    scrollX: 0,
    scrollY: 0,
    width: 1000,
    height: 800,
    zoom: { value: 1 },
    selectedElementIds: {} as Record<string, boolean>,
    currentPageId: null,
  };
  const updates: Array<{ elements?: readonly any[] }> = [];

  return {
    updates,
    api: {
      id: "test-app",
      getSceneElements: () => [] as never[],
      getAppState: () => appState,
      updateScene: (data: { elements?: readonly any[] }) => {
        updates.push(data);
      },
      addFiles: () => {},
      setToast: vi.fn(),
    } as unknown as ExcalidrawImperativeAPI,
  };
};

const select = (node: Node) => {
  const range = document.createRange();
  range.selectNodeContents(node);

  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
};

const open = async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });

  const { api, updates } = fakeApi();

  resetBrowserState();

  const { container, queryByLabelText, getByLabelText } = render(
    <ExcalidrawAPIContext.Provider value={api}>
      <FilesTab />
    </ExcalidrawAPIContext.Provider>,
  );

  const input = container.querySelector<HTMLInputElement>(
    'input[type="file"][accept]',
  )!;

  Object.defineProperty(input, "files", {
    configurable: true,
    value: [makeFile("notes.md", SOURCE)],
  });
  fireEvent.change(input);
  fireEvent.click(container.querySelector(".app-file-list__row")!);

  await waitFor(
    () => expect(container.querySelector(".app-doc-markdown")).toBeTruthy(),
    { timeout: WAIT_MS },
  );

  // the viewer listens for the end of a selection from an effect: let it run
  // before a test selects anything
  await act(async () => {});

  return {
    body: container.querySelector<HTMLElement>(".app-doc-markdown")!,
    updates,
    queryByLabelText,
    getByLabelText,
  };
};

describe("AC-302 the selection bar", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
  });

  it("AC-302 the selection bar has two buttons that insert", async () => {
    const { body, updates, getByLabelText } = await open();

    select(body.querySelector("p")!);
    fireEvent.mouseUp(document);

    const asCard = await waitFor(() => getByLabelText("As a code card"), {
      timeout: WAIT_MS,
    });

    expect(getByLabelText("As a table")).toBeTruthy();

    fireEvent.click(asCard);

    await waitFor(() => expect(updates.length).toBeGreaterThan(0), {
      timeout: WAIT_MS,
    });

    // a card is a frame with text runs on it
    const elements = updates[0].elements!;

    expect(elements.some((el) => el.type === "rectangle")).toBe(true);
    expect(
      elements
        .filter((el) => el.type === "text")
        .map((el) => el.text)
        .join(""),
    ).toContain("Prose");
  });

  it("AC-302 the table button puts the cells of the selection on the page", async () => {
    const { body, updates, getByLabelText } = await open();

    select(body.querySelector("table")!);
    fireEvent.mouseUp(document);

    fireEvent.click(
      await waitFor(() => getByLabelText("As a table"), { timeout: WAIT_MS }),
    );

    await waitFor(() => expect(updates.length).toBeGreaterThan(0), {
      timeout: WAIT_MS,
    });

    const texts = updates[0]
      .elements!.filter((el) => el.type === "text")
      .map((el) => el.text);

    expect(texts).toEqual(expect.arrayContaining(["Ada", "36", "Alan", "41"]));
  });

  it("AC-324 the selection bar offers a flexible text box too", async () => {
    const { body, updates, getByLabelText } = await open();

    select(body.querySelector("p")!);
    fireEvent.mouseUp(document);

    fireEvent.click(
      await waitFor(() => getByLabelText("As a text box"), {
        timeout: WAIT_MS,
      }),
    );

    await waitFor(() => expect(updates.length).toBeGreaterThan(0), {
      timeout: WAIT_MS,
    });

    const texts = updates[0].elements!.filter((el) => el.type === "text");

    // one text box, with a width of its own
    expect(texts).toHaveLength(1);
    expect(texts[0].autoResize).toBe(false);
  });

  it("AC-357 the choices of a selected text are icons with names, with no image", async () => {
    const { body, getByLabelText } = await open();

    select(body.querySelector("p")!);
    fireEvent.mouseUp(document);

    await waitFor(() => getByLabelText("As a code card"), {
      timeout: WAIT_MS,
    });

    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>(".app-doc-selection button"),
    );

    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "As a code card",
      "As a text box",
      "As a table",
      "Close",
    ]);

    // an icon and no words; the name is the tooltip
    for (const button of buttons) {
      expect(button.querySelector("svg")).not.toBeNull();
      expect(button.textContent).toBe("");
      expect(button.getAttribute("title")).toBeTruthy();
    }

    // a document has no picture of the selection: no image
    expect(
      document.querySelector('[data-testid="selection-image"]'),
    ).toBeNull();
  });

  it("AC-357 the choices are inside the document, at the end of the selection", async () => {
    // the end of the selection is 50 pixels from the left and 120 from the top
    Range.prototype.getBoundingClientRect = function () {
      return { left: 50, top: 100, right: 200, bottom: 120 } as DOMRect;
    };

    try {
      const { body } = await open();

      Object.defineProperty(body, "clientWidth", {
        configurable: true,
        value: 400,
      });

      select(body.querySelector("p")!);
      fireEvent.mouseUp(document);

      const float = await waitFor(
        () => {
          const found = body.querySelector<HTMLElement>(
            '[data-testid="selection-float"]',
          );

          expect(found).not.toBeNull();

          return found!;
        },
        { timeout: WAIT_MS },
      );

      // inside the body, which scrolls: the row moves with the text and nothing
      // is pushed down to make room for it
      expect(body.contains(float)).toBe(true);
      expect(float.style.left).toBe("50px");
      expect(float.style.top).toBe("126px");
      expect(
        document.querySelector(".app-doc-viewer > .app-doc-selection"),
      ).toBeNull();

      // and a long way to the right it is kept in the document
      body.scrollLeft = 0;
      select(body.querySelector("p")!);
      Range.prototype.getBoundingClientRect = function () {
        return { left: 390, top: 100, right: 395, bottom: 120 } as DOMRect;
      };
      fireEvent.mouseUp(document);

      await waitFor(
        () =>
          expect(
            body.querySelector<HTMLElement>('[data-testid="selection-float"]')!
              .style.left,
          ).toBe("260px"),
        { timeout: WAIT_MS },
      );
    } finally {
      Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
    }
  });

  it("AC-302 no selection no bar", async () => {
    const { queryByLabelText } = await open();

    expect(queryByLabelText("As a code card")).toBeNull();
    expect(queryByLabelText("As a table")).toBeNull();
  });
});
