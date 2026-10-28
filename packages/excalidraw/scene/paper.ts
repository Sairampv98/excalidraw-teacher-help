/**
 * The paper of a page (D-243).
 *
 * A page has a paper: the sheet it is written on - plain, lined, squared and so
 * on - its colour, a film grain and how old it looks. It is a fact about the
 * page (`page.paper`), so it is saved with the document, it is the same in the
 * editor, the presenter and every export, and a page without one is the page it
 * always was.
 *
 * What is here is pure: the data, the named colours and looks, and the *marks*
 * of a paper (its rules and dots) as lines and points, so that the canvas and
 * the SVG export draw the same paper from one place and it can be read without
 * a canvas.
 */

import type { Ink } from "@excalidraw/element";

import type { ExcalidrawPage, PageRect } from "../types";

export const PAPER_TYPES = [
  "plain",
  "single-line",
  "double-line",
  "grid",
  "dot-grid",
  "cornell",
  "isometric",
  "music",
] as const;

export type PaperType = typeof PAPER_TYPES[number];

export const PAPER_TYPE_LABELS: Record<PaperType, string> = {
  plain: "Plain",
  "single-line": "Single line",
  "double-line": "Double line",
  grid: "Grid",
  "dot-grid": "Dot grid",
  cornell: "Cornell",
  isometric: "Isometric",
  music: "Music staff",
};

/** the colour a page has when it has none of its own: the canvas shows through */
export const CANVAS_PAPER_COLOR = "canvas";

export type PaperColor = {
  id: string;
  name: string;
  color: string;
  /** a dark paper: its rules are light and its ageing is smudged, not yellowed */
  dark: boolean;
};

export const PAPER_COLORS: readonly PaperColor[] = [
  { id: "white", name: "White", color: "#ffffff", dark: false },
  { id: "cream", name: "Cream", color: "#fbf4e2", dark: false },
  { id: "parchment", name: "Parchment", color: "#efe0b9", dark: false },
  { id: "legal", name: "Legal yellow", color: "#fff3a3", dark: false },
  { id: "sky", name: "Sky", color: "#e3f1fb", dark: false },
  { id: "mint", name: "Mint", color: "#e4f5e6", dark: false },
  { id: "rose", name: "Rose", color: "#fde6ea", dark: false },
  { id: "lavender", name: "Lavender", color: "#ece6fa", dark: false },
  { id: "kraft", name: "Kraft", color: "#d9b98a", dark: false },
  { id: "chalkboard", name: "Green chalkboard", color: "#2f4f3e", dark: true },
  { id: "blackboard", name: "Blackboard", color: "#1f2326", dark: true },
  { id: "midnight", name: "Midnight", color: "#0d1424", dark: true },
];

export type PagePaper = {
  type: PaperType;
  /** the id of a named colour, or `canvas` */
  color: string;
  /** 0 to 100: the film grain */
  grain: number;
  /** 0 to 100: how old the paper looks */
  age: number;
};

export const PLAIN_PAPER: PagePaper = {
  type: "plain",
  color: CANVAS_PAPER_COLOR,
  grain: 0,
  age: 0,
};

const clampPercent = (value: unknown) => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;

  return Math.min(100, Math.max(0, Math.round(n)));
};

export const isPaperType = (value: unknown): value is PaperType =>
  typeof value === "string" &&
  (PAPER_TYPES as readonly string[]).includes(value);

export const getPaperColor = (id: string): PaperColor | null =>
  PAPER_COLORS.find((color) => color.id === id) ?? null;

/** the paper of a page, with what is missing or out of range resolved */
export const paperOf = (page: Pick<ExcalidrawPage, "paper">): PagePaper => {
  const stored = page.paper;

  if (!stored) {
    return PLAIN_PAPER;
  }

  return {
    type: isPaperType(stored.type) ? stored.type : "plain",
    color:
      stored.color === CANVAS_PAPER_COLOR || getPaperColor(stored.color)
        ? stored.color
        : CANVAS_PAPER_COLOR,
    grain: clampPercent(stored.grain),
    age: clampPercent(stored.age),
  };
};

/** whether a paper draws nothing: the page is the invisible rectangle it was */
export const isPlainPaper = (paper: PagePaper) =>
  paper.type === "plain" &&
  paper.color === CANVAS_PAPER_COLOR &&
  paper.grain === 0 &&
  paper.age === 0;

/* ------------------------------------------------------------------- the looks */

export type PaperLook = {
  id: string;
  name: string;
  paper: PagePaper;
  /** the ink the next elements are drawn with on this paper */
  ink: Ink & { color: string };
};

export const PAPER_LOOKS: readonly PaperLook[] = [
  {
    id: "old-paper",
    name: "Old paper",
    paper: { type: "single-line", color: "parchment", grain: 35, age: 70 },
    ink: { look: "pencil", amount: 70, color: "#4a4a4a" },
  },
  {
    id: "green-chalkboard",
    name: "Green chalkboard",
    paper: { type: "plain", color: "chalkboard", grain: 25, age: 25 },
    ink: { look: "chalk", amount: 50, color: "#f5f5f0" },
  },
  {
    id: "blackboard",
    name: "Blackboard",
    paper: { type: "plain", color: "blackboard", grain: 20, age: 15 },
    ink: { look: "chalk", amount: 50, color: "#f5f5f0" },
  },
  {
    id: "neon-night",
    name: "Neon night",
    paper: { type: "dot-grid", color: "midnight", grain: 10, age: 0 },
    ink: { look: "neon", amount: 50, color: "#00f0ff" },
  },
];

/* ----------------------------------------------------------------------- marks */

export type PaperMark =
  | {
      kind: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      /** a margin or a cue column is drawn heavier than a rule */
      heavy: boolean;
    }
  | { kind: "dot"; x: number; y: number };

