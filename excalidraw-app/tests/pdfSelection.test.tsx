/**
 * AC-344 - text selected in a PDF page can go on the canvas where it was.
 *
 * The runs of the page's text that the selection covers are given back with the
 * box each fills, the runs of one row are joined while they touch, and the
 * selection bar offers "Where it was" with them.
 */

import { vi } from "vitest";

import { Excalidraw, useExcalidrawAPI } from "@excalidraw/excalidraw";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import { DocumentViewer } from "../sidebar/DocumentViewer";
import { mergeRuns, pdfSelectionRuns } from "../sidebar/pdfSelection";
import { SelectionBar } from "../sidebar/SelectionBar";

import type { ScannedFile } from "../sidebar/sidebarFiles";

// the PDF viewer is a stand-in that lays out one page with one run of text in
// the container it is given: pdf.js is not what is looked at here
vi.mock("../sidebar/PdfViewer", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../sidebar/PdfViewer")
  >();
  const { createElement } = await import("react");

  return {
    ...original,
    PdfViewer: ({
      containerRef,
    }: {
      containerRef: React.RefObject<HTMLDivElement | null>;
    }) =>
      createElement(
        "div",
        { ref: containerRef },
        createElement(
          "div",
          { className: "app-doc-pdf-page" },
          createElement(
            "div",
            { className: "app-doc-pdf-text" },
            createElement("span", null, "Hello world"),
          ),
        ),
      ),
  };
});

const { h } = window;

/** a run of text laid out as pdf.js lays it out: absolute, one line tall */
const run = (
  text: string,
  x: number,
  y: number,
  width: number,
  height = 20,
) => ({
  text,
  x,
  y,
  width,
  height,
});

describe("AC-344 the runs of a selection become lines that keep their places", () => {
  it("AC-344 the runs of one row that touch are one line, and the gap of a column keeps them apart", () => {
    const lines = mergeRuns([
      // a heading, two runs that touch (a bold word, a plain one), a column
      run("Phase", 0, 0, 50),
      run("Topic", 200, 0, 50),
      run("The", 0, 40, 30),
      run("Program", 35, 40, 70),
      run("Data", 200, 40, 40),
    ]);

    expect(lines.map(({ text, x, y }) => [text, x, y])).toEqual([
      ["Phase", 0, 0],
      ["Topic", 200, 0],
      ["The Program", 0, 40],
      ["Data", 200, 40],
    ]);

    // the joined run is as wide as both and as tall as the taller
    expect(lines[2].width).toBe(105);
  });

  it("AC-344 runs given in any order come out from the top, left to right, and a raised run stays on its row", () => {
    const lines = mergeRuns([
      run("second", 0, 60, 60),
      run("2", 62, 58, 10, 14),
      run("first", 0, 0, 50),
    ]);

    expect(lines.map((line) => line.text)).toEqual(["first", "second2"]);
    // the superscript joined its row and made it a little taller
    expect(lines[1].y).toBe(58);
    expect(lines[1].height).toBe(22);
  });

  it("AC-344 no runs, no lines", () => {
    expect(mergeRuns([])).toEqual([]);
  });
});

