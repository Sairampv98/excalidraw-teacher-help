import type { OcrLine } from "../../packages/vscode-bridge/bridge/src/ocr";

/**
 * Where the text the teacher selected in a PDF page was on the page (D-301).
 *
 * The text of a page is real text, laid over the picture of the page in runs
 * that sit where the words are. A selection is some of those runs, or some of
 * the text of the first and the last; this gives each of them back with the box
 * it fills, in pixels from the top-left corner of the first page that has any of
 * the selection - so the text can go on the canvas where it was.
 */

/** a page of the viewer */
const SHEET = ".app-doc-pdf-page";

/** a run of the text laid over a page */
const RUN = ".app-doc-pdf-text span";

type Run = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

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
 * The runs as lines: the runs on one row are joined while they touch, and a
 * wide gap - a column of a table - keeps them apart, so every piece stays where
 * it was.
 */
export const mergeRuns = (runs: readonly Run[]): OcrLine[] => {
  const middle = (run: Run) => run.y + run.height / 2;

  // the rows, from the top: a run belongs to the row it is level with
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

  const lines: Run[] = [];

  for (const row of rows) {
    let last: Run | null = null;

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

        last.text += space + run.text;
        last.width = right - last.x;
        last.y = top;
        last.height = bottom - top;
        continue;
      }

      last = { ...run };
      lines.push(last);
    }
  }

  return lines.map(({ text, x, y, width, height }) => ({
    text,
    x,
    y,
    width,
    height,
  }));
};
