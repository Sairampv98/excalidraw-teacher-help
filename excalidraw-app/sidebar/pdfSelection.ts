import { normalizeStyleRuns } from "@excalidraw/element";

import type { TextStyleRun } from "@excalidraw/element/types";

import type { OcrLine } from "../../packages/vscode-bridge/bridge/src/ocr";

/**
 * Where the text the teacher selected in a PDF page was on the page (D-301).
 *
 * The text of a page is real text, laid over the picture of the page in runs
 * that sit where the words are. A selection is some of those runs, or some of
 * the text of the first and the last; this gives each of them back with the box
 * it fills, in pixels from the top-left corner of the first page that has any of
 * the selection - so the text can go on the canvas where it was.
 *
 * A run knows if the font it is set in is bold or italic (D-321), and the text
 * and the lines made of the runs have those parts as runs of their own, so the
 * text can go on the page as it was written.
 */

/** a page of the viewer */
const SHEET = ".app-doc-pdf-page";

/** a run of the text laid over a page */
const RUN = ".app-doc-pdf-text span";

export type Run = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** the font of the run is bold (D-321) */
  bold?: boolean;
  /** the font of the run is italic (D-321) */
  italic?: boolean;
};

/** a line of a PDF's text: where it was, and the parts of it that are bold or italic */
export type StyledLine = OcrLine & { styleRuns?: TextStyleRun[] };

/** the style a run was marked with when its page was drawn */
const styleOf = (span: HTMLElement) => ({
  ...(span.dataset.bold === "true" ? { bold: true } : {}),
  ...(span.dataset.italic === "true" ? { italic: true } : {}),
});

/** the selected text of every run of the pages in `root`, with where it is */
export const pdfSelectionRuns = (range: Range, root: ParentNode): Run[] => {
  const runs: Run[] = [];
  let corner: { left: number; top: number } | null = null;

  for (const sheet of root.querySelectorAll<HTMLElement>(SHEET)) {
    for (const span of sheet.querySelectorAll<HTMLElement>(RUN)) {
      if (!range.intersectsNode(span)) {
        continue;
      }

      // the part of the run that is selected: a selection starts and ends in
      // the middle of a run as often as not
      const part = span.ownerDocument.createRange();

      part.selectNodeContents(span);

      if (span.contains(range.startContainer)) {
        part.setStart(range.startContainer, range.startOffset);
      }

      if (span.contains(range.endContainer)) {
        part.setEnd(range.endContainer, range.endOffset);
      }

      const text = part.toString();

      if (!text.trim()) {
        continue;
      }

      if (!corner) {
        const box = sheet.getBoundingClientRect();

        corner = { left: box.left, top: box.top };
      }

      const box = part.getBoundingClientRect();

      runs.push({
        text,
        x: box.left - corner.left,
        y: box.top - corner.top,
        width: box.width,
        height: box.height,
        ...styleOf(span),
      });
    }
  }

  return runs;
};

/** how far apart two runs of a line may be, in lines, before they are two pieces */
const JOIN_GAP = 1;

/** the gap, in lines, from which two runs of a line have a space between them */
const SPACE_GAP = 0.15;

/**
 * The runs as the rows they make, from the top: a run belongs to the row it is
 * level with.
 */
const rowsOf = (runs: readonly Run[]): Run[][] => {
  const middle = (run: Run) => run.y + run.height / 2;
  const rows: Run[][] = [];

  for (const run of [...runs].sort((a, b) => middle(a) - middle(b))) {
    const row = rows[rows.length - 1];

    if (row) {
      const level =
        row.reduce((sum, member) => sum + middle(member), 0) / row.length;
      const height = Math.max(...row.map((member) => member.height));

      if (Math.abs(middle(run) - level) < Math.min(run.height, height) * 0.5) {
        row.push(run);
        continue;
      }
    }

    rows.push([run]);
  }

  return rows;
};

/** a stretch of a text, and the style it has (D-321) */
type Piece = { text: string; bold: boolean; italic: boolean };

const pieceOf = (run: Run): Piece => ({
  text: run.text,
  bold: run.bold === true,
  italic: run.italic === true,
});

/**
 * What stands between two pieces of a row takes the style they both have, so a
 * bold phrase is one bold stretch and not words with plain spaces between them.
 */
const between = (text: string, before: Piece, after: Piece): Piece => ({
  text,
  bold: before.bold && after.bold,
  italic: before.italic && after.italic,
});

/** the pieces as one text, and the parts of it that are bold or italic */
const joinPieces = (
  pieces: readonly Piece[],
): { text: string; styleRuns: TextStyleRun[] } => {
  const runs: TextStyleRun[] = [];
  let offset = 0;

  for (const piece of pieces) {
    if (piece.text && (piece.bold || piece.italic)) {
      runs.push({
        start: offset,
        end: offset + piece.text.length,
        ...(piece.bold ? { bold: true as const } : {}),
        ...(piece.italic ? { italic: true as const } : {}),
      });
    }

    offset += piece.text.length;
  }

  return {
    text: pieces.map((piece) => piece.text).join(""),
    styleRuns: normalizeStyleRuns(runs, offset),
  };
};

