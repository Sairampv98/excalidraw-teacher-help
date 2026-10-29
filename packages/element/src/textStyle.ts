import type {
  ExcalidrawTextElement,
  TextStyleKey,
  TextStyleRun,
} from "./types";

/**
 * Bold and italic for a part of a text (D-320).
 *
 * The style is kept as **runs** over the text's `originalText`: characters
 * `start` up to `end` are bold, italic or both. A text with no run is plain, and
 * has no such field at all.
 *
 * Bold and italic are drawn by thickening and by leaning the letters of the
 * font the text already has, and not by switching to another face of it. That
 * keeps every letter exactly as wide as it was, so what measures, wraps and
 * sizes a text - and the editor, which is a plain textarea under a styled copy
 * of itself - needs to know nothing about the style.
 */

/** the stroke that thickens a bold letter, as a share of the font size */
export const FAUX_BOLD_STROKE = 0.05;

/** how far the top of an italic letter leans, as a share of its height */
export const FAUX_ITALIC_SKEW = 0.25;

const BOLD = 1;
const ITALIC = 2;

const bitOf = (key: TextStyleKey) => (key === "bold" ? BOLD : ITALIC);

const clampIndex = (value: unknown, length: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(length, Math.floor(value)))
    : 0;

/** what each character of a text of `length` characters has, from its runs */
const codesOf = (
  runs: readonly TextStyleRun[] | undefined,
  length: number,
): Uint8Array => {
  const codes = new Uint8Array(length);

  for (const run of runs ?? []) {
    const code = (run?.bold ? BOLD : 0) | (run?.italic ? ITALIC : 0);
    const end = clampIndex(run?.end, length);

    for (let index = clampIndex(run?.start, length); index < end; index++) {
      codes[index] |= code;
    }
  }

  return codes;
};

/** the runs of what each character has: neighbours that are alike are one run */
const runsOf = (codes: Uint8Array): TextStyleRun[] => {
  const runs: TextStyleRun[] = [];
  let index = 0;

  while (index < codes.length) {
    const code = codes[index];
    let end = index + 1;

    while (end < codes.length && codes[end] === code) {
      end++;
    }

    if (code) {
      runs.push({
        start: index,
        end,
        ...(code & BOLD ? { bold: true as const } : {}),
        ...(code & ITALIC ? { italic: true as const } : {}),
      });
    }

    index = end;
  }

  return runs;
};

/**
 * The runs of a text, cleaned: inside the text, in order, with no empty one, no
 * plain one, and neighbours that are alike made one. What comes from a file is
 * passed through this.
 */
export const normalizeStyleRuns = (
  runs: readonly TextStyleRun[] | undefined,
  length: number,
): TextStyleRun[] => (runs?.length ? runsOf(codesOf(runs, length)) : []);

/** does every character from `start` to `end` have the style? (none: no) */
export const rangeHasStyle = (
  runs: readonly TextStyleRun[] | undefined,
  length: number,
  start: number,
  end: number,
  key: TextStyleKey,
): boolean => {
  const from = clampIndex(start, length);
  const to = clampIndex(end, length);

  if (from >= to) {
    return false;
  }

  const codes = codesOf(runs, length);
  const bit = bitOf(key);

  for (let index = from; index < to; index++) {
    if (!(codes[index] & bit)) {
      return false;
    }
  }

  return true;
};

/** the runs with the style turned on or off for the characters `start` to `end` */
export const setStyleOnRange = (
  runs: readonly TextStyleRun[] | undefined,
  length: number,
  start: number,
  end: number,
  key: TextStyleKey,
  on: boolean,
): TextStyleRun[] => {
  const codes = codesOf(runs, length);
  const bit = bitOf(key);
  const to = clampIndex(end, length);

  for (let index = clampIndex(start, length); index < to; index++) {
    codes[index] = on ? codes[index] | bit : codes[index] & ~bit;
  }

  return runsOf(codes);
};

/**
 * The runs of a text after it was edited from `oldText` to `newText` (D-320).
 *
 * What was typed or pasted has the style of the character before it, as in any
 * editor - so typing at the end of a bold word goes on in bold - and what was
 * deleted takes its style with it.
 */
