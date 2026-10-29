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
  const { createElement, useState } = await import("react");

  // what a box drawn on the page covers: two lines, and a picture of them
  const stubRegion = {
    box: { x: 10, y: 10, width: 50, height: 20 },
    text: "first line\nsecond line",
    // the first line is bold in the PDF (D-321)
    styleRuns: [{ start: 0, end: 10, bold: true }],
    lines: [
      {
        text: "first line",
        x: 0,
        y: 0,
        width: 100,
        height: 20,
        styleRuns: [{ start: 0, end: 10, bold: true }],
      },
      { text: "second line", x: 40, y: 30, width: 110, height: 20 },
    ],
    picture: () => ({
      dataURL: "data:image/png;base64,AAAA",
      width: 400,
      height: 200,
    }),
  };

  return {
    ...original,
    PdfViewer: ({
      containerRef,
      onRegion,
      renderRegionBar,
      toolbarHost,
    }: {
      containerRef: React.RefObject<HTMLDivElement | null>;
      onRegion?: (region: typeof stubRegion) => void;
      renderRegionBar?: (
        region: typeof stubRegion,
        close: () => void,
      ) => React.ReactNode;
      toolbarHost?: HTMLElement | null;
    }) => {
      const [region, setRegion] = useState<typeof stubRegion | null>(null);

      return createElement(
        "div",
        {
          "data-testid": "stub-pdf",
          // the viewer is given its place for the toolbar: in the zoom row
          "data-host-in-zoom": String(!!toolbarHost?.closest(".app-doc-zoom")),
        },
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
        // the teacher draws a box
        createElement("button", {
          "data-testid": "stub-box",
          onClick: () => {
            setRegion(stubRegion);
            onRegion?.(stubRegion);
          },
        }),
        region ? renderRegionBar?.(region, () => setRegion(null)) : null,
      );
    },
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
    expect(
      document.querySelector('[aria-label="As a code card"]'),
    ).not.toBeNull();
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

/** a PDF open in the viewer, with the box of the stand-in ready to be drawn */
const openPdf = async () => {
  const entry: ScannedFile = {
    file: new File(["%PDF"], "lesson.pdf"),
    name: "lesson.pdf",
    path: "lesson.pdf",
    dir: [],
    kind: "pdf",
  };

  const writeText = vi.fn(async () => undefined);

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

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

  return { writeText };
};

/** draws the box, and waits for the choices under it */
const drawBox = async () => {
  await act(async () => {
    fireEvent.click(document.querySelector('[data-testid="stub-box"]')!);
  });

  await waitFor(() =>
    expect(document.querySelector(".app-doc-selection")).not.toBeNull(),
  );
};

describe("AC-355 the choices under the box", () => {
  afterEach(() => {
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
  });

  const LINES = [
    { text: "first line", x: 0, y: 0, width: 100, height: 20 },
    { text: "second line", x: 40, y: 30, width: 110, height: 20 },
  ];

  const Choices = ({
    text,
    lines,
    withPicture,
  }: {
    text: string;
    lines?: typeof LINES;
    withPicture: boolean;
  }) => {
    const api = useExcalidrawAPI();

    return (
      <SelectionBar
        api={api}
        text={text}
        lines={lines}
        picture={
          withPicture
            ? () => ({
                dataURL: "data:image/png;base64,AAAA",
                width: 400,
                height: 200,
              })
            : undefined
        }
        onDone={() => {}}
      />
    );
  };

  /** the names of the choices that are there, in order */
  const names = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>(".app-doc-selection button"),
    ).map((button) => button.getAttribute("aria-label"));

  it("AC-355 the choices are icons with names, and only the ones that can be made are there", async () => {
    // text with places, and a picture: every choice
    const { unmount } = await render(
      <Excalidraw pagesEnabled={true}>
        <Choices text="first line second line" lines={LINES} withPicture />
      </Excalidraw>,
    );

    expect(names()).toEqual([
      "As a code card",
      "As a text box",
      "As a table",
      "Where it was",
      "As an image",
      "Close",
    ]);

    // an icon and no words, with the name for a tooltip
    for (const button of document.querySelectorAll<HTMLElement>(
      ".app-doc-selection button",
    )) {
      expect(button.querySelector("svg")).not.toBeNull();
      expect(button.textContent).toBe("");
      expect(button.getAttribute("title")).toBeTruthy();
    }

    unmount();
    document.body.replaceChildren();

    // a figure has no text: the picture, and the way out
    await render(
      <Excalidraw pagesEnabled={true}>
        <Choices text="" withPicture />
      </Excalidraw>,
    );
    expect(names()).toEqual(["As an image", "Close"]);

    document.body.replaceChildren();

    // text that has no places and no picture: the three that need text only
    await render(
      <Excalidraw pagesEnabled={true}>
        <Choices text="some text" withPicture={false} />
      </Excalidraw>,
    );
    expect(names()).toEqual([
      "As a code card",
      "As a text box",
      "As a table",
      "Close",
    ]);
  });

  it("AC-355 As an image puts the part of the page on the canvas as an image", async () => {
    await render(
      <Excalidraw pagesEnabled={true}>
        <Choices text="" withPicture />
      </Excalidraw>,
    );

    await act(async () => {
      fireEvent.click(
        document.querySelector('[data-testid="selection-image"]')!,
      );
    });

    await waitFor(() =>
      expect(
        h.elements.filter(
          (element) => !element.isDeleted && element.type === "image",
        ),
      ).toHaveLength(1),
    );

    const image = h.elements.find((element) => element.type === "image") as {
      fileId: string;
      width: number;
      height: number;
    };

    // the picture is the file of the image: the page's own pixels
    expect(h.app.files[image.fileId].dataURL).toBe(
      "data:image/png;base64,AAAA",
    );

    // the size of an image of the sidebar: the long edge is at most 460, and
    // the shape of the box is kept
    expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(460);
    expect(image.width / image.height).toBeCloseTo(2, 5);
  });

  it("AC-355 a box in the pages of a PDF copies its text and shows the choices", async () => {
    const { writeText } = await openPdf();

    // the toolbar has its place in the row of the zoom (D-313)
    expect(
      document
        .querySelector('[data-testid="stub-pdf"]')!
        .getAttribute("data-host-in-zoom"),
    ).toBe("true");

    await drawBox();

    expect(writeText).toHaveBeenCalledWith("first line\nsecond line");
    expect(names()).toContain("Where it was");
    expect(names()).toContain("As an image");

    // and the box is the page's own choices: nothing is drawn above the viewer
    expect(
      document
        .querySelector('[data-testid="stub-pdf"]')!
        .contains(document.querySelector(".app-doc-selection")),
    ).toBe(true);
  });
});

