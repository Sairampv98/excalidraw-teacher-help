import type { OcrLine } from "../../packages/vscode-bridge/bridge/src/ocr";

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** the deepest indent a line is given, in characters */
const MAX_INDENT = 80;

/**
 * Puts the lines an engine read back into the shape they had on the picture
 * (D-277): in the order they were read from top to bottom, with the indent each
 * line had and the blank line where the picture had a gap.
 *
 * The indent is the line's distance from the leftmost line, in characters; the
 * width of a character is the median of the lines' own (their width divided by
 * how many characters they have), so it holds for any size of text and any
 * font that is not far from monospace - which is what code is read in.
 */
export const ocrLinesToText = (lines: readonly OcrLine[]): string => {
  const rows = lines
    .filter((line) => line.text.trim().length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  if (!rows.length) {
    return "";
  }

  const left = Math.min(...rows.map((row) => row.x));
  const charWidth = median(
    rows.map((row) => row.width / Math.max(1, row.text.trimEnd().length)),
  );
  const lineHeight = median(rows.map((row) => row.height));

  const out: string[] = [];

  rows.forEach((row, index) => {
    const previous = rows[index - 1];

    // a gap of more than one and a half lines is a blank line
    if (previous && row.y - previous.y > lineHeight * 1.8) {
      out.push("");
    }

    const indent =
      charWidth > 0
        ? Math.min(
            MAX_INDENT,
            Math.max(0, Math.round((row.x - left) / charWidth)),
          )
        : 0;

    out.push(`${" ".repeat(indent)}${row.text.trimEnd()}`);
  });

  return out.join("\n");
};