describe("AC-344 the selection of a page gives the part of each run that is selected", () => {
  /** two runs on a page, laid out where the test says (jsdom has no layout) */
  const page = () => {
    const root = document.createElement("div");

    root.innerHTML = `
      <div class="app-doc-pdf-page">
        <div class="app-doc-pdf-text">
          <span data-left="30" data-top="40">Hello world</span>
          <span data-left="30" data-top="70">second line</span>
        </div>
      </div>`;
    document.body.append(root);

    const sheet = root.querySelector(".app-doc-pdf-page") as HTMLElement;

    sheet.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 400, height: 600 } as DOMRect);

    return root;
  };

  beforeEach(() => {
    // a range has no box in jsdom: it is the part of its run that it covers,
    // ten wide a letter
    Range.prototype.getBoundingClientRect = function (this: Range) {
      const node = this.startContainer;
      const span = (
        node.nodeType === Node.TEXT_NODE ? node.parentElement : node
      ) as HTMLElement;
      const into = node.nodeType === Node.TEXT_NODE ? this.startOffset : 0;

      return {
        left: Number(span.dataset.left) + into * 10,
        top: Number(span.dataset.top),
        width: this.toString().length * 10,
        height: 20,
      } as DOMRect;
    };
  });

  afterEach(() => {
    document.body.replaceChildren();
    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  });

  it("AC-344 a selection that starts and ends inside runs gives just what is selected, from the page's corner", () => {
    const root = page();
    const [first, second] = [...root.querySelectorAll("span")];

    const range = document.createRange();

    range.setStart(first.firstChild!, 6);
    range.setEnd(second.firstChild!, 6);

    expect(pdfSelectionRuns(range, root)).toEqual([
      // "world": six letters in, from the corner of the page
      run("world", 30 + 60 - 10, 40 - 20, 50),
      run("second", 30 - 10, 70 - 20, 60),
    ]);
  });

  it("AC-344 a run that is not touched by the selection is left out", () => {
    const root = page();
    const [first] = [...root.querySelectorAll("span")];

    const range = document.createRange();

    range.selectNodeContents(first);

    expect(pdfSelectionRuns(range, root).map((entry) => entry.text)).toEqual([
      "Hello world",
    ]);
  });
});

describe("AC-344 the selection bar offers where the text was", () => {
  const LINES = [
    { text: "first line", x: 0, y: 0, width: 100, height: 20 },
    { text: "second line", x: 40, y: 30, width: 110, height: 20 },
  ];

  const Bar = ({
    lines,
    onDone,
  }: {
    lines?: typeof LINES;
    onDone: () => void;
  }) => {
    const api = useExcalidrawAPI();

    return (
      <SelectionBar
        api={api}
        text="first line second line"
        lines={lines}
        onDone={onDone}
      />
    );
  };

  const open = async (lines?: typeof LINES) => {
    const onDone = vi.fn();
    const utils = await render(
      <Excalidraw pagesEnabled={true}>
        <Bar lines={lines} onDone={onDone} />
      </Excalidraw>,
    );

    return { onDone, ...utils };
  };

  it("AC-344 text with no places - a markdown document - has no such button", async () => {
    await open();

    expect(
      document.querySelector('[data-testid="selection-where"]'),
    ).toBeNull();
    expect(document.body.textContent).toContain("As a code card");
  });

  it("AC-344 Where it was puts one text for each line on the page, in the same places", async () => {
    const { onDone } = await open(LINES);

    await act(async () => {
      fireEvent.click(
        document.querySelector('[data-testid="selection-where"]')!,
      );
    });

    await waitFor(() => expect(onDone).toHaveBeenCalled());

    const texts = h.elements.filter(
      (element) => !element.isDeleted && element.type === "text",
    ) as unknown as Array<{ text: string; x: number; y: number }>;

    expect(texts.map((entry) => entry.text)).toEqual([
      "first line",
      "second line",
    ]);

    // the indent of 40 and the row spacing of 30 keep their proportion
    const scale = (texts[1].y - texts[0].y) / 30;

    expect(scale).toBeGreaterThan(0);
    expect(texts[1].x - texts[0].x).toBeCloseTo(40 * scale, 4);
  });
});

describe("AC-344 a PDF's selection offers where it was", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("AC-344 selecting text in the pages of a PDF shows the bar with Where it was", async () => {
    const entry: ScannedFile = {
      file: new File(["%PDF"], "lesson.pdf"),
      name: "lesson.pdf",
      path: "lesson.pdf",
      dir: [],
      kind: "pdf",
    };

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });

    Range.prototype.getBoundingClientRect = function () {
      return { left: 30, top: 40, width: 110, height: 20 } as DOMRect;
    };

    await render(
      <Excalidraw pagesEnabled={true}>
        <DocumentViewer
          entry={entry}
          documents={[entry]}
          index={0}
          onStep={() => {}}
          onBack={() => {}}
        />
      </Excalidraw>,
    );

    const span = document.querySelector(".app-doc-pdf-text span")!;
    const range = document.createRange();

    range.selectNodeContents(span);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    await act(async () => {
      fireEvent.mouseUp(document);
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="selection-where"]'),
      ).not.toBeNull(),
    );

    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  });
});