describe("AC-345 a selection can be put away", () => {
  afterEach(() => {
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
  });

  it("AC-345 the close button puts the bar away, and it stays away", async () => {
    await openPdf();
    await drawBox();

    // the browser has a selection of its own, which closing lets go of
    const range = document.createRange();

    range.selectNodeContents(document.querySelector(".app-doc-pdf-text span")!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    await act(async () => {
      fireEvent.click(
        document.querySelector('[data-testid="selection-close"]')!,
      );
    });

    expect(document.querySelector(".app-doc-selection")).toBeNull();
    expect(window.getSelection()!.isCollapsed).toBe(true);

    // the end of any later gesture does not bring it back
    await act(async () => {
      fireEvent.mouseUp(document);
      fireEvent.keyUp(document.body, { key: "a" });
    });

    expect(document.querySelector(".app-doc-selection")).toBeNull();
  });

  it("AC-345 Escape puts the bar away", async () => {
    await openPdf();
    await drawBox();

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });

    expect(document.querySelector(".app-doc-selection")).toBeNull();

    // the key coming up again is not a selection either
    await act(async () => {
      fireEvent.keyUp(document.body, { key: "Escape" });
    });

    expect(document.querySelector(".app-doc-selection")).toBeNull();
  });
});

describe("AC-364 the choices carry the bold and italic parts of a PDF", () => {
  afterEach(() => {
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
  });

  const texts = () =>
    h.elements.filter(
      (element) => !element.isDeleted && element.type === "text",
    ) as unknown as Array<{ text: string; styleRuns?: unknown }>;

  it("AC-364 a text box made of a box has its bold and italic parts", async () => {
    await openPdf();
    await drawBox();

    await act(async () => {
      fireEvent.click(
        document.querySelector('[data-testid="selection-text-box"]')!,
      );
    });

    await waitFor(() => expect(texts()).toHaveLength(1));

    expect(texts()[0].styleRuns).toEqual([{ start: 0, end: 10, bold: true }]);
  });

  it("AC-364 Where it was puts each line with its own parts, and a plain line has none", async () => {
    await openPdf();
    await drawBox();

    await act(async () => {
      fireEvent.click(
        document.querySelector('[data-testid="selection-where"]')!,
      );
    });

    await waitFor(() => expect(texts()).toHaveLength(2));

    const [first, second] = texts();

    expect(first.styleRuns).toEqual([{ start: 0, end: 10, bold: true }]);
    expect("styleRuns" in second).toBe(false);
  });
});
