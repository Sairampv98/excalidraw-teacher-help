/**
 * AC-338 - a table's cell keeps its text inside it: a text longer than its
 * column is wrapped to the column, the row grows to hold it, and the table is
 * never wider than the page allows.
 */

import { vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { insertTextAsTable } from "../sidebar/reformat";
import { layoutTable, tableWidthFor } from "../sidebar/table";

import type { TableText } from "../sidebar/table";

/** a face in which every letter is 10 wide, and a line is 20 tall */
const FACE: TableText = {
  width: (value) =>
    Math.max(0, ...value.split("\n").map((line) => line.length * 10)),
  height: (value) => value.split("\n").length * 20,
  wrap: (value, width) => {
    const room = Math.max(1, Math.floor(width / 10));
    const lines: string[] = [];
    let line = "";

    for (const word of value.split(" ")) {
      const next = line ? `${line} ${word}` : word;

      if (next.length > room && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }

    if (line) {
      lines.push(line);
    }

    return lines.join("\n");
  },
};

const LONG = "Find main declare int x = 5 and call printf then more words here";

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
    currentItemStrokeColor: "#000000",
  };
  let elements: readonly any[] = [];

  const api = {
    getSceneElements: () => elements,
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => appState,
    scrollToContent: vi.fn(),
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

describe("AC-338 a table cell keeps its text inside it", () => {
  it("AC-338 a table that fits keeps every column as wide as its widest cell", () => {
    const layout = layoutTable(
      [
        ["a", "b"],
        ["hello world", "x"],
      ],
      { maxWidth: 1000, text: FACE },
    );

    // 11 letters and the padding; a narrow column keeps the floor
    expect(layout.columnWidths).toEqual([126, 60]);
    expect(layout.cells.flat().some((cell) => cell.includes("\n"))).toBe(false);
  });

  it("AC-338 a text longer than its column is wrapped to it and the row grows", () => {
    const layout = layoutTable(
      [
        ["Phase", "Topic", "What we do"],
        ["1", "The Program", LONG],
      ],
      { maxWidth: 500, text: FACE },
    );

    const [first, second, third] = layout.columnWidths;

    // the table fits, and the narrow columns kept their own width
    expect(layout.width).toBeLessThanOrEqual(500);
    expect(first).toBe(66);
    expect(second).toBe(126);
    expect(third).toBeGreaterThan(280);

    // the long text is wrapped inside its column, line by line
    const wrapped = layout.cells[1][2];

    expect(wrapped.split("\n").length).toBeGreaterThan(1);
    expect(FACE.width(wrapped)).toBeLessThanOrEqual(third - 16);

    // the whole text is still there
    expect(wrapped.replace(/\n/g, " ")).toBe(LONG);

    // the row is as tall as the wrapped text, and the others stay short
    expect(layout.rowHeights[1]).toBe(wrapped.split("\n").length * 20 + 16);
    expect(layout.rowHeights[0]).toBe(36);
    expect(layout.cells[1][0]).toBe("1");
  });

  it("AC-338 the widest columns give way first, down to a common width", () => {
    const layout = layoutTable(
      [[LONG, LONG, "short"]],
      // the two long columns are 656 wide each; with the short one that
      // leaves a common width of about 167 for them
      { maxWidth: 400, text: FACE },
    );

    const [a, b, c] = layout.columnWidths;

    expect(a).toBe(b);
    expect(c).toBe(66);
    expect(layout.width).toBeLessThanOrEqual(400);
  });

  it("AC-338 no cell text runs out of its cell when a table is put on the page", async () => {
    const { api, elements } = createApi();
    const cell = (n: number) =>
      Array.from({ length: 12 }, (_, i) => `word${n}${i}`).join(" ");

    const markdown = [
      "| Phase | Topic | What we do |",
      "| --- | --- | --- |",
      `| 1 | ${cell(1)} | ${cell(2)} |`,
      `| 2 | ${cell(3)} | ${cell(4)} |`,
    ].join("\n");

    expect(await insertTextAsTable(api, markdown)).toBe(true);

    const rectangles = elements().filter((el) => el.type === "rectangle");
    const texts = elements().filter((el) => el.type === "text");

    // the table is not wider than the page lets it be
    const left = Math.min(...rectangles.map((r) => r.x));
    const right = Math.max(...rectangles.map((r) => r.x + r.width));

    expect(right - left).toBeLessThanOrEqual(tableWidthFor(api) + 1);

    // every text lies inside the cell it was put in, and nothing is lost
    for (const text of texts) {
      const inside = rectangles.find(
        (r) =>
          text.x >= r.x &&
          text.x < r.x + r.width &&
          text.y >= r.y &&
          text.y < r.y + r.height + 1,
      );

      expect(inside).toBeTruthy();
      expect(text.x + text.width).toBeLessThanOrEqual(
        inside.x + inside.width + 0.5,
      );
      expect(text.y + text.height).toBeLessThanOrEqual(
        inside.y + inside.height + 0.5,
      );
      expect(text.text.replace(/\n/g, " ")).toBe(text.originalText);
    }

    // a wrapped cell keeps its width, so editing it wraps it again
    expect(
      texts.some((text) => text.text.includes("\n") && !text.autoResize),
    ).toBe(true);
  });
});
