import { codeToTokens } from "shiki";

import type { BundledLanguage, ThemedToken } from "shiki";

/**
 * Turns a source snippet into syntax-highlighted *text* for the canvas.
 *
 * Excalidraw text elements carry a single style, so one element cannot hold a
 * highlighted snippet on its own. The way through is to build the card out of
 * many small text elements — one per run of same-coloured characters — and place
 * each at its own x offset. The result is real text: selectable, searchable and
 * editable, with the editor's own colours.
 *
 * That only lines up because the card is monospace. A fixed advance per
 * character means a run's width is exactly `characters x advance`, so laying the
 * runs out side by side needs no per-run measuring and cannot drift.
 */

/** a run of characters sharing one colour */
export type CodeSpan = { text: string; color: string };

/** one line of code, split into coloured runs */
export type HighlightedLine = CodeSpan[];

/** VSCode's own Dark+ theme, which is what a snippet is expected to look like */
const THEME = "dark-plus";

/** one laid-out row of the card: characters, colour, and column offset */
export type LaidOutRun = {
  text: string;
  color: string;
  /** column at which this run starts */
  column: number;
};

/** wider than this a card gets unwieldy, so long lines wrap */
const MAX_COLUMNS = 76;

/** larger than this, highlighting stops being worth the wait */
const MAX_HIGHLIGHT_BYTES = 256 * 1024;

/** background behind the runs, matching VSCode Dark+ */
export const CODE_CARD_BACKGROUND = "#1e1e1e";
export const CODE_CARD_BORDER = "#3c3c3c";

