/**
 * AC-302 - the text selected in the viewer can go onto the page as a code card
 * or as a table.
 *
 * Selecting copies the text (AC-25); a teacher also wants it on the page in a
 * form they choose, without pasting and finding a menu entry on the canvas.
 */

import { fireEvent, render, waitFor } from "@testing-library/react";
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

  const { container, queryByText, getByText } = render(
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

  return {
    body: container.querySelector<HTMLElement>(".app-doc-markdown")!,
    updates,
    queryByText,
    getByText,
  };
};

describe("AC-302 the selection bar", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
  });

  it("AC-302 the selection bar has two buttons that insert", async () => {
    const { body, updates, getByText } = await open();

    select(body.querySelector("p")!);
    fireEvent.mouseUp(document);

    const asCard = await waitFor(() => getByText("As a code card"), {
      timeout: WAIT_MS,
    });

    expect(getByText("As a table")).toBeTruthy();

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
    const { body, updates, getByText } = await open();

    select(body.querySelector("table")!);
    fireEvent.mouseUp(document);

    fireEvent.click(
      await waitFor(() => getByText("As a table"), { timeout: WAIT_MS }),
    );

    await waitFor(() => expect(updates.length).toBeGreaterThan(0), {
      timeout: WAIT_MS,
    });

    const texts = updates[0]
      .elements!.filter((el) => el.type === "text")
      .map((el) => el.text);

    expect(texts).toEqual(expect.arrayContaining(["Ada", "36", "Alan", "41"]));
  });

  it("AC-302 no selection no bar", async () => {
    const { queryByText } = await open();

    expect(queryByText("As a code card")).toBeNull();
    expect(queryByText("As a table")).toBeNull();
  });
});