/**
 * The runs as lines: the runs on one row are joined while they touch, and a
 * wide gap - a column of a table - keeps them apart, so every piece stays where
 * it was. A line that has bold or italic parts says where they are.
 */
export const mergeRuns = (runs: readonly Run[]): StyledLine[] => {
  const rows = rowsOf(runs);

  const lines: Array<Run & { pieces: Piece[] }> = [];

  for (const row of rows) {
    let last: (Run & { pieces: Piece[] }) | null = null;

    for (const run of [...row].sort((a, b) => a.x - b.x)) {
      const height = last ? Math.max(last.height, run.height) : 0;
      const gap = last ? run.x - (last.x + last.width) : 0;

      if (last && gap <= height * JOIN_GAP) {
        const space =
          gap > height * SPACE_GAP &&
          !last.text.endsWith(" ") &&
          !run.text.startsWith(" ")
            ? " "
            : "";
        const right = Math.max(last.x + last.width, run.x + run.width);
        const top = Math.min(last.y, run.y);
        const bottom = Math.max(last.y + last.height, run.y + run.height);
        const next = pieceOf(run);

        if (space) {
          last.pieces.push(
            between(space, last.pieces[last.pieces.length - 1], next),
          );
        }

        last.pieces.push(next);
        last.text += space + run.text;
        last.width = right - last.x;
        last.y = top;
        last.height = bottom - top;
        continue;
      }

      last = { ...run, pieces: [pieceOf(run)] };
      lines.push(last);
    }
  }

  return lines.map(({ text, x, y, width, height, pieces }) => {
    const { styleRuns } = joinPieces(pieces);

    return {
      text,
      x,
      y,
      width,
      height,
      ...(styleRuns.length ? { styleRuns } : {}),
    };
  });
};

/**
 * The text of the runs, a row to a line, with the parts of it that are bold or
 * italic (D-314, D-321).
 *
 * The pieces of a row that touch are one text, with a space where a space was;
 * the pieces that are far apart - the cells of a table - are split by a tab,
 * which is how a table copied out of a PDF reads, and what the table made of
 * the text splits a row on.
 */
export const runsStyledText = (
  runs: readonly Run[],
): { text: string; styleRuns: TextStyleRun[] } => {
  const pieces: Piece[] = [];

  rowsOf(runs).forEach((row, rowIndex) => {
    if (rowIndex) {
      pieces.push({ text: "\n", bold: false, italic: false });
    }

    let last: Run | null = null;

    for (const run of [...row].sort((a, b) => a.x - b.x)) {
      const next = pieceOf(run);

      if (last) {
        const height = Math.max(last.height, run.height);
        const gap = run.x - (last.x + last.width);
        const separator =
          gap > height * JOIN_GAP
            ? "\t"
            : gap > height * SPACE_GAP &&
              !last.text.endsWith(" ") &&
              !run.text.startsWith(" ")
            ? " "
            : "";

        if (separator) {
          pieces.push(
            separator === "\t"
              ? { text: separator, bold: false, italic: false }
              : between(separator, pieceOf(last), next),
          );
        }
      }

      pieces.push(next);
      last = run;
    }
  });

  return joinPieces(pieces);
};

/** the text of the runs, a row to a line */
export const runsText = (runs: readonly Run[]): string =>
  runsStyledText(runs).text;

/** a box on the screen */
export type ScreenBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** how much of a run has to be inside a box for the run to be in it */
const RUN_SHARE_INSIDE = 0.5;

/**
 * The runs of one page that a box covers (D-314): a run is taken whole when
 * half of it or more is inside the box, and left out when less is. Where the box
 * cuts a run, the part of the text that is inside it is not looked for: a word
 * cut in two is not what a teacher wants.
 *
 * The runs are where they are on the page: in pixels from its top-left corner.
 */
export const pdfRegionRuns = (sheet: HTMLElement, box: ScreenBox): Run[] => {
  const corner = sheet.getBoundingClientRect();
  const runs: Run[] = [];

  for (const span of sheet.querySelectorAll<HTMLElement>(RUN)) {
    // a container of runs is not a run
    if (span.querySelector("span")) {
      continue;
    }

    const text = span.textContent ?? "";

    if (!text.trim()) {
      continue;
    }

    const rect = span.getBoundingClientRect();
    const inside =
      Math.max(
        0,
        Math.min(rect.right, box.right) - Math.max(rect.left, box.left),
      ) *
      Math.max(
        0,
        Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top),
      );

    if (!inside || inside < rect.width * rect.height * RUN_SHARE_INSIDE) {
      continue;
    }

    runs.push({
      text,
      x: rect.left - corner.left,
      y: rect.top - corner.top,
      width: rect.width,
      height: rect.height,
      ...styleOf(span),
    });
  }

  return runs;
};