/**
 * Fenced-code info strings are written every which way — `python`, `py`,
 * `Python`, `lang-python`, `c++` — and shiki only knows its own ids. Marked
 * hands us `language-xxx` class names, so the prefix comes off first.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  "c#": "csharp",
  cs: "csharp",
  dotnet: "csharp",
  cpp: "cpp",
  "c++": "cpp",
  cxx: "cpp",
  golang: "go",
  js: "javascript",
  ts: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  mjs: "javascript",
  cjs: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  py: "python",
  python3: "python",
  yml: "yaml",
  md: "markdown",
  "c++/c": "cpp",
  kt: "kotlin",
  rs: "rust",
  rb: "ruby",
  ps1: "powershell",
};

/** shiki's id for a fence info string, or `null` when we cannot place it */
export const normalizeLanguage = (language?: string) => {
  if (!language) {
    return null;
  }

  const cleaned = language
    .trim()
    .toLowerCase()
    .replace(/^language-/, "")
    .replace(/^lang-/, "")
    // `python {1,3}` and similar decorations carry no meaning for shiki
    .split(/[\s,{:]/)[0];

  if (!cleaned) {
    return null;
  }

  return LANGUAGE_ALIASES[cleaned] ?? cleaned;
};

/** tabs would make column maths meaningless, and no editor shows them either */
const expandTabs = (code: string) =>
  code.replace(/\r\n/g, "\n").replace(/\t/g, "  ").replace(/\s+$/, "");

/** an upper bound so a runaway document cannot build a card the size of a wall */
const MAX_LINES = 400;

const splitTokens = (
  code: string,
  tokens: readonly ThemedToken[][],
  fallbackColor: string,
): HighlightedLine[] => {
  const sourceLines = code.split("\n");
  const lines: HighlightedLine[] = [];

  for (let i = 0; i < Math.min(sourceLines.length, MAX_LINES); i++) {
    const spans: CodeSpan[] = [];

    for (const token of tokens[i] ?? []) {
      const text = token.content;

      if (!text) {
        continue;
      }

      // a token that spans a line break would desync the two arrays, so it is
      // split rather than trusted
      const pieces = text.split("\n");

      pieces.forEach((piece, index) => {
        if (index > 0) {
          lines.push(spans.splice(0));
        }

        if (piece) {
          spans.push({ text: piece, color: token.color || fallbackColor });
        }
      });
    }

    lines.push(spans);
  }

  return lines;
};

/**
 * Highlights `code` into coloured runs, one entry per line.
 *
 * Returns `null` when the language is unknown, the snippet is too large, or
 * shiki throws — the caller then falls back to plain text rather than failing
 * the paste.
 */
export const highlightCode = async (
  code: string,
  language?: string,
): Promise<HighlightedLine[] | null> => {
  const normalized = normalizeLanguage(language);

  if (!normalized || code.length > MAX_HIGHLIGHT_BYTES) {
    return null;
  }

  const normalizedCode = expandTabs(code);

  try {
    const result = await codeToTokens(normalizedCode, {
      // `normalizeLanguage` has already reduced this to a bare id; an id this
      // shiki build does not know throws below and is reported as no highlight
      lang: normalized as BundledLanguage,
      theme: THEME,
    });

    return splitTokens(normalizedCode, result.tokens, result.fg || "#d4d4d4");
  } catch {
    return null;
  }
};

/** one wrapped row, still in run form */
type Row = CodeSpan[];

/**
 * Folds a run-split line into rows no wider than `maxColumns`, breaking on
 * whitespace where it can and mid-token where it must — the same rule a text
 * editor uses, and the reason colours survive the wrap.
 */
const wrapRow = (spans: CodeSpan[], maxColumns: number): Row[] => {
  const rows: Row[] = [[]];
  let columns = 0;

  // whitespace is held back rather than committed: it is only worth keeping if
  // the word after it still fits on this row, and otherwise it is the break
  let pendingSpace = "";
  let pendingSpaceColor = "#d4d4d4";

  const newRow = () => {
    rows.push([]);
    columns = 0;
    pendingSpace = "";
  };

  const commitSpace = () => {
    if (!pendingSpace) {
      return;
    }

    const room = maxColumns - columns;

    if (room <= 0) {
      pendingSpace = "";
      return;
    }

    // deep indentation, or a run of trailing spaces, must not push the row past
    // the card's width on its own
    const text =
      pendingSpace.length <= room ? pendingSpace : pendingSpace.slice(0, room);

    rows[rows.length - 1].push({ text, color: pendingSpaceColor });
    columns += text.length;
    pendingSpace = "";
  };

  for (const span of spans) {
    // split so whitespace and non-whitespace alternate, keeping the characters
    // themselves untouched
    for (const piece of span.text.split(/(\s+)/)) {
      if (!piece) {
        continue;
      }

      if (/^\s+$/.test(piece)) {
        pendingSpace += piece;
        pendingSpaceColor = span.color;
        continue;
      }

      // word wrap: if this word cannot follow what is already on the row, the
      // whitespace is where the line breaks
      if (
        columns > 0 &&
        columns + pendingSpace.length + piece.length > maxColumns
      ) {
        newRow();
      } else {
        commitSpace();
      }

      let rest = piece;

      while (rest.length) {
        const room = maxColumns - columns;

        if (room <= 0) {
          newRow();
          continue;
        }

        // a single token longer than the card still has to be cut somewhere
        const take = rest.slice(0, room);
        rows[rows.length - 1].push({ text: take, color: span.color });
        columns += take.length;
        rest = rest.slice(take.length);

        if (rest.length) {
          newRow();
        }
      }
    }
  }

  // trailing whitespace has nothing to separate, so it goes
  pendingSpace = "";

  return rows;
};

/**
 * Lays highlighted lines out into positioned runs, one entry per text element.
 *
 * Adjacent runs of the same colour are merged, because a Python line is
 * otherwise half a dozen elements and nobody wants to select them one by one.
 * Whitespace is folded into the run that follows it so that indentation survives
 * while the element count stays low.
 */
export const layoutCode = (
  lines: HighlightedLine[],
  { maxColumns = MAX_COLUMNS }: { maxColumns?: number } = {},
): LaidOutRun[][] => {
  const rows: Row[] = [];

  for (const line of lines) {
    rows.push(...wrapRow(line, maxColumns));
  }

  return rows.map((row) => {
    const runs: LaidOutRun[] = [];
    let column = 0;
    let pendingSpaces = 0;

    for (const span of row) {
      if (!span.text) {
        continue;
      }

      const isSpaces = /^\s+$/.test(span.text);

      if (isSpaces) {
        pendingSpaces += span.text.length;
        continue;
      }

      const text = " ".repeat(pendingSpaces) + span.text;
      pendingSpaces = 0;

      const previous = runs[runs.length - 1];

      if (previous && previous.color === span.color) {
        previous.text += text;
      } else {
        runs.push({ text, color: span.color, column });
      }

      column += text.length;
    }

    return runs;
  });
};

/** total columns a laid-out card needs, which is its width in characters */
export const codeCardColumns = (rows: LaidOutRun[][]) =>
  rows.reduce(
    (widest, row) =>
      Math.max(
        widest,
        row.reduce((sum, run) => sum + run.text.length, 0),
      ),
    0,
  );
