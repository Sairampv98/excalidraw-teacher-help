/**
 * AC-363 - a text made of a selection in a markdown (or source) document keeps
 * what was bold or italic in it.
 *
 * The bold and italic parts of what was selected are read from how the document
 * draws the text, and the text box that is made of it has them as its own.
 */

import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { ExcalidrawAPIContext } from "@excalidraw/excalidraw/components/App";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { resetBrowserState } from "../sidebar/browserState";
import { FilesTab } from "../sidebar/FilesTab";
import { selectionStyleRuns } from "../sidebar/selectionStyle";

const WAIT_MS = 10_000;

/** a document, and the text of a selection of it, as the browser says it */
const documentOf = (html: string) => {
  const body = document.createElement("div");

  body.innerHTML = html;
  document.body.append(body);

  return body;
};

/** the range that covers the contents of a node */
const rangeOf = (node: Node) => {
  const range = document.createRange();

  range.selectNodeContents(node);

  return range;
};

describe("AC-363 a selection keeps what was bold or italic in the document", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("AC-363 the bold and italic parts are read from the tags", () => {
    const body = documentOf(
      "<p>Plain <strong>bold</strong> and <em>italic</em> <strong><em>both</em></strong>.</p>",
    );
    const range = rangeOf(body.firstElementChild!);

    expect(range.toString()).toBe("Plain bold and italic both.");

    expect(selectionStyleRuns(range, range.toString())).toEqual([
      { start: 6, end: 10, bold: true },
      { start: 15, end: 21, italic: true },
      { start: 22, end: 26, bold: true, italic: true },
    ]);
  });

  it("AC-363 a heading and the head of a table are bold, and the breaks the browser puts in are not", () => {
    const body = documentOf(
      "<h2>Title</h2><p>text</p><table><tr><th>Name</th><th>Age</th></tr><tr><td>Ada</td><td><b>36</b></td></tr></table>",
    );
    const range = rangeOf(body);

    // a line break between blocks, and a tab between cells, as a browser
    // writes a selection
    const text = "Title\ntext\nName\tAge\nAda\t36";

    expect(selectionStyleRuns(range, text)).toEqual([
      { start: 0, end: 5, bold: true },
      { start: 11, end: 15, bold: true },
      { start: 16, end: 19, bold: true },
      { start: 24, end: 26, bold: true },
    ]);
  });

  it("AC-363 the spaces the browser collapses do not move the parts", () => {
    const body = documentOf("<p>one\n   two   <b>three</b>\n</p>");
    const range = rangeOf(body.firstElementChild!);

    expect(selectionStyleRuns(range, "one two three")).toEqual([
      { start: 8, end: 13, bold: true },
    ]);
  });

  it("AC-363 a space inside a bold phrase is bold, and one between two phrases is not", () => {
    const body = documentOf("<p><b>a b</b> <b>c</b></p>");
    const range = rangeOf(body.firstElementChild!);

    expect(selectionStyleRuns(range, "a b c")).toEqual([
      { start: 0, end: 3, bold: true },
      { start: 4, end: 5, bold: true },
    ]);
  });

  it("AC-363 the style the document gives a text is read too, not only the tags", () => {
    const body = documentOf(
      '<pre><span style="font-style: italic">// a comment</span>\ncode <span style="font-weight: 700">now</span></pre>',
    );
    const range = rangeOf(body.firstElementChild!);

    expect(selectionStyleRuns(range, "// a comment\ncode now")).toEqual([
      { start: 0, end: 12, italic: true },
      { start: 18, end: 21, bold: true },
    ]);
  });

  it("AC-363 a selection inside one piece of text, and a text with no style, are right", () => {
    const body = documentOf("<p><b>hello world</b></p><p>plain</p>");

    // a part of one text node
    const bold = document.createRange();
    const text = body.querySelector("b")!.firstChild!;

    bold.setStart(text, 6);
    bold.setEnd(text, 11);

    expect(selectionStyleRuns(bold, "world")).toEqual([
      { start: 0, end: 5, bold: true },
    ]);

    // no style anywhere: no runs
    expect(
      selectionStyleRuns(rangeOf(body.lastElementChild!), "plain"),
    ).toEqual([]);
  });

  /** the sidebar with a markdown document open, and the scene it writes to */
  const open = async (source: string) => {
    const updates: Array<{ elements?: readonly any[] }> = [];
    const api = {
      id: "test-app",
      getSceneElements: () => [] as never[],
      getAppState: () => ({
        scrollX: 0,
        scrollY: 0,
        width: 1000,
        height: 800,
        zoom: { value: 1 },
        selectedElementIds: {},
        currentPageId: null,
      }),
      updateScene: (update: { elements?: readonly any[] }) =>
        updates.push(update),
      setToast: vi.fn(),
    } as unknown as ExcalidrawImperativeAPI;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    resetBrowserState();

    const { container, getByLabelText } = render(
      <ExcalidrawAPIContext.Provider value={api}>
        <FilesTab />
      </ExcalidrawAPIContext.Provider>,
    );

    const file = new File([source], "notes.md");

    Object.defineProperty(file, "text", {
      configurable: true,
      value: () => Promise.resolve(source),
    });
    Object.defineProperty(
      container.querySelector('input[type="file"][accept]')!,
      "files",
      { configurable: true, value: [file] },
    );
    fireEvent.change(
      container.querySelector('input[type="file"][accept]') as HTMLElement,
    );
    fireEvent.click(container.querySelector(".app-file-list__row")!);

    await waitFor(
      () => expect(container.querySelector(".app-doc-markdown")).toBeTruthy(),
      { timeout: WAIT_MS },
    );
    // the viewer listens for the end of a selection from an effect
    await act(async () => {});

    return {
      body: container.querySelector<HTMLElement>(".app-doc-markdown")!,
      updates,
      getByLabelText,
    };
  };

  it("AC-363 a text box made of a selection has the bold and italic parts of it", async () => {
    const { body, updates, getByLabelText } = await open(
      "Some **bold** and *italic* words.",
    );

    const selection = window.getSelection()!;

    selection.removeAllRanges();
    selection.addRange(rangeOf(body.querySelector("p")!));
    fireEvent.mouseUp(document);

    fireEvent.click(
      await waitFor(() => getByLabelText("As a text box"), {
        timeout: WAIT_MS,
      }),
    );

    await waitFor(() => expect(updates.length).toBeGreaterThan(0), {
      timeout: WAIT_MS,
    });

    const [box] = updates[0].elements!.filter((el) => el.type === "text");

    expect(box.originalText).toBe("Some bold and italic words.");
    expect(box.styleRuns).toEqual([
      { start: 5, end: 9, bold: true },
      { start: 14, end: 20, italic: true },
    ]);

    selection.removeAllRanges();
  });

  it("AC-363 a heading selected becomes a bold text box, and a plain text one that is not styled", async () => {
    const { body, updates, getByLabelText } = await open(
      "# A heading\n\nA plain line.",
    );

    const selection = window.getSelection()!;

    selection.removeAllRanges();
    selection.addRange(rangeOf(body.querySelector("h1")!));
    fireEvent.mouseUp(document);

    fireEvent.click(
      await waitFor(() => getByLabelText("As a text box"), {
        timeout: WAIT_MS,
      }),
    );

    await waitFor(() => expect(updates.length).toBeGreaterThan(0), {
      timeout: WAIT_MS,
    });

    const [heading] = updates[0].elements!.filter((el) => el.type === "text");

    expect(heading.styleRuns).toEqual([{ start: 0, end: 9, bold: true }]);

    selection.removeAllRanges();
  });
});