export const adjustStyleRunsForEdit = (
  runs: readonly TextStyleRun[] | undefined,
  oldText: string,
  newText: string,
): TextStyleRun[] => {
  if (!runs?.length || oldText === newText) {
    return runs ? [...runs] : [];
  }

  const before = codesOf(runs, oldText.length);

  // what the edit left alone at the start and at the end of the text
  let prefix = 0;
  const shortest = Math.min(oldText.length, newText.length);

  while (prefix < shortest && oldText[prefix] === newText[prefix]) {
    prefix++;
  }

  let suffix = 0;

  while (
    suffix < shortest - prefix &&
    oldText[oldText.length - 1 - suffix] ===
      newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }

  const inserted = newText.length - prefix - suffix;
  const after = new Uint8Array(newText.length);

  after.set(before.subarray(0, prefix), 0);

  // what was typed takes the style of the character before it
  after.fill(prefix > 0 ? before[prefix - 1] : 0, prefix, prefix + inserted);

  after.set(before.subarray(oldText.length - suffix), newText.length - suffix);

  return runsOf(after);
};

/** a stretch of one line of a text, with the style it has */
export type StyledSegment = {
  text: string;
  bold: boolean;
  italic: boolean;
};

/**
 * The lines of a text as stretches of one style each - or `null` when nothing
 * in the text is styled, which is almost always, so that a plain text takes the
 * way it always took.
 *
 * The lines are the wrapped `text`, and the runs are over `originalText`, which
 * wrapping only takes spaces and line breaks out of: each character of a line is
 * found, in order, in the original, and has the style it has there.
 */
export const getStyledLines = (
  element: Pick<ExcalidrawTextElement, "text" | "originalText" | "styleRuns">,
): StyledSegment[][] | null => {
  const { text, originalText, styleRuns } = element;

  if (!styleRuns?.length) {
    return null;
  }

  const codes = codesOf(styleRuns, originalText.length);

  if (!codes.some((code) => code)) {
    return null;
  }

  let cursor = 0;

  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const stretches: Array<{ text: string; code: number }> = [];

      for (let index = 0; index < line.length; index++) {
        const char = line[index];
        let found = cursor;

        while (found < originalText.length && originalText[found] !== char) {
          found++;
        }

        let code = 0;

        if (found < originalText.length) {
          code = codes[found];
          cursor = found + 1;
        }

        const last = stretches[stretches.length - 1];

        if (last && last.code === code) {
          last.text += char;
        } else {
          stretches.push({ text: char, code });
        }
      }

      return stretches.map(({ text: stretch, code }) => ({
        text: stretch,
        bold: !!(code & BOLD),
        italic: !!(code & ITALIC),
      }));
    });
};

/**
 * A text as stretches of one style each, as it is typed - not wrapped (D-320).
 * The editor shows its text from these, under the textarea that holds it.
 */
export const getStyledStretches = (
  text: string,
  runs: readonly TextStyleRun[] | undefined,
): StyledSegment[] => {
  const codes = codesOf(runs, text.length);
  const stretches: StyledSegment[] = [];
  let index = 0;

  while (index < text.length) {
    const code = codes[index];
    let end = index + 1;

    while (end < text.length && codes[end] === code) {
      end++;
    }

    stretches.push({
      text: text.slice(index, end),
      bold: !!(code & BOLD),
      italic: !!(code & ITALIC),
    });
    index = end;
  }

  return stretches;
};

/**
 * Draws one line of a text that has styled parts (D-320): each stretch where it
 * would have been in the plain line, thickened for bold and leaned for italic.
 *
 * `x` is where the line is aligned to, as for a plain line, and the context has
 * the font and the colour of the text already.
 */
export const drawStyledLine = (
  context: CanvasRenderingContext2D,
  segments: readonly StyledSegment[],
  y: number,
  x: number,
  textAlign: CanvasTextAlign,
  fontSize: number,
) => {
  const line = segments.map((segment) => segment.text).join("");
  const width = context.measureText(line).width;
  const start =
    textAlign === "center"
      ? x - width / 2
      : textAlign === "right"
      ? x - width
      : x;

  context.textAlign = "left";

  let offset = 0;

  for (const segment of segments) {
    // where the stretch is in the whole line, as it is measured whole
    const at =
      start + (offset ? context.measureText(line.slice(0, offset)).width : 0);

    offset += segment.text.length;

    context.save();

    if (segment.italic) {
      context.translate(at, y);
      context.transform(1, 0, -FAUX_ITALIC_SKEW, 1, 0, 0);
    }

    const drawAt = segment.italic ? { x: 0, y: 0 } : { x: at, y };

    context.fillText(segment.text, drawAt.x, drawAt.y);

    if (segment.bold) {
      context.lineWidth = fontSize * FAUX_BOLD_STROKE;
      context.lineJoin = "round";
      context.strokeStyle = context.fillStyle;
      context.strokeText(segment.text, drawAt.x, drawAt.y);
    }

    context.restore();
  }

  context.textAlign = textAlign;
};
