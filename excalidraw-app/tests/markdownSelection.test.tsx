import { fireEvent, render, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { ExcalidrawAPIContext } from "@excalidraw/excalidraw/components/App";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { DocumentsTab } from "../sidebar/DocumentsTab";

const PROSE = "Prose that the reader selects with the mouse.";
const LINK_TEXT = "link to the docs";
const SOURCE = [
  "# Notes",
  "",
  PROSE,
  "",
  `A [${LINK_TEXT}](https://example.com/docs) inside a sentence.`,
  "",
].join("\n");

/** jsdom's File has no text(), which the markdown path needs */
const makeFile = (name: string, body: string) => {
  const file = new File([body], name, { type: "" });
  Object.defineProperty(file, "text", {
    configurable: true,
    value: () => Promise.resolve(body),
  });
  return file;
};

/** the imperative API surface the sidebar touches */
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

  const setToast = vi.fn();

  return {
    api: {
      id: "test-app",
      getSceneElements: () => [] as never[],
      getAppState: () => appState,
      updateScene: () => {},
      setToast,
    } as unknown as ExcalidrawImperativeAPI,
    setToast,
  };
};

const mockClipboard = () => {
  const clipboard = {
    writeText: vi.fn().mockResolvedValue(undefined),
  };

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });

  return clipboard;
};

/** drive a hidden <input type="file"> the way the browser would */
const pickFiles = (input: HTMLInputElement, files: File[]) => {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
  fireEvent.change(input);
};

/** selects the contents of a node, the way a drag over the text does */
const select = (node: Node) => {
  const range = document.createRange();
  range.selectNodeContents(node);

  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
};

const openMarkdown = async () => {
  const clipboard = mockClipboard();
  const { api, setToast } = fakeApi();

  const { container } = render(
    <ExcalidrawAPIContext.Provider value={api}>
      <DocumentsTab />
    </ExcalidrawAPIContext.Provider>,
  );

  const input = container.querySelector<HTMLInputElement>("input[type=file]")!;

  pickFiles(input, [makeFile("notes.md", SOURCE)]);

  fireEvent.click(container.querySelector(".app-doc-list__item")!);

  await waitFor(() =>
    expect(container.querySelector(".app-doc-markdown")).toBeTruthy(),
  );

  const body = container.querySelector<HTMLElement>(".app-doc-markdown")!;

  return { container, body, clipboard, setToast };
};

describe("the markdown viewer copies what is selected", () => {
  it("AC-25 selecting prose puts it on the clipboard", async () => {
    const { body, clipboard } = await openMarkdown();

    const paragraph = body.querySelector("p")!;

    select(paragraph);

    // the mouse-up that ends the selection is what triggers the copy
    fireEvent.mouseUp(body);

    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenCalledWith(PROSE),
    );

    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it("AC-25 the text of a link is copied too", async () => {
    const { body, clipboard } = await openMarkdown();

    const link = body.querySelector("a")!;

    expect(link.textContent).toBe(LINK_TEXT);

    select(link);

    fireEvent.mouseUp(body);

    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenCalledWith(LINK_TEXT),
    );

    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it("AC-25 a selection that reaches out of the viewer is left alone", async () => {
    const { container, body, clipboard } = await openMarkdown();

    const paragraph = body.querySelector("p")!;
    // the actions sit below the document, so a selection that reaches them
    // starts inside the viewer and ends outside it
    const outside = Array.from(
      container.querySelectorAll(".app-sidebar-primary"),
    ).find((el) => el.textContent === "Insert as a code card")!;

    const range = document.createRange();
    range.setStart(paragraph.firstChild!, 0);
    range.setEnd(outside.firstChild!, 0);

    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(selection.toString().length).toBeGreaterThan(0);

    fireEvent.mouseUp(body);

    await waitFor(() => expect(clipboard.writeText).not.toHaveBeenCalled());
  });

  it("AC-25 a blocked clipboard is reported, not thrown", async () => {
    const { body, clipboard, setToast } = await openMarkdown();

    clipboard.writeText.mockRejectedValueOnce(new Error("denied"));

    select(body.querySelector("p")!);

    fireEvent.mouseUp(body);

    await waitFor(() =>
      expect(setToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Clipboard was blocked" }),
      ),
    );
  });
});