/** a segment cut to the rect, or null when none of it is inside */
const clipSegment = (
  rect: PageRect,
  [x1, y1, x2, y2]: [number, number, number, number],
): [number, number, number, number] | null => {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const edges: [number, number][] = [
    [-dx, x1 - rect.x],
    [dx, rect.x + rect.width - x1],
    [-dy, y1 - rect.y],
    [dy, rect.y + rect.height - y1],
  ];

  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) {
        return null;
      }
    } else {
      const r = q / p;

      if (p < 0) {
        if (r > t1) {
          return null;
        }
        t0 = Math.max(t0, r);
      } else {
        if (r < t0) {
          return null;
        }
        t1 = Math.min(t1, r);
      }
    }
  }

  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
};

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * The rules and dots of a paper type on a page rect. Their spacing is a share
 * of the page's height, so a larger page has the same number of rules, farther
 * apart, and the paper looks the same whatever the size of the page.
 */
export const paperMarks = (type: PaperType, rect: PageRect): PaperMark[] => {
  const marks: PaperMark[] = [];
  const { x, y, width, height } = rect;
  const step = height / 24;

  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    heavy = false,
  ) => {
    const cut = clipSegment(rect, [x1, y1, x2, y2]);

    if (cut) {
      marks.push({
        kind: "line",
        x1: round(cut[0]),
        y1: round(cut[1]),
        x2: round(cut[2]),
        y2: round(cut[3]),
        heavy,
      });
    }
  };
  const rows = (from: number, to: number, pitch: number, after = 0) => {
    for (let row = from; row <= to; row++) {
      const at = y + row * pitch + after;

      line(x, at, x + width, at);
    }
  };

  switch (type) {
    case "single-line":
      rows(2, 23, step);
      break;
    case "double-line": {
      const pitch = height / 14;
      const gap = height / 135;

      for (let row = 2; row <= 13; row++) {
        const at = y + row * pitch;

        line(x, at - gap, x + width, at - gap);
        line(x, at + gap, x + width, at + gap);
      }
      break;
    }
    case "grid":
    case "dot-grid": {
      const cols = Math.floor(width / step);
      const lines = type === "grid";

      for (let col = 0; col <= cols; col++) {
        const at = x + col * step;

        if (lines) {
          line(at, y, at, y + height);
        }
      }

      for (let row = 0; row <= 24; row++) {
        const at = y + row * step;

        if (lines) {
          line(x, at, x + width, at);
        } else {
          for (let col = 0; col <= cols; col++) {
            marks.push({ kind: "dot", x: round(x + col * step), y: round(at) });
          }
        }
      }
      break;
    }
    case "cornell": {
      rows(2, 19, step);
      // the cue column on the left and the summary at the foot
      line(x + width * 0.28, y, x + width * 0.28, y + step * 20, true);
      line(x, y + step * 20, x + width, y + step * 20, true);
      break;
    }
    case "isometric": {
      const vertical = step * 1.5;
      const slope = Math.tan(Math.PI / 6);
      const cols = Math.ceil(width / vertical);

      for (let col = 0; col <= cols; col++) {
        line(x + col * vertical, y, x + col * vertical, y + height);
      }

      // the two diagonal families, a vertical step apart so they meet the
      // verticals at the same points
      const reach = Math.ceil((width * slope) / step) + 1;
      const rowsBelow = Math.ceil(height / step) + reach;

      for (let k = -reach; k <= rowsBelow; k++) {
        const at = y + k * step;

        line(x, at, x + width, at + width * slope);
        line(x, at + width * slope, x + width, at);
      }
      break;
    }
    case "music": {
      const gap = height / 60;
      const pitch = height / 9;

      for (let staff = 0; staff < 8; staff++) {
        const top = y + pitch * 0.9 + staff * pitch;

        for (let n = 0; n < 5; n++) {
          line(
            x + width * 0.04,
            top + n * gap,
            x + width * 0.96,
            top + n * gap,
          );
        }
      }
      break;
    }
    default:
      break;
  }

  return marks;
};

/* ------------------------------------------------------------------- the drawing */

/** what the canvas and the SVG export draw for a page's paper */
export type PagePaperDraw = {
  rect: PageRect;
  paper: PagePaper;
  /** the colour of the sheet, or null when the canvas shows through */
  color: string | null;
  dark: boolean;
  /** the colour of the rules and dots */
  ruleColor: string;
  /** the width of a rule, in scene units */
  ruleWidth: number;
  marks: PaperMark[];
  /** the page's own number, so its grain and its fibres are always the same */
  seed: number;
};

/** a number from a string: the same text, the same number */
export const seedOf = (text: string) => {
  let h = 2166136261;

  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
};

export const getPagePaperDraw = (
  page: ExcalidrawPage,
  rect: PageRect,
): PagePaperDraw | null => {
  const paper = paperOf(page);

  if (isPlainPaper(paper)) {
    return null;
  }

  const named = getPaperColor(paper.color);
  const dark = named?.dark ?? false;

  return {
    rect,
    paper,
    color: named?.color ?? null,
    dark,
    ruleColor: dark ? "rgba(255,255,255,0.28)" : "rgba(60,100,170,0.38)",
    ruleWidth: Math.max(1, round(rect.height / 540)),
    marks: paperMarks(paper.type, rect),
    seed: seedOf(page.id),
  };
};

/** how many fibres an old paper has: they grow with the age and the area */
export const fibreCount = (draw: PagePaperDraw) =>
  Math.min(
    1500,
    Math.round(
      (draw.paper.age / 100) *
        260 *
        ((draw.rect.width * draw.rect.height) / (1920 * 1080)),
    ),
  );
