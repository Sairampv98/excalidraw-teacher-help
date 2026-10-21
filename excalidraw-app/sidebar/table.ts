import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  getFontString,
  getLineHeight,
  randomId,
} from "@excalidraw/common";
import { measureText, newElement, newTextElement } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { appendElements } from "./insertIntoScene";

/** the gap between a cell's border and its text */
const CELL_PADDING = 8;
/** no column is narrower than this, however short its content */
const MIN_COLUMN_WIDTH = 60;
/** no column is wider than this, however long its content */
const MAX_COLUMN_WIDTH = 320;
/** no row is shorter than this */
const MIN_ROW_HEIGHT = 28;

/** a markdown separator cell: dashes, optionally aligned with colons */
const SEPARATOR_CELL = /^:?-+:?$/;

const FONT = getFontString({
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: DEFAULT_FONT_SIZE,
});

const LINE_HEIGHT = getLineHeight(DEFAULT_FONT_FAMILY);

export type TableCells = {
  /** the rows of the table, each row a list of cells */
  rows: string[][];
  /** true when the source was a markdown table (rows wrapped in pipes) */
  markdown: boolean;
};

export type TableLayout = {
  /** the width of every column, in order */
  columnWidths: number[];
  /** the height of every row, in order */
  rowHeights: number[];
  width: number;
  height: number;
};

/**
 * Splits one line into its cells.
 *
 * A markdown row is wrapped in pipes and split on them; anything else is split
 * on tabs, which is what a table copied out of a spreadsheet (or a PDF) puts
 * between its cells.
 */
const splitRow = (line: string): string[] => {
  const trimmed = line.trim();

  if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
    return trimmed
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
  }

  return trimmed.split("\t").map((cell) => cell.trim());
};

/**
 * The markdown separator row (`| --- | --- |`) is a rule, not a row of the
 * table, so it is dropped.
 */
const isSeparatorRow = (cells: readonly string[]): boolean =>
  cells.length > 0 && cells.every((cell) => SEPARATOR_CELL.test(cell));

/**
 * Recovers the cells of a table out of the lines of a selection.
 *
 * Blank lines are skipped, and so is the markdown separator row.
 */
export const readTableCells = (lines: readonly string[]): TableCells => {
  const rows: string[][] = [];
  let markdown = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (!rows.length) {
      // the first row decides the flavour: a markdown table always starts
      // with a header wrapped in pipes
      markdown = trimmed.startsWith("|") && trimmed.endsWith("|");
    }

    const cells = splitRow(trimmed);

    if (isSeparatorRow(cells)) {
      continue;
    }

    rows.push(cells);
  }

  return { rows, markdown };
};

/**
 * How many columns the table has.
 *
 * A markdown table's width is the width of its header. A plain tab-separated
 * block has no header, so its width is the most common row width — one stray
 * line does not change the shape of the table.
 */
export const tableColumnCount = (
  rows: readonly string[][],
  markdown: boolean,
): number => {
  if (!rows.length) {
    return 0;
  }

  if (markdown) {
    return rows[0].length;
  }

  const counts = new Map<number, number>();

  for (const row of rows) {
    counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
  }

  let width = rows[0].length;
  let most = 0;

  for (const [length, count] of counts) {
    if (count > most || (count === most && length > width)) {
      width = length;
      most = count;
    }
  }

  return width;
};

/**
 * Makes the table rectangular: a row with too few cells is padded with empty
 * ones, a row with too many is cut short.
 */
export const normaliseRows = (
  rows: readonly string[][],
  columns: number,
): string[][] =>
  rows.map((row) =>
    Array.from({ length: columns }, (_unused, index) => row[index] ?? ""),
  );

/**
 * Works out the size of every column and row.
 *
 * The columns are as wide as their widest cell (so the table reads like the
 * text it came from), with a floor and a ceiling so one very long cell cannot
 * make the table absurdly wide.
 */
export const layoutTable = (rows: readonly string[][]): TableLayout => {
  const columnWidths: number[] = [];
  const rowHeights: number[] = [];

  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);

  for (let column = 0; column < columns; column++) {
    let widest = 0;

    for (const row of rows) {
      const cell = row[column] ?? "";
      widest = Math.max(widest, measureText(cell, FONT, LINE_HEIGHT).width);
    }

    columnWidths.push(
      Math.min(
        MAX_COLUMN_WIDTH,
        Math.max(MIN_COLUMN_WIDTH, widest + CELL_PADDING * 2),
      ),
    );
  }

  for (const row of rows) {
    let tallest = 0;

    for (const cell of row) {
      tallest = Math.max(tallest, measureText(cell, FONT, LINE_HEIGHT).height);
    }

    rowHeights.push(Math.max(MIN_ROW_HEIGHT, tallest + CELL_PADDING * 2));
  }

  return {
    columnWidths,
    rowHeights,
    width: columnWidths.reduce((sum, width) => sum + width, 0),
    height: rowHeights.reduce((sum, height) => sum + height, 0),
  };
};

/**
 * Builds the table: one rectangle per cell, and one ordinary text element per
 * cell on top of it.
 *
 * The rectangles come first so they end up *behind* the text in the z-order.
 * The text elements are ordinary ones — not bound to the rectangles, not
 * locked — so every cell stays selectable and editable on the canvas.
 */
export const buildTableElements = (
  rows: readonly string[][],
  layout: TableLayout,
  origin: { x: number; y: number },
  groupId: string,
  strokeColor: string,
): ExcalidrawElement[] => {
  const rectangles: ExcalidrawElement[] = [];
  const texts: ExcalidrawElement[] = [];

  let y = origin.y;

  rows.forEach((row, rowIndex) => {
    const height = layout.rowHeights[rowIndex] ?? MIN_ROW_HEIGHT;
    let x = origin.x;

    row.forEach((cell, columnIndex) => {
      const width = layout.columnWidths[columnIndex] ?? MIN_COLUMN_WIDTH;

      rectangles.push(
        newElement({
          type: "rectangle",
          x,
          y,
          width,
          height,
          strokeColor,
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 0,
          opacity: 100,
          roundness: null,
          groupIds: [groupId],
        }),
      );

      texts.push(
        newTextElement({
          text: cell,
          fontFamily: DEFAULT_FONT_FAMILY,
          fontSize: DEFAULT_FONT_SIZE,
          autoResize: true,
          textAlign: "left",
          verticalAlign: "middle",
          strokeColor,
          x: x + CELL_PADDING,
          // the text is vertically centred in the cell
          y: y + height / 2,
          groupIds: [groupId],
        }),
      );

      x += width;
    });

    y += height;
  });

  return [...rectangles, ...texts];
};

/**
 * Draws a table on the canvas, with its top-left corner at `origin`.
 */
export const insertTableIntoScene = (
  api: ExcalidrawImperativeAPI,
  rows: readonly string[][],
  origin: { x: number; y: number },
) => {
  if (!rows.length) {
    return null;
  }

  const groupId = randomId();
  const layout = layoutTable(rows);
  const elements = buildTableElements(
    rows,
    layout,
    origin,
    groupId,
    api.getAppState().currentItemStrokeColor,
  );

  appendElements(api, elements, {
    selectedElementIds: elements.reduce<Record<string, true>>(
      (selected, element) => {
        if (element.type === "text") {
          selected[element.id] = true;
        }
        return selected;
      },
      {},
    ),
  });

  return { elements, layout };
};
