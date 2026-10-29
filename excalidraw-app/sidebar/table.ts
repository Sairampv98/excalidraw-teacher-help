import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  getFontString,
  getLineHeight,
  randomId,
} from "@excalidraw/common";
import {
  measureText,
  newElement,
  newTextElement,
  wrapText,
} from "@excalidraw/element";
import { getPageRect } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { appendElements } from "./insertIntoScene";

/** the gap between a cell's border and its text */
const CELL_PADDING = 8;
/** no column is narrower than this, however short its content */
const MIN_COLUMN_WIDTH = 60;
/** no row is shorter than this */
const MIN_ROW_HEIGHT = 28;
/** a table is at most this part of the page's width */
const PAGE_SHARE = 0.9;
/** the width a table may have when there is no page to measure */
const DEFAULT_TABLE_WIDTH = 1000;

/** a markdown separator cell: dashes, optionally aligned with colons */
const SEPARATOR_CELL = /^:?-+:?$/;

const FONT = getFontString({
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: DEFAULT_FONT_SIZE,
});

const LINE_HEIGHT = getLineHeight(DEFAULT_FONT_FAMILY);

/** waits for the table's font, so that what is measured is what is drawn */
export const loadTableFont = async () => {
  try {
    await document.fonts?.load(FONT, "Ag");
  } catch {
    // a font that cannot be loaded is measured as the browser has it
  }
};

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
  /**
   * The text of every cell as it is drawn: a text longer than its column is
   * wrapped to the column's width, so it stays inside its cell (D-299).
   */
  cells: string[][];
  width: number;
  height: number;
};

/** how a text is measured and wrapped; a test hands in its own */
export type TableText = {
  width: (text: string) => number;
  height: (text: string) => number;
  wrap: (text: string, width: number) => string;
};

const TABLE_TEXT: TableText = {
  width: (text) => measureText(text, FONT, LINE_HEIGHT).width,
  height: (text) => measureText(text, FONT, LINE_HEIGHT).height,
  wrap: (text, width) => wrapText(text, FONT, width),
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
 * Narrows the columns until they fit `maxWidth`, the widest first.
 *
 * Every column is as wide as its widest cell while the table fits. When it does
 * not, the widest columns give way to a common width - the narrow ones keep
 * theirs - and their cells wrap (D-299). A table with so many columns that even
 * the narrowest width does not fit is as wide as that.
 */
const fitColumns = (natural: readonly number[], maxWidth: number): number[] => {
  const total = natural.reduce((sum, width) => sum + width, 0);

  if (total <= maxWidth) {
    return [...natural];
  }

  let low = MIN_COLUMN_WIDTH;
  let high = Math.max(...natural);

  // the widest width at which the columns still fit
  for (let step = 0; step < 40; step++) {
    const middle = (low + high) / 2;
    const sum = natural.reduce(
      (all, width) => all + Math.min(width, middle),
      0,
    );

    if (sum > maxWidth) {
      high = middle;
    } else {
      low = middle;
    }
  }

  return natural.map((width) => Math.min(width, Math.floor(low)));
};

/**
 * Works out the size of every column and row, and the text of every cell.
 *
 * The columns are as wide as their widest cell, so the table reads like the
 * text it came from - but the table is never wider than `maxWidth`. When a
 * column has to be narrower than its text, the text of its cells is wrapped to
 * the column and the rows grow tall enough for the wrapped text, so no text runs
 * out of its cell into the next one (D-299).
 */
export const layoutTable = (
  rows: readonly string[][],
  {
    maxWidth = DEFAULT_TABLE_WIDTH,
    text = TABLE_TEXT,
  }: { maxWidth?: number; text?: TableText } = {},
): TableLayout => {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);

  const natural = Array.from({ length: columns }, (_unused, column) => {
    const widest = rows.reduce(
      (most, row) => Math.max(most, text.width(row[column] ?? "")),
      0,
    );

    return Math.max(MIN_COLUMN_WIDTH, widest + CELL_PADDING * 2);
  });

  const columnWidths = fitColumns(natural, maxWidth);

  const cells = rows.map((row) =>
    Array.from({ length: columns }, (_unused, column) => {
      const cell = row[column] ?? "";
      const room = columnWidths[column] - CELL_PADDING * 2;

      return text.width(cell) > room ? text.wrap(cell, room) : cell;
    }),
  );

  const rowHeights = cells.map((row) => {
    const tallest = row.reduce(
      (most, cell) => Math.max(most, text.height(cell)),
      0,
    );

    return Math.max(MIN_ROW_HEIGHT, tallest + CELL_PADDING * 2);
  });

  return {
    columnWidths,
    rowHeights,
    cells,
    width: columnWidths.reduce((sum, width) => sum + width, 0),
    height: rowHeights.reduce((sum, height) => sum + height, 0),
  };
};

/** how wide a table may be on the page the teacher is on (D-299) */
export const tableWidthFor = (api: ExcalidrawImperativeAPI): number => {
  const state = api.getAppState();
  const pages = state.pages ?? [];

  return pages.length
    ? getPageRect(pages, state.currentPageId ?? pages[0].id).width * PAGE_SHARE
    : DEFAULT_TABLE_WIDTH;
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

      // a cell whose text was wrapped to its column keeps the width it was
      // wrapped to, so editing it wraps it again inside the cell (D-299)
      const drawn = layout.cells[rowIndex]?.[columnIndex] ?? cell;

      texts.push(
        newTextElement({
          text: drawn,
          originalText: cell,
          fontFamily: DEFAULT_FONT_FAMILY,
          fontSize: DEFAULT_FONT_SIZE,
          autoResize: drawn === cell,
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
  const layout = layoutTable(rows, { maxWidth: tableWidthFor(api) });
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
