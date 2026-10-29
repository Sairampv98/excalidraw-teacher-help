import { normalizeStyleRuns } from "@excalidraw/element";

import type { TextStyleRun } from "@excalidraw/element/types";

import type { OcrLine } from "../../packages/vscode-bridge/bridge/src/ocr";

/**
 * A line of text with the place it had. A line that came out of a PDF knows
 * which parts of it are bold or italic (D-321).
 */
export type StyledOcrLine = OcrLine & { styleRuns?: readonly TextStyleRun[] };

/** one line of a read, as it goes on the page, from the top-left of the lot */
export type PlacedOcrLine = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  styleRuns?: TextStyleRun[];
};

export type OcrLayout = {
  lines: PlacedOcrLine[];
  /** the size of the lot, so it can be put in the middle of a page */
  width: number;
  height: number;
  /** how much the picture was scaled to put it on the page */
  scale: number;
};

/** the lot is at most this part of the page wide */
const PAGE_FILL = 0.85;

/** a typical line is made at least this tall on the page, so it can be read */
const READABLE_LINE = 24;

/** no line is set smaller than this */
const MIN_FONT_SIZE = 6;

/** a line may be this much wider than the one it came from before it is shrunk */
const WIDTH_SLACK = 1.02;

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * Where the lines of a read go on the page, so that the text is **where it was**
 * (D-293).
 *
 * Every line keeps its row, its indent and its column: the lines are moved and
 * scaled as one picture, the left edge and the top of the lot are the left edge
 * and the top of the lines that were read, and the lot is made as wide as the
 * page allows - never wider than the page, and never so small that a line cannot
 * be read.
 *
 * The face the lines are set in is not the face of the document, and it can be
 * wider; a line that came out wider than the line it was read from is made
 * smaller until it is as wide, so a line never runs into its neighbour in the
 * next column.
 */
export const layoutOcrLines = ({
  lines,
  pageWidth,
  measureWidth,
}: {
  /** the lines, in the picture's own pixels */
  lines: readonly StyledOcrLine[];
  /** the width of the page they go on */
  pageWidth: number;
  /** the width of a text at a font size, in the face the lines are set in */
  measureWidth: (text: string, fontSize: number) => number;
}): OcrLayout | null => {
  const kept = lines.filter((line) => line.text?.trim());

  if (!kept.length) {
    return null;
  }

  const left = Math.min(...kept.map((line) => line.x));
  const top = Math.min(...kept.map((line) => line.y));
  const right = Math.max(...kept.map((line) => line.x + line.width));
  const bottom = Math.max(...kept.map((line) => line.y + line.height));

  const typical = median(kept.map((line) => line.height)) || 1;
  const fit = (pageWidth * PAGE_FILL) / Math.max(1, right - left);
  const scale = Math.min(fit, Math.max(1, READABLE_LINE / typical));

  const placed = kept.map((line): PlacedOcrLine => {
    const text = line.text.trim();
    const wanted = line.width * scale;

    let fontSize = Math.max(MIN_FONT_SIZE, line.height * scale);
    const natural = measureWidth(text, fontSize);

    if (wanted > 0 && natural > wanted * WIDTH_SLACK) {
      fontSize = Math.max(MIN_FONT_SIZE, (fontSize * wanted) / natural);
    }

    // the text is trimmed, so its styled parts move up by what was cut off
    const cut = line.text.length - line.text.trimStart().length;
    const styleRuns = normalizeStyleRuns(
      line.styleRuns?.map((run) => ({
        ...run,
        start: run.start - cut,
        end: run.end - cut,
      })),
      text.length,
    );

    return {
      text,
      x: (line.x - left) * scale,
      y: (line.y - top) * scale,
      fontSize,
      ...(styleRuns.length ? { styleRuns } : {}),
    };
  });

  return {
    lines: placed,
    width: (right - left) * scale,
    height: (bottom - top) * scale,
    scale,
  };
};
