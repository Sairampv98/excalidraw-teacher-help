/**
 * AC-330 - read text can go on the page where it was: each line at the place it
 * had on the picture, so the page looks like the page that was read.
 */

import { vi } from "vitest";

import { Excalidraw } from "@excalidraw/excalidraw";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import { OcrPreview } from "../components/OcrPreview";
import { layoutOcrLines } from "../ocr/ocrLayout";
import { correctedLines } from "../ocr/ocrText";

import type { OcrLine } from "../../packages/vscode-bridge/bridge/src/ocr";

const { h } = window;

const line = (
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
): OcrLine => ({ text, x, y, width, height });

/** a face half as wide as it is tall */
const measure = (text: string, fontSize: number) =>
  text.length * fontSize * 0.5;

/** a page: a heading in the middle, two rows, the second indented, a column */
const PAGE = [
  line("Title", 300, 100, 400, 40),
  line("first row", 100, 200, 800, 30),
  line("second row", 140, 240, 760, 30),
  line("left   right", 100, 300, 800, 30),
];

describe("AC-330 the lines of a read, laid out where they were", () => {
  it("AC-330 every line keeps its row, its indent and its column", () => {
    const layout = layoutOcrLines({
      lines: PAGE,
      pageWidth: 2000,
      measureWidth: measure,
    })!;

    // the text is as tall as it was, and the picture is not scaled
    expect(layout.scale).toBe(1);

    expect(layout.lines.map(({ text, x, y }) => [text, x, y])).toEqual([
      ["Title", 200, 0],
      ["first row", 0, 100],
      ["second row", 40, 140],
      ["left   right", 0, 200],
    ]);

    // the lot is as big as the lines were spread over
    expect(layout.width).toBe(800);
    expect(layout.height).toBe(230);
  });

  it("AC-330 the lot is made to fit the width of the page and no wider", () => {
    const wide = [line("a wide scan", 0, 0, 3000, 100)];

    const layout = layoutOcrLines({
      lines: wide,
      pageWidth: 1000,
      measureWidth: measure,
    })!;

    expect(layout.width).toBeCloseTo(850, 5);
    expect(layout.scale).toBeCloseTo(850 / 3000, 5);

    // every line goes down by the same scale
    expect(layout.lines[0].fontSize).toBeCloseTo(100 * layout.scale, 5);
  });

  it("AC-330 small text is made large enough to read", () => {
    const small = [
      line("tiny", 0, 0, 100, 10),
      line("lines", 0, 20, 100, 10),
      line("here", 0, 40, 100, 10),
    ];

    const layout = layoutOcrLines({
      lines: small,
      pageWidth: 5000,
      measureWidth: measure,
    })!;

    // a typical line is made 24 tall
    expect(layout.scale).toBeCloseTo(2.4, 5);
    expect(layout.lines[0].fontSize).toBeCloseTo(24, 5);
  });

  it("AC-330 a line that came out wider than the one it was read from is made smaller", () => {
    // ten letters were 40 wide and 24 tall on the picture, and the face makes
    // them 120 wide at that height
    const layout = layoutOcrLines({
      lines: [line("mmmmmmmmmm", 0, 0, 40, 24)],
      pageWidth: 5000,
      measureWidth: measure,
    })!;

    // so 8 makes them 40 wide
    expect(layout.scale).toBe(1);
    expect(layout.lines[0].fontSize).toBeCloseTo(8, 5);
    expect(measure("mmmmmmmmmm", layout.lines[0].fontSize)).toBeCloseTo(
      40 * layout.scale,
      5,
    );
  });

  it("AC-330 lines with no text are left out, and a page with none is nothing", () => {
    expect(
      layoutOcrLines({
        lines: [line("   ", 0, 0, 10, 10)],
        pageWidth: 1000,
        measureWidth: measure,
      }),
    ).toBeNull();

    const layout = layoutOcrLines({
      lines: [line("kept", 0, 0, 100, 20), line("", 0, 30, 100, 20)],
      pageWidth: 1000,
      measureWidth: measure,
    })!;

    expect(layout.lines.map((entry) => entry.text)).toEqual(["kept"]);
  });
});

describe("AC-330 the corrections typed in the preview are kept", () => {
  it("AC-330 typed text replaces the lines in order, whatever the blank rows between them", () => {
    const corrected = correctedLines(
      PAGE,
      ["Heading", "", "first row", "second  row", "left   right"].join("\n"),
    );

    expect(corrected.map((entry) => entry.text)).toEqual([
      "Heading",
      "first row",
      "second  row",
      "left   right",
    ]);

    // each line keeps its own box
    expect(corrected[0]).toMatchObject({ x: 300, y: 100, width: 400 });
  });

  it("AC-330 when a row was added or removed the lines are as they were read", () => {
    const corrected = correctedLines(PAGE, "just one row");

    expect(corrected.map((entry) => entry.text)).toEqual([
      "Title",
      "first row",
      "second row",
      "left   right",
    ]);
  });
});

describe("AC-330 the preview pastes the lines where they were", () => {
  const liveTexts = () =>
    h.elements.filter(
      (element) => !element.isDeleted && element.type === "text",
    ) as unknown as Array<{
      text: string;
      x: number;
      y: number;
      groupIds: string[];
    }>;

  const open = async (lines: readonly OcrLine[]) => {
    const onClose = vi.fn();

    const utils = await render(
      <Excalidraw pagesEnabled={true}>
        <OcrPreview data={{ lines }} onClose={onClose} />
      </Excalidraw>,
    );

    return { onClose, ...utils };
  };

  it("AC-330 paste where it was puts one text for each line, in a group, in the same places", async () => {
    const lines = [
      line("def hello(name):", 0, 0, 160, 20),
      line("print(name)", 40, 25, 110, 20),
      line("return 1", 40, 50, 80, 20),
    ];

    const { onClose, getByText } = await open(lines);

    await act(async () => {
      fireEvent.click(getByText("Paste where it was"));
    });

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    const texts = liveTexts();

    // one text for each line - not one block
    expect(texts.map((entry) => entry.text)).toEqual([
      "def hello(name):",
      "print(name)",
      "return 1",
    ]);

    // one group, so the lot moves as one
    expect(new Set(texts.map((entry) => entry.groupIds[0])).size).toBe(1);
    expect(texts[0].groupIds).toHaveLength(1);

    // the places are the places of the lines, scaled together: the indent of 40
    // and the row spacing of 25 are in the same proportion as on the picture
    const scale = (texts[2].y - texts[1].y) / 25;

    expect(scale).toBeGreaterThan(0);
    expect(texts[1].x - texts[0].x).toBeCloseTo(40 * scale, 4);
    expect(texts[1].y - texts[0].y).toBeCloseTo(25 * scale, 4);
    expect(texts[2].x).toBeCloseTo(texts[1].x, 4);
  });

  it("AC-330 paste where it was uses the text as it was corrected", async () => {
    const lines = [
      line("helo world", 0, 0, 100, 20),
      line("second line", 30, 30, 110, 20),
    ];

    const { onClose, getByText } = await open(lines);

    fireEvent.change(
      document.querySelector('[data-testid="ocr-preview-text"]')!,
      {
        target: { value: "hello world\n   second line" },
      },
    );

    await act(async () => {
      fireEvent.click(getByText("Paste where it was"));
    });

    await waitFor(() => expect(onClose).toHaveBeenCalled());

    // the typed text, with the indent that the position already says
    expect(liveTexts().map((entry) => entry.text)).toEqual([
      "hello world",
      "second line",
    ]);
  });
});
