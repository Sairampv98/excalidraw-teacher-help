/**
 * The flow studio's presets (D-162, D-163, D-165).
 *
 * `buildFlowPreset` turns a preset and a script into **ordinary elements**:
 * shapes with their label bound inside, and arrows bound at both ends. It is a
 * pure function - no DOM, no `appState`, no scene, no network - so it is tested
 * without a canvas, and the MCP server calls the same one the sidebar does.
 *
 * Bindings are written directly (`startBinding`, `endBinding` and each shape's
 * `boundElements`) because the library's own helpers need a live `Scene`. Both
 * sides are written, or the chart comes apart the first time a shape is moved.
 */

import {
  newArrowElement,
  newElement,
  newTextElement,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { PAGE_HEIGHT, PAGE_SPACING, PAGE_WIDTH } from "../types";

import { stampChart } from "./flowChart";
import { layoutFlow } from "./flowLayout";
import { parseFlowScript } from "./flowScript";

import type { FlowFitMode } from "./flowChart";
import type { FlowCustomPreset } from "./flowCustomPresets";
import type { FlowBox } from "./flowOrder";
import type {
  FlowNodeKind,
  FlowNodeShape,
  FlowPresetId,
  FlowScriptEdge,
  FlowScriptNode,
  ParsedFlow,
} from "./flowScript";

export type { FlowNodeShape, FlowPresetId } from "./flowScript";

/* ---------------------------------------------------------------- the presets */

export type FlowPreset = {
  id: FlowPresetId;
  name: string;
  description: string;
  /** a sensible script, so choosing a preset shows a chart that is already right */
  example: string;
};

/** the presets, in the order the studio lists them (D-163) */
export const FLOW_PRESETS: readonly FlowPreset[] = [
  {
    id: "process",
    name: "Process",
    description: "A straight run of steps, one after the other.",
    example: "Plan the lesson\nTeach it\nSet the task\nCheck the work",
  },
  {
    id: "decision",
    name: "Decision",
    description:
      "A question with a yes branch and a no branch that join up again.",
    example:
      "Start the task\n? Does it compile?\nRun the tests\nRead the error\nSubmit",
  },
  {
    id: "steps",
    name: "Step by step",
    description: "Numbered steps, for a procedure the class follows in order.",
    example: "Open the file\nChange one line\nSave it\nRun it again",
  },
  {
    id: "cycle",
    name: "Cycle",
    description: "A loop of steps that returns to the first one.",
    example: "Plan\nBuild\nTest\nImprove",
  },
  {
    id: "tiers",
    name: "Tiers",
    description:
      "Stacked layers, each with its own items - a tier chart or a layered design.",
    example: "Web | Mobile\nAPI\nServices | Cache\nDatabase",
  },
  {
    id: "integration",
    name: "Integration",
    description: "One hub and the things it connects to, around it.",
    example: "Our app\nPayments\nEmail\nCalendar\nChat",
  },
  {
    id: "network",
    name: "Network",
    description: "Nodes joined by edges. Write A -> B for an edge.",
    example:
      "Client -> Server\nServer -> Database\nServer -> Cache\nClient -> CDN",
  },
  {
    id: "list",
    name: "List",
    description: "Blocks one under the next, with no arrows.",
    example: "Warm-up\nExplain the idea\nWork in pairs\nShare back",
  },
  {
    id: "grid",
    name: "Grid",
    description: "A table: a row for each line, the cells between bars.",
    example:
      "# Day | Topic | Homework\nMonday | Fractions | Page 12\nTuesday | Decimals | Page 14\nWednesday | Percentages | Page 16",
  },
  {
    id: "matrix",
    name: "Matrix",
    description: "Four quadrants, two columns of larger cells.",
    example:
      "Urgent and important | Important, not urgent\nUrgent, not important | Neither",
  },
  {
    id: "pyramid",
    name: "Pyramid",
    description: "Blocks that widen down the page, the first the narrowest.",
    example: "Create\nEvaluate\nAnalyse\nApply\nUnderstand\nRemember",
  },
  {
    id: "funnel",
    name: "Funnel",
    description: "Blocks that narrow down the page, the first the widest.",
    example: "Visitors\nSign-ups\nTrials\nCustomers",
  },
  {
    id: "timeline",
    name: "Timeline",
    description: "Boxes along a line, above it and below it in turn.",
    example: "1990 Idea\n1995 Launch\n2005 Growth\n2020 Today",
  },
  {
    id: "target",
    name: "Target",
    description: "Rings one inside the next, the first the outermost.",
    example: "Community\nSchool\nClass\nMe",
  },
  {
    id: "venn",
    name: "Venn",
    description: "Two to four circles that cross.",
    example: "Maths\nArt\nMusic",
  },
  {
    id: "hierarchy",
    name: "Hierarchy",
    description: "A tree: the level of a line is how far it is indented.",
    example:
      "Principal\n  Head of maths\n    Teacher A\n    Teacher B\n  Head of art\n    Teacher C",
  },
];

/** a preset as the Flow tab lists it: the built-in seven first, then the teacher's own (D-228) */
export type FlowPresetListing = {
  id: string;
  name: string;
  description: string;
  example: string;
  custom: boolean;
};

export const listFlowPresets = (
  custom: readonly FlowCustomPreset[],
): FlowPresetListing[] => [
  ...FLOW_PRESETS.map((preset) => ({ ...preset, custom: false })),
  ...custom.map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    example: preset.example,
    custom: true,
  })),
];

/* ------------------------------------------------------------------ constants */

/** the text size a chart starts at, before it is shrunk to fit */
export const BASE_FLOW_FONT_SIZE = 24;

/**
 * The smallest text a chart is allowed (D-165): below it a chart stops being
 * readable from the back of a room, so a script that needs less is reported
 * instead.
 */
export const MIN_FLOW_FONT_SIZE = 14;

/** the font sizes tried, largest first, until the chart fits */
const FONT_SIZES = [24, 22, 20, 18, 16, 15, MIN_FLOW_FONT_SIZE];

/** the margin kept between a chart and the edge of its page */
const PAGE_MARGIN = 40;

/** the longest line of a label, in characters, before it wraps */
const WRAP_CHARS = 18;

const STROKE = "#1e1e1e";

/** the colour of a chart's outlines, its text and its arrows */
const outlineOf = (options: Pick<BuildFlowOptions, "palette">) =>
  options.palette?.outline ?? STROKE;

/** the fill of a node of this kind (D-228): the palette's, in the built-in order */
const fillOf = (
  kind: FlowNodeKind,
  isNoBranch: boolean,
  options: Pick<BuildFlowOptions, "palette">,
) => {
  const fills = options.palette?.fills;

  if (!fills || fills.length === 0) {
    return isNoBranch ? NO_BRANCH_FILL : FILL[kind];
  }

  const at = (i: number) => fills[i % fills.length];

  if (isNoBranch) {
    return at(3);
  }

  return {
    step: at(0),
    branch: at(1),
    question: at(2),
    spoke: at(3),
    hub: at(4),
    cell: at(1),
    header: at(0),
    ring: at(0),
    set: at(0),
    block: at(0),
  }[kind];
};

const FILL: Record<FlowNodeKind, string> = {
  step: "#a5d8ff",
  question: "#ffec99",
  branch: "#b2f2bb",
  hub: "#d0bfff",
  spoke: "#ffd8a8",
  cell: "#b2f2bb",
  header: "#a5d8ff",
  ring: "#a5d8ff",
  set: "#a5d8ff",
  block: "#a5d8ff",
};

/** a "no" branch is told apart from a "yes" by its colour */
const NO_BRANCH_FILL = "#ffc9c9";

const TIER_FILLS = ["#a5d8ff", "#b2f2bb", "#ffec99", "#ffd8a8", "#d0bfff"];

export type FlowPageRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** the shape every node of a chart takes: the preset's own, or one for all (D-229) */
export type FlowChartShape = "own" | FlowNodeShape;

/** the colours a chart is drawn in: five fills and an outline (D-228) */
export type FlowPalette = {
  /** the fills, in the order the built-in presets use them */
  fills: readonly string[];
  /** the colour of every outline, and of the text and the arrows */
  outline: string;
};

export const DEFAULT_FLOW_PALETTE: FlowPalette = {
  fills: ["#a5d8ff", "#b2f2bb", "#ffec99", "#ffd8a8", "#d0bfff"],
  outline: "#1e1e1e",
};

export type BuildFlowOptions = {
  /** the custom preset the chart is made from, which it remembers by value (D-228) */
  custom?: FlowCustomPreset;
  /** the colours of the chart; the built-in presets' own when there are none (D-228) */
  palette?: FlowPalette;
  /** the direction a chart that is laid out in layers runs in; the one that fits the page best when there is none (D-228) */
  direction?: "TB" | "LR";
  /** the shape of every node that its script line does not mark (D-229) */
  shape?: FlowChartShape;
  /** `none` draws no arrow, no connector and no yes or no label (D-231) */
  arrows?: "own" | "none";
  /**
   * The chart's id. When it is given the chart remembers how it was made - its
   * preset, script, fit mode and shape - on its own elements (D-221).
   */
  chartId?: string;
  /** how a chart that is too big for its page is handled (D-226) */
  fit?: FlowFitMode;
  /** the page the chart has to fit; defaults to the first page's rect */
  page?: FlowPageRect;
  /** where the chart's centre should be (clamped so it stays on the page); defaults to the page's centre */
  center?: { x: number; y: number };
  /** the same seed gives the same chart: it decides every id and every rough seed */
  seed?: number;
  /** the page the elements belong to, when the caller already knows it */
  pageId?: string;
  /**
   * The pages a spread chart goes on (D-226): the current page first, then the
   * ones that follow it. A chart that needs more pages than are given goes on
   * pages of the same size after the last one, which the caller makes.
   */
  pages?: { rect: FlowPageRect; pageId?: string }[];
  /** the number of the current page, 1 for the first, for "continues on page N" */
  pageNumber?: number;
  /** told apart from other groups of a spread chart, so that ids never repeat */
  idSalt?: string;
};

export type BuiltFlow = {
  ok: true;
  elements: ExcalidrawElement[];
  /** the text size the chart ended up with */
  fontSize: number;
  /** the chart's bounding box, in scene coordinates */
  bounds: FlowPageRect;
  /** how many pages the chart is on: 1 unless it was spread (D-226) */
  pages: number;
};

export type BuildFlowFailure = {
  ok: false;
  error: string;
  /** the script is fine but does not fit the page at the smallest readable size */
  tooBig?: true;
};

export type BuildFlowResult = BuiltFlow | BuildFlowFailure;

/* --------------------------------------------------------------------- layout */

type Sized = {
  node: FlowScriptNode;
  /** the label as it is written in the shape (wrapped) */
  text: string;
  width: number;
  height: number;
};

type Placed = Sized & {
  x: number;
  y: number;
  /**
   * Where the node's words are, when they are not in the middle of the shape: a
   * ring's band, a circle's far side (D-235). Such words are a text of their own,
   * grouped with the shape.
   */
  label?: { cx: number; cy: number };
};

export const wrapFlowLabel = (label: string, maxChars = WRAP_CHARS) => {
  const lines: string[] = [];
  let line = "";

  for (const word of label.split(/\s+/)) {
    if (line && `${line} ${word}`.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  lines.push(line);

  return lines.join("\n");
};

/** what each kind of node is drawn as when nothing says otherwise */
const ownShapeOf = (kind: FlowNodeKind): FlowNodeShape => {
  switch (kind) {
    case "question":
      return "diamond";
    case "hub":
      return "ellipse";
    case "ring":
      return "ellipse";
    case "set":
      return "circle";
    case "cell":
    case "header":
    case "block":
      return "rectangle";
    default:
      return "rounded";
  }
};

/**
 * The shape of a node (D-229): the mark on its script line, else the chart's
 * shape, else what its kind is drawn as.
 */
export const shapeOfNode = (
  node: FlowScriptNode,
  chart: FlowChartShape = "own",
): FlowNodeShape =>
  node.shape ?? (chart === "own" ? ownShapeOf(node.kind) : chart);

/** the element type a shape is drawn as; a circle is an ellipse (D-229) */
const elementTypeOf = (shape: FlowNodeShape) => {
  switch (shape) {
    case "diamond":
      return "diamond" as const;
    case "ellipse":
    case "circle":
      return "ellipse" as const;
    default:
      return "rectangle" as const;
  }
};

/** the text's own size, measured with the library's own text element */
export const measureFlowText = (text: string, fontSize: number) => {
  const probe = newTextElement({ text, fontSize, x: 0, y: 0 });

  return { width: probe.width, height: probe.height };
};

const sizeNode = (
  node: FlowScriptNode,
  label: string,
  fontSize: number,
  chart: FlowChartShape,
): Sized => {
  const shape = shapeOfNode(node, chart);
  const text = wrapFlowLabel(label);
  const metrics = measureFlowText(text, fontSize);
  const padX = fontSize * 1.2;
  const padY = fontSize * 0.8;
  const minWidth = fontSize * 5;
  const minHeight = fontSize * 2.4;

  let width = Math.max(minWidth, metrics.width + padX * 2);
  let height = Math.max(minHeight, metrics.height + padY * 2);

  // The text and its room lie in the inscribed rectangle of a diamond or an
  // ellipse, which is smaller than the shape's own box: a diamond needs twice
  // the room on each axis and an ellipse the square root of two. A circle is an
  // ellipse of equal sides, wide enough for the diagonal of that room (D-229).
  if (shape === "diamond") {
    width *= 2;
    height *= 2;
  } else if (shape === "ellipse") {
    width *= Math.SQRT2;
    height *= Math.SQRT2;
  } else if (shape === "circle") {
    width = height = Math.hypot(width, height);
  }

  return { node, text, width, height };
};

/** a graph laid out in layers, in the direction that fits the page best */
const layoutLayers = (
  sized: Sized[],
  edges: FlowScriptEdge[],
  fontSize: number,
  page: FlowPageRect,
  direction?: "TB" | "LR",
): Placed[] => {
  // both directions are tried for a small chart; a large one is laid out in the
  // direction its page is longer in, because laying it out twice is slow
  const directions: readonly ("TB" | "LR")[] = direction
    ? [direction]
    : sized.length <= 40
    ? ["TB", "LR"]
    : [page.width >= page.height ? "LR" : "TB"];

  const attempts = directions.map((rankdir) => {
    const { positions } = layoutFlow(
      sized.map((s) => ({
        id: s.node.id,
        box: { x: 0, y: 0, width: s.width, height: s.height },
      })),
      edges.map((e) => ({ from: e.from, to: e.to })),
      { x: 0, y: 0 },
      {
        rankdir,
        nodeSeparation: fontSize * 1.6,
        rankSeparation: fontSize * 3,
      },
    );

    const placed = sized.map((s) => ({ ...s, ...positions.get(s.node.id)! }));
    const bounds = boundsOf(placed);

    return {
      placed,
      // how much of the page the chart needs: the smaller, the better it fits
      need: Math.max(bounds.width / page.width, bounds.height / page.height),
    };
  });

  return attempts.sort((a, b) => a.need - b.need)[0].placed;
};

/**
 * Whether the shapes could not fit the room even if they were packed with
 * nothing between them: their areas add up to more than the room's. Then there
 * is no need to lay them out to find that out.
 */
const cannotFit = (
  sized: readonly Sized[],
  room: { width: number; height: number },
) =>
  sized.reduce((sum, s) => sum + s.width * s.height, 0) >
  room.width * room.height;

const boundsOf = (placed: readonly Placed[]): FlowPageRect => {
  const left = Math.min(...placed.map((p) => p.x));
  const top = Math.min(...placed.map((p) => p.y));
  const right = Math.max(...placed.map((p) => p.x + p.width));
  const bottom = Math.max(...placed.map((p) => p.y + p.height));

  return { x: left, y: top, width: right - left, height: bottom - top };
};

/** shapes placed round an ellipse, the first at the top, going clockwise */
const placeOnRing = (
  sized: Sized[],
  fontSize: number,
  clearance = 0,
): Placed[] => {
  if (sized.length === 1) {
    // alone on a ring with something at its centre (a hub), it goes at the top
    // of the ring, clear of the centre - not on top of it
    const y = clearance > 0 ? -clearance : 0;

    return [
      { ...sized[0], x: -sized[0].width / 2, y: y - sized[0].height / 2 },
    ];
  }

  const biggest = Math.max(...sized.map((s) => Math.max(s.width, s.height)));
  const gap = fontSize * 1.5;
  const radius = Math.max(
    biggest * 1.2 + gap,
    (biggest + gap) / (2 * Math.sin(Math.PI / sized.length)),
    clearance,
  );

  return sized.map((s, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sized.length;

    return {
      ...s,
      // the ring is wider than it is tall, like the page
      x: Math.cos(angle) * radius * 1.5 - s.width / 2,
      y: Math.sin(angle) * radius - s.height / 2,
    };
  });
};

const chartShape = (s: Sized, chart: FlowChartShape) =>
  shapeOfNode(s.node, chart);

const layoutTiers = (
  sized: Sized[],
  tiers: string[][],
  fontSize: number,
  chart: FlowChartShape,
): Placed[] => {
  const byId = new Map(sized.map((s) => [s.node.id, s]));
  const gap = fontSize * 1.2;

  const rows = tiers.map((ids) => ids.map((id) => byId.get(id)!));
  const rowHeight = rows.map((row) => Math.max(...row.map((s) => s.height)));
  // a tier is as wide as the widest tier needs, so the tiers stack flush
  const width = Math.max(
    ...rows.map(
      (row) =>
        row.reduce((sum, s) => sum + s.width, 0) + gap * (row.length - 1),
    ),
  );

  const placed: Placed[] = [];
  let y = 0;

  rows.forEach((row, index) => {
    const itemWidth = (width - gap * (row.length - 1)) / row.length;

    row.forEach((s, i) => {
      const cell = { width: itemWidth, height: rowHeight[index] };

      // a circle keeps its equal sides in the middle of its cell (D-229)
      const circle = chartShape(s, chart) === "circle";
      const side = Math.min(cell.width, cell.height);
      const width = circle ? side : cell.width;
      const height = circle ? side : cell.height;

      placed.push({
        ...s,
        width,
        height,
        x: i * (itemWidth + gap) + (cell.width - width) / 2,
        y: y + (cell.height - height) / 2,
      });
    });

    y += rowHeight[index] + gap;
  });

  return placed;
};

/** a chain longer than this is laid out in rows when there is no room for it in a line (D-227) */
const SNAKE_AFTER = 8;

/**
 * A run of steps that goes back and forth in rows, like a snake: each row runs
 * the other way, so the arrow from one row to the next is short and straight
 * down (D-227). Every step has the same cell, so nothing overlaps.
 */
const layoutSnake = (
  sized: Sized[],
  fontSize: number,
  room: { width: number; height: number },
  constrained: boolean,
): Placed[] => {
  const cellW = Math.max(...sized.map((s) => s.width));
  const cellH = Math.max(...sized.map((s) => s.height));
  const gap = fontSize * 1.6;
  const rowGap = fontSize * 2.4;
  const fitsAcross = Math.max(
    1,
    Math.floor((room.width + gap) / (cellW + gap)),
  );

  let perRow = fitsAcross;

  if (constrained) {
    // the fewest rows that fit the room, so the chart is as large as it can be
    for (let rows = 1; rows <= sized.length; rows++) {
      const across = Math.ceil(sized.length / rows);

      if (
        across * (cellW + gap) - gap <= room.width &&
        rows * (cellH + rowGap) - rowGap <= room.height
      ) {
        perRow = across;
        break;
      }
    }
  }

  return sized.map((s, i) => {
    const row = Math.floor(i / perRow);
    const along = i % perRow;
    const column = row % 2 === 0 ? along : perRow - 1 - along;

    return {
      ...s,
      x: column * (cellW + gap) + (cellW - s.width) / 2,
      y: row * (cellH + rowGap) + (cellH - s.height) / 2,
    };
  });
};

/* ---------------------------------------------------------------------- the gallery (D-232) */

/** the room between the blocks of a stack, in text sizes */
const STACK_GAP = 0.7;

/** a run of blocks, one under the next, all as wide as the widest (D-232) */
const layoutList = (sized: Sized[], fontSize: number): Placed[] => {
  const width = Math.max(...sized.map((s) => s.width));
  const gap = fontSize * STACK_GAP;
  let y = 0;

  return sized.map((s) => {
    const placed = { ...s, width, x: -width / 2, y };

    y += s.height + gap;

    return placed;
  });
};

/**
 * Blocks that widen down the page (a pyramid) or narrow down it (a funnel): the
 * first line is the narrowest of a pyramid and the widest of a funnel. Every
 * block is at least as wide as its own words need (D-232).
 */
const layoutPyramid = (
  sized: Sized[],
  fontSize: number,
  funnel: boolean,
): Placed[] => {
  const base = Math.max(...sized.map((s) => s.width)) * 2.4;
  const tallest = Math.max(...sized.map((s) => s.height));
  const narrow = base * 0.4;
  const gap = fontSize * STACK_GAP * 0.5;
  const last = Math.max(sized.length - 1, 1);

  return sized.map((s, i) => {
    const rank = funnel ? sized.length - 1 - i : i;
    const width = Math.max(s.width, narrow + ((base - narrow) * rank) / last);

    return {
      ...s,
      width,
      height: tallest,
      x: -width / 2,
      y: i * (tallest + gap),
    };
  });
};

/**
 * The boxes of a timeline: they sit on the two sides of one horizontal line in
 * turn, the first above, so that a box has the room of two beside it (D-237).
 * The line is at \`y = 0\`.
 */
const layoutTimeline = (sized: Sized[], fontSize: number): Placed[] => {
  const width = Math.max(...sized.map((s) => s.width));
  const gap = fontSize * 1.2;
  const stem = fontSize * 1.8;
  const pitch = (width + gap) / 2;

  return sized.map((s, i) => {
    const above = i % 2 === 0;

    return {
      ...s,
      width,
      x: i * pitch - width / 2,
      y: above ? -(stem + s.height) : stem,
    };
  });
};

/**
 * A grid of cells: every column is as wide as its widest cell and every row as
 * high as its highest, so the cells meet in straight lines (D-234). A matrix is
 * the same with larger cells.
 */
const layoutGrid = (
  sized: Sized[],
  fontSize: number,
  matrix: boolean,
): Placed[] => {
  const grow = matrix ? 1.5 : 1;
  const gap = fontSize * (matrix ? 0.8 : 0.35);
  const rows = [...new Set(sized.map((s) => s.node.row ?? 0))].sort(
    (a, b) => a - b,
  );
  const cols = [...new Set(sized.map((s) => s.node.col ?? 0))].sort(
    (a, b) => a - b,
  );

  const colWidth = new Map<number, number>();
  const rowHeight = new Map<number, number>();

  for (const s of sized) {
    const c = s.node.col ?? 0;
    const r = s.node.row ?? 0;

    colWidth.set(c, Math.max(colWidth.get(c) ?? 0, s.width * grow));
    rowHeight.set(r, Math.max(rowHeight.get(r) ?? 0, s.height * grow));
  }

  const xOf = new Map<number, number>();
  const yOf = new Map<number, number>();
  let x = 0;
  let y = 0;

  for (const c of cols) {
    xOf.set(c, x);
    x += colWidth.get(c)! + gap;
  }

  for (const r of rows) {
    yOf.set(r, y);
    y += rowHeight.get(r)! + gap;
  }

  return sized.map((s) => ({
    ...s,
    width: colWidth.get(s.node.col ?? 0)!,
    height: rowHeight.get(s.node.row ?? 0)!,
    x: xOf.get(s.node.col ?? 0)!,
    y: yOf.get(s.node.row ?? 0)!,
  }));
};

/**
 * Rings that lie one inside the next, the first line the outermost. Each ring's
 * words are at the top of its own band, so that no two labels meet (D-235).
 */
const layoutTarget = (sized: Sized[], fontSize: number): Placed[] => {
  const band = Math.max(...sized.map((s) => s.height / 1.4)) + fontSize * 0.9;
  const inner = sized[sized.length - 1];
  const rings: { width: number; height: number }[] = [];

  let width = Math.max(inner.width, band * 2.4);
  let height = Math.max(inner.height, band * 1.6);

  for (let i = sized.length - 1; i >= 0; i--) {
    rings[i] = { width, height };
    width += band * 2.4;
    height += band * 1.6;
  }

  return sized.map((s, i) => {
    const ring = rings[i];
    const innermost = i === sized.length - 1;

    return {
      ...s,
      width: ring.width,
      height: ring.height,
      x: -ring.width / 2,
      y: -ring.height / 2,
      label: {
        cx: 0,
        cy: innermost ? 0 : -ring.height / 2 + band / 2 + fontSize * 0.1,
      },
    };
  });
};

/**
 * Two to four circles that cross; each one's words are on its own far side, away
 * from where the others cross it (D-235).
 */
const layoutVenn = (sized: Sized[]): Placed[] => {
  const n = sized.length;
  const diameter = Math.max(...sized.map((s) => s.width)) * 2.2;
  const reach = n === 2 ? 0.3 : 0.32;

  return sized.map((s, i) => {
    const angle =
      n === 1
        ? 0
        : n === 2
        ? i === 0
          ? Math.PI
          : 0
        : n === 3
        ? -Math.PI / 2 + (i * 2 * Math.PI) / 3
        : -Math.PI * 0.75 + (i * Math.PI) / 2;
    const cx = n === 1 ? 0 : Math.cos(angle) * diameter * reach;
    const cy = n === 1 ? 0 : Math.sin(angle) * diameter * reach;

    return {
      ...s,
      width: diameter,
      height: diameter,
      x: cx - diameter / 2,
      y: cy - diameter / 2,
      label: {
        cx: cx + (n === 1 ? 0 : Math.cos(angle) * diameter * 0.26),
        cy: cy + (n === 1 ? 0 : Math.sin(angle) * diameter * 0.26),
      },
    };
  });
};

const layoutForRaw = (
  flow: Extract<ParsedFlow, { ok: true }>,
  sized: Sized[],
  fontSize: number,
  page: FlowPageRect,
  chart: FlowChartShape,
  held: {
    room: { width: number; height: number };
    constrained: boolean;
    direction?: "TB" | "LR";
  },
): Placed[] => {
  switch (flow.preset) {
    case "tiers":
      return layoutTiers(sized, flow.tiers ?? [], fontSize, chart);

    case "cycle":
      return placeOnRing(sized, fontSize);

    case "integration": {
      const [hub, ...spokes] = sized;
      const hubPlaced: Placed = {
        ...hub,
        x: -hub.width / 2,
        y: -hub.height / 2,
      };

      if (spokes.length === 0) {
        return [hubPlaced];
      }

      const biggest = Math.max(
        ...spokes.map((s) => Math.max(s.width, s.height)),
      );
      const clearance =
        (Math.max(hub.width, hub.height) / 2 + biggest / 2) * 1.5 +
        fontSize * 2;

      return [hubPlaced, ...placeOnRing(spokes, fontSize, clearance)];
    }

    case "process":
    case "steps": {
      // a short chain, or one that fits the page in a line or a column, is laid
      // out in layers; a longer one goes in rows (D-227). The line is measured
      // by adding the shapes up, so a long chain is not laid out to be thrown away
      if (sized.length <= SNAKE_AFTER || held.constrained) {
        const gap = fontSize * 1.6;
        const across =
          sized.reduce((sum, s) => sum + s.width, 0) + gap * (sized.length - 1);
        const down =
          sized.reduce((sum, s) => sum + s.height, 0) +
          gap * (sized.length - 1);
        const widest = Math.max(...sized.map((s) => s.width));
        const tallest = Math.max(...sized.map((s) => s.height));
        const inALine =
          (across <= held.room.width && tallest <= held.room.height) ||
          (down <= held.room.height && widest <= held.room.width);

        if (sized.length <= SNAKE_AFTER || inALine) {
          return layoutLayers(
            sized,
            flow.edges,
            fontSize,
            page,
            held.direction,
          );
        }
      }

      return layoutSnake(sized, fontSize, held.room, held.constrained);
    }

    case "list":
      return layoutList(sized, fontSize);

    case "pyramid":
    case "funnel":
      return layoutPyramid(sized, fontSize, flow.preset === "funnel");

    case "timeline":
      return layoutTimeline(sized, fontSize);

    case "grid":
    case "matrix":
      return layoutGrid(sized, fontSize, flow.preset === "matrix");

    case "target":
      return layoutTarget(sized, fontSize);

    case "venn":
      return layoutVenn(sized);

    case "hierarchy":
      return layoutLayers(sized, flow.edges, fontSize, page, "TB");

    default:
      return layoutLayers(sized, flow.edges, fontSize, page, held.direction);
  }
};

/**
 * A chart laid out, and a circle kept a circle (D-229): a layout that stretches a
 * node to its cell - a column, a row, the width of a stack - must not stretch a
 * circle, so it is made as large as the smaller side of its cell allows and put
 * in the middle of it.
 */
const layoutFor = (
  flow: Extract<ParsedFlow, { ok: true }>,
  sized: Sized[],
  fontSize: number,
  page: FlowPageRect,
  chart: FlowChartShape,
  held: {
    room: { width: number; height: number };
    constrained: boolean;
    direction?: "TB" | "LR";
  },
): Placed[] =>
  layoutForRaw(flow, sized, fontSize, page, chart, held).map((p) => {
    if (shapeOfNode(p.node, chart) !== "circle" || p.width === p.height) {
      return p;
    }

    const side = Math.min(p.width, p.height);

    return {
      ...p,
      width: side,
      height: side,
      x: p.x + (p.width - side) / 2,
      y: p.y + (p.height - side) / 2,
    };
  });

/* ------------------------------------------------------------------- elements */

type Side = "top" | "right" | "bottom" | "left";

const FIXED_POINT: Record<Side, [number, number]> = {
  top: [0.5, 0],
  right: [1, 0.5],
  bottom: [0.5, 1],
  left: [0, 0.5],
};

const sidePoint = (box: FlowBox, side: Side) => {
  const [rx, ry] = FIXED_POINT[side];

  return { x: box.x + box.width * rx, y: box.y + box.height * ry };
};

/** the side of `from` that faces `to`, and the side of `to` that faces back */
const facingSides = (from: FlowBox, to: FlowBox): [Side, Side] => {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  const horizontal = Math.abs(dx) / ((from.width + to.width) / 2);
  const vertical = Math.abs(dy) / ((from.height + to.height) / 2);

  if (vertical >= horizontal) {
    return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
  }

  return dx >= 0 ? ["right", "left"] : ["left", "right"];
};

/** a deterministic stream of ids and rough seeds, so the same input is the same chart */
export const createIds = (seed: number, salt = "") => {
  let counter = 0;

  return {
    id: (kind: string) => `flow${seed}${salt}-${kind}${counter++}`,
    roughSeed: () => {
      counter++;
      return (Math.imul(seed + counter, 2654435761) >>> 0) % 2 ** 31;
    },
  };
};

const withBound = (
  element: ExcalidrawElement,
  bound: { id: string; type: "text" | "arrow" },
): ExcalidrawElement => ({
  ...element,
  boundElements: [...(element.boundElements ?? []), bound],
});

/**
 * The arrow that joins two shapes, and its label, with the arrow bound to both
 * by the sides that face each other (D-173). It is what a chart's edges are
 * made with, and what Apply makes new edges with (D-223): the caller names the
 * arrow on each shape's `boundElements`.
 */
export const buildEdge = (
  fromBox: FlowBox,
  toBox: FlowBox,
  fromShapeId: string,
  toShapeId: string,
  edge: { from: string; to: string; label?: string },
  fontSize: number,
  ids: { id: (kind: string) => string; roughSeed: () => number },
  options: Pick<BuildFlowOptions, "pageId" | "palette"> & {
    /** a connector has no arrowhead (D-236) */
    noHead?: boolean;
  },
): { arrowId: string; elements: ExcalidrawElement[] } => {
  const [fromSide, toSide] = facingSides(fromBox, toBox);
  const start = sidePoint(fromBox, fromSide);
  const end = sidePoint(toBox, toSide);

  const arrowId = ids.id("arrow");
  const arrow = newArrowElement({
    type: "arrow",
    seed: ids.roughSeed(),
    x: start.x,
    y: start.y,
    points: [
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(end.x - start.x, end.y - start.y),
    ],
    endArrowhead: options.noHead ? null : "arrow",
    strokeColor: outlineOf(options),
    customData: { flow: { role: "edge", from: edge.from, to: edge.to } },
    pageId: options.pageId,
  });

  let bound: ExcalidrawArrowElement = {
    ...arrow,
    id: arrowId,
    // the constructor leaves the size at zero, and a resize scales the points
    // by it: an arrow that says it is zero wide is scaled down to nothing
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    startBinding: {
      elementId: fromShapeId,
      fixedPoint: FIXED_POINT[fromSide],
      mode: "orbit",
    },
    endBinding: {
      elementId: toShapeId,
      fixedPoint: FIXED_POINT[toSide],
      mode: "orbit",
    },
  };

  if (!edge.label) {
    return { arrowId, elements: [bound] };
  }

  const labelSize = Math.max(12, Math.round(fontSize * 0.8));
  const labelId = ids.id("text");
  const label = newTextElement({
    text: edge.label,
    fontSize: labelSize,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: arrowId,
    x: 0,
    y: 0,
    seed: ids.roughSeed(),
    strokeColor: outlineOf(options),
    customData: { flow: { role: "edge-label" } },
    pageId: options.pageId,
  });

  bound = { ...bound, boundElements: [{ id: labelId, type: "text" }] };

  return {
    arrowId,
    elements: [
      bound,
      {
        ...label,
        id: labelId,
        x: (start.x + end.x) / 2 - label.width / 2,
        y: (start.y + end.y) / 2 - label.height / 2,
      },
    ],
  };
};

/** the fill a gallery node has by where it is in its chart (D-232, D-234, D-235) */
const galleryFill = (
  p: Placed,
  index: number,
  flow: Extract<ParsedFlow, { ok: true }>,
  options: Pick<BuildFlowOptions, "palette">,
) => {
  const fills = options.palette?.fills ?? TIER_FILLS;
  const kind = p.node.kind;

  if (
    kind === "ring" ||
    kind === "set" ||
    kind === "block" ||
    flow.preset === "matrix"
  ) {
    return fills[index % fills.length];
  }

  // a table: its header in the first fill, its cells in the second
  if (kind === "header") {
    return fills[0];
  }

  if (kind === "cell") {
    return fills[1 % fills.length];
  }

  return undefined;
};

/**
 * What a timeline has besides its boxes (D-237): the line across, a dot for each
 * part and a short stem from each dot to its box. They are drawn, and they join
 * nothing.
 */
const timelineElements = (
  placed: readonly Placed[],
  origin: { x: number; y: number },
  fontSize: number,
  ids: ReturnType<typeof createIds>,
  options: BuildFlowOptions,
): ExcalidrawElement[] => {
  if (placed.length === 0) {
    return [];
  }

  const axisY = origin.y;
  const dots = placed.map((p) => ({
    x: p.x + origin.x + p.width / 2,
    above: p.y + p.height <= 0,
    box: p,
  }));
  const left = Math.min(...dots.map((d) => d.x)) - fontSize * 2;
  const right = Math.max(...dots.map((d) => d.x)) + fontSize * 2;

  const plain = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    role: string,
  ): ExcalidrawElement => ({
    ...newArrowElement({
      type: "arrow",
      seed: ids.roughSeed(),
      x: from.x,
      y: from.y,
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(to.x - from.x, to.y - from.y),
      ],
      startArrowhead: null,
      endArrowhead: null,
      strokeColor: outlineOf(options),
      customData: { flow: { role } },
      pageId: options.pageId,
    }),
    id: ids.id(role),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  });

  const decor: ExcalidrawElement[] = [
    plain({ x: left, y: axisY }, { x: right, y: axisY }, "timeline-line"),
  ];

  for (const dot of dots) {
    const radius = Math.max(fontSize * 0.3, 4);
    const edgeY = dot.above
      ? dot.box.y + dot.box.height + origin.y
      : dot.box.y + origin.y;

    decor.push(
      plain({ x: dot.x, y: axisY }, { x: dot.x, y: edgeY }, "timeline-stem"),
      {
        ...newElement({
          type: "ellipse",
          seed: ids.roughSeed(),
          x: dot.x - radius,
          y: axisY - radius,
          width: radius * 2,
          height: radius * 2,
          strokeColor: outlineOf(options),
          backgroundColor: outlineOf(options),
          fillStyle: "solid",
          customData: { flow: { role: "timeline-dot" } },
          pageId: options.pageId,
        }),
        id: ids.id("timeline-dot"),
      },
    );
  }

  return decor;
};

const buildElements = (
  flow: Extract<ParsedFlow, { ok: true }>,
  placed: Placed[],
  fontSize: number,
  origin: { x: number; y: number },
  options: BuildFlowOptions,
): ExcalidrawElement[] => {
  const ids = createIds(options.seed ?? 1, options.idSalt ?? "");
  const boxes = new Map<string, FlowBox>();
  const shapeIds = new Map<string, string>();
  const shapes = new Map<string, ExcalidrawElement>();
  const texts: ExcalidrawElement[] = [];

  placed.forEach((p, index) => {
    const box = {
      x: p.x + origin.x,
      y: p.y + origin.y,
      width: p.width,
      height: p.height,
    };
    boxes.set(p.node.id, box);

    const isNoBranch =
      p.node.kind === "branch" &&
      flow.edges.some((e) => e.to === p.node.id && e.label === "no");
    const tierFill =
      p.node.tier !== undefined
        ? (options.palette?.fills ?? TIER_FILLS)[
            p.node.tier % (options.palette?.fills ?? TIER_FILLS).length
          ]
        : undefined;

    // the constructors do not take an id, so it is set on what they return -
    // and the text needs its container's id before it is made
    const shapeId = ids.id("shape");
    const textId = ids.id("text");
    // words that are not in the middle of their shape stay with it as a group
    const groupId = p.label ? ids.id("group") : undefined;

    const shape: ExcalidrawElement = {
      ...newElement({
        type: elementTypeOf(shapeOfNode(p.node, options.shape)),
        seed: ids.roughSeed(),
        ...box,
        strokeColor: outlineOf(options),
        backgroundColor:
          tierFill ??
          galleryFill(p, index, flow, options) ??
          fillOf(p.node.kind, isNoBranch, options),
        fillStyle: "solid",
        // the rings of a target and the circles of a venn let each other show through
        opacity: p.label ? 70 : 100,
        ...(groupId ? { groupIds: [groupId] } : {}),
        roundness:
          shapeOfNode(p.node, options.shape) === "rounded" ? { type: 3 } : null,
        customData: {
          flow: {
            role: "node",
            nodeId: p.node.id,
            shape: shapeOfNode(p.node, options.shape),
          },
        },
        pageId: options.pageId,
      }),
      id: shapeId,
    };

    const text = newTextElement({
      text: p.text,
      originalText: p.node.label,
      fontSize,
      textAlign: "center",
      verticalAlign: "middle",
      ...(p.label ? { groupIds: [groupId!] } : { containerId: shapeId }),
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      seed: ids.roughSeed(),
      strokeColor: outlineOf(options),
      customData: { flow: { role: "label", nodeId: p.node.id } },
      pageId: options.pageId,
    });

    // the text is centred in its container
    const centred: ExcalidrawTextElement = {
      ...text,
      id: textId,
      x: p.label
        ? origin.x + p.label.cx - text.width / 2
        : box.x + (box.width - text.width) / 2,
      y: p.label
        ? origin.y + p.label.cy - text.height / 2
        : box.y + (box.height - text.height) / 2,
    };

    shapeIds.set(p.node.id, shapeId);
    shapes.set(
      p.node.id,
      p.label ? shape : withBound(shape, { id: textId, type: "text" }),
    );
    texts.push(centred);
  });

  const arrows: ExcalidrawElement[] = [];

  // with no arrows nothing is drawn between the shapes (D-231); a hierarchy's
  // connectors have no arrowhead (D-236)
  for (const edge of options.arrows === "none" ? [] : flow.edges) {
    const made = buildEdge(
      boxes.get(edge.from)!,
      boxes.get(edge.to)!,
      shapeIds.get(edge.from)!,
      shapeIds.get(edge.to)!,
      edge,
      fontSize,
      ids,
      { ...options, noHead: flow.preset === "hierarchy" },
    );

    // both sides of the binding: the shapes name the arrow back
    shapes.set(
      edge.from,
      withBound(shapes.get(edge.from)!, { id: made.arrowId, type: "arrow" }),
    );
    shapes.set(
      edge.to,
      withBound(shapes.get(edge.to)!, { id: made.arrowId, type: "arrow" }),
    );

    arrows.push(...made.elements);
  }

  // shapes (each followed by its label), then the arrows and their labels
  const ordered: ExcalidrawElement[] = [];

  placed.forEach((p, i) => {
    ordered.push(shapes.get(p.node.id)!, texts[i]);
  });

  return [
    ...ordered,
    ...arrows,
    ...(flow.preset === "timeline"
      ? timelineElements(placed, origin, fontSize, ids, options)
      : []),
  ];
};

/* ---------------------------------------------------------------------- build */

const numbered = (flow: Extract<ParsedFlow, { ok: true }>) =>
  flow.preset === "steps"
    ? flow.nodes.map((node, i) => ({
        ...node,
        label: `${i + 1}. ${node.label}`,
      }))
    : flow.nodes;

/** the chart's record is put on its elements when it has an id (D-221) */
const remembered = (
  elements: ExcalidrawElement[],
  preset: FlowPresetId,
  script: string,
  options: BuildFlowOptions,
) =>
  options.chartId
    ? stampChart(elements, {
        id: options.chartId,
        preset: options.custom?.id ?? preset,
        script,
        ...(options.custom ? { custom: options.custom } : {}),
        fit: options.fit ?? "page",
        shape: options.shape ?? "own",
        arrows: options.arrows ?? "own",
      })
    : elements;

const TOO_BIG_ERROR =
  "That is too much for one page at a size that can be read from the back of the room. Spread it over pages, or allow it to be larger than the page.";

type Parsed = Extract<ParsedFlow, { ok: true }>;
type Labelled = ReturnType<typeof numbered>;

/** the text size of a chart that is spread over pages or allowed to be large (D-226) */
const LARGE_FONT_SIZE = 18;

/** the room a stub needs round a spread chart's shapes, in scene units */
const STUB_ROOM = 40;

/**
 * One group of a chart's nodes laid out on one page and turned into elements.
 * It returns `null` when `constrained` and the group does not fit the page at
 * any of the sizes; when it is not constrained the group is centred on the page
 * and may be larger than it.
 */
const buildGroup = (
  parsed: Parsed,
  nodes: Labelled,
  page: FlowPageRect,
  options: BuildFlowOptions,
  fontSizes: readonly number[],
  constrained: boolean,
  margin = PAGE_MARGIN,
): BuiltFlow | null => {
  const room = {
    width: page.width - margin * 2,
    height: page.height - margin * 2,
  };
  const shape = options.shape ?? "own";

  // when the shapes at the smallest size do not fit even packed edge to edge,
  // no size does: nothing is laid out to find that out
  if (constrained && fontSizes.length > 1) {
    const smallest = Math.min(...fontSizes);

    if (
      cannotFit(
        nodes.map((node) => sizeNode(node, node.label, smallest, shape)),
        room,
      )
    ) {
      return null;
    }
  }

  for (const fontSize of fontSizes) {
    const sized = nodes.map((node) =>
      sizeNode(node, node.label, fontSize, shape),
    );
    if (constrained && cannotFit(sized, room)) {
      continue;
    }

    const placed = layoutFor(parsed, sized, fontSize, page, shape, {
      room,
      constrained,
      direction: options.direction,
    });
    const bounds = boundsOf(placed);

    if (
      constrained &&
      (bounds.width > room.width || bounds.height > room.height)
    ) {
      continue;
    }

    // centred where the caller asked, but never off the page when it is held to it
    const centre = options.center ?? {
      x: page.x + page.width / 2,
      y: page.y + page.height / 2,
    };
    const clamp = (value: number, min: number, max: number) =>
      constrained ? Math.min(Math.max(value, min), max) : value;
    const origin = {
      x:
        clamp(
          centre.x - bounds.width / 2,
          page.x + margin,
          page.x + page.width - margin - bounds.width,
        ) - bounds.x,
      y:
        clamp(
          centre.y - bounds.height / 2,
          page.y + margin,
          page.y + page.height - margin - bounds.height,
        ) - bounds.y,
    };

    return {
      ok: true,
      elements: buildElements(parsed, placed, fontSize, origin, options),
      fontSize,
      bounds: {
        x: bounds.x + origin.x,
        y: bounds.y + origin.y,
        width: bounds.width,
        height: bounds.height,
      },
      pages: 1,
    };
  }

  return null;
};

/** the nodes of a chart that are in `ids`, and the edges between them */
const subFlow = (parsed: Parsed, ids: ReadonlySet<string>): Parsed => ({
  ...parsed,
  nodes: parsed.nodes.filter((node) => ids.has(node.id)),
  edges: parsed.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
  tiers: parsed.tiers
    ?.map((tier) => tier.filter((id) => ids.has(id)))
    .filter((tier) => tier.length > 0),
  rows: parsed.rows
    ?.map((row) => row.filter((id) => ids.has(id)))
    .filter((row) => row.length > 0),
});

/** the page the k-th group goes on: the ones the caller has, then the same size beyond them */
const pageAt = (
  options: BuildFlowOptions,
  page: FlowPageRect,
  index: number,
) => {
  const given = options.pages?.[index];

  if (given) {
    return given;
  }

  const last = options.pages?.[options.pages.length - 1];
  const base = last?.rect ?? page;
  const from = options.pages?.length ? options.pages.length - 1 : 0;

  return {
    rect: {
      x: base.x + (base.width + PAGE_SPACING) * (index - from),
      y: base.y,
      width: base.width,
      height: base.height,
    },
    pageId: undefined,
  };
};

/** a short arrow and a label at a shape's corner, for an edge that goes to another page (D-226) */
const stubElements = (
  box: FlowBox,
  shapeId: string,
  direction: "out" | "in",
  pageNumber: number,
  fontSize: number,
  ids: ReturnType<typeof createIds>,
  options: BuildFlowOptions,
): { arrow: ExcalidrawElement; label: ExcalidrawElement; bound: string } => {
  const reach = 16;
  const corner =
    direction === "out"
      ? { x: box.x + box.width, y: box.y }
      : { x: box.x, y: box.y };
  const far =
    direction === "out"
      ? { x: corner.x + reach, y: corner.y - reach }
      : { x: corner.x - reach, y: corner.y - reach };
  const start = direction === "out" ? corner : far;
  const end = direction === "out" ? far : corner;
  const arrowId = ids.id("stub");
  const labelSize = Math.max(12, Math.round(fontSize * 0.75));
  const label = newTextElement({
    text:
      direction === "out"
        ? `continues on page ${pageNumber}`
        : `from page ${pageNumber}`,
    fontSize: labelSize,
    textAlign: direction === "out" ? "left" : "right",
    x: 0,
    y: 0,
    seed: ids.roughSeed(),
    strokeColor: outlineOf(options),
    customData: { flow: { role: "stub-label" } },
    pageId: options.pageId,
  });

  const arrow: ExcalidrawElement = {
    ...newArrowElement({
      type: "arrow",
      seed: ids.roughSeed(),
      x: start.x,
      y: start.y,
      points: [
        pointFrom<LocalPoint>(0, 0),
        pointFrom<LocalPoint>(end.x - start.x, end.y - start.y),
      ],
      endArrowhead: direction === "in" ? "arrow" : "arrow",
      strokeColor: outlineOf(options),
      customData: { flow: { role: "stub" } },
      pageId: options.pageId,
    }),
    id: arrowId,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    ...(direction === "out"
      ? {
          startBinding: {
            elementId: shapeId,
            fixedPoint: [1, 0] as [number, number],
            mode: "orbit" as const,
          },
        }
      : {
          endBinding: {
            elementId: shapeId,
            fixedPoint: [0, 0] as [number, number],
            mode: "orbit" as const,
          },
        }),
  };

  return {
    arrow,
    label: {
      ...label,
      id: ids.id("text"),
      x: direction === "out" ? far.x + 3 : far.x - label.width - 3,
      y: far.y - label.height / 2,
    },
    bound: arrowId,
  };
};

/** the chart cut into pages, in the order of its script, with stubs where an arrow crosses (D-226) */
const buildSpread = (
  parsed: Parsed,
  nodes: Labelled,
  page: FlowPageRect,
  options: BuildFlowOptions,
): BuiltFlow => {
  const fontSize = LARGE_FONT_SIZE;
  const shape = options.shape ?? "own";
  const margin = PAGE_MARGIN + STUB_ROOM;
  const room = {
    width: page.width - margin * 2,
    height: page.height - margin * 2,
  };

  const sizedAll = new Map(
    nodes.map((node) => [node.id, sizeNode(node, node.label, fontSize, shape)]),
  );

  const areaOf = (id: string) => {
    const size = sizedAll.get(id)!;

    return size.width * size.height;
  };

  /** lays a group out on one page: whether it fits, and the room its shapes take */
  const trial = (ids: string[]) => {
    const set = new Set(ids);
    const flow = subFlow(parsed, set);
    const sized = flow.nodes.map((node) => sizedAll.get(node.id)!);

    if (cannotFit(sized, room)) {
      return { fits: false, share: 0 };
    }

    const bounds = boundsOf(
      layoutFor(flow, sized, fontSize, page, shape, {
        room,
        constrained: true,
        direction: options.direction,
      }),
    );

    return {
      fits: bounds.width <= room.width && bounds.height <= room.height,
      share:
        sized.reduce((sum, s) => sum + s.width * s.height, 0) /
        (room.width * room.height),
    };
  };

  // In the order of the script, as many to a page as fit. The count is guessed
  // from the share of a page that the shapes of the last group took, and made
  // smaller until the group fits, so a long script is laid out about twice for
  // each page and not once for every node.
  const groups: string[][] = [];
  let start = 0;
  // the share of a page that shapes can take: a guess, then what was learned
  let density = 0.15;

  while (start < nodes.length) {
    const begin = start;
    const left = nodes.length - begin;
    const idsOf = (count: number) =>
      nodes.slice(begin, begin + count).map((node) => node.id);

    let count = 1;
    let area = areaOf(nodes[begin].id);

    while (
      count < left &&
      area + areaOf(nodes[begin + count].id) <=
        room.width * room.height * density
    ) {
      area += areaOf(nodes[begin + count].id);
      count++;
    }

    let result = trial(idsOf(count));

    while (!result.fits && count > 1) {
      count = Math.max(1, Math.floor(count * 0.88));
      density *= 0.88;
      result = trial(idsOf(count));
    }

    if (result.fits) {
      // a little more than this group took: the next one is guessed from it
      density = result.share * 1.1;
    }

    groups.push(idsOf(count));
    start += count;
  }

  const pageOf = new Map<string, number>();

  groups.forEach((ids, index) => ids.forEach((id) => pageOf.set(id, index)));

  const first = options.pageNumber ?? 1;
  const elements: ExcalidrawElement[] = [];
  const all: FlowPageRect[] = [];

  groups.forEach((ids, index) => {
    const target = pageAt(options, page, index);
    const set = new Set(ids);
    const flow = subFlow(parsed, set);
    const groupOptions: BuildFlowOptions = {
      ...options,
      idSalt: `p${index}`,
      pageId: target.pageId,
      // each group is centred on its own page
      center: undefined,
    };
    const built =
      buildGroup(
        flow,
        nodes.filter((node) => set.has(node.id)),
        target.rect,
        groupOptions,
        [fontSize],
        true,
        margin,
      ) ??
      buildGroup(
        flow,
        nodes.filter((node) => set.has(node.id)),
        target.rect,
        groupOptions,
        [fontSize],
        false,
        margin,
      )!;

    // the stubs: an arrow that leaves this page, and one that arrives on it
    const ids2 = createIds(options.seed ?? 1, `s${index}`);
    const byNode = new Map(
      built.elements
        .filter(
          (element) =>
            element.type !== "text" &&
            element.type !== "arrow" &&
            element.customData?.flow?.role === "node",
        )
        .map((element) => [element.customData!.flow.nodeId as string, element]),
    );
    const extra: ExcalidrawElement[] = [];
    const boundTo = new Map<string, { id: string; type: "arrow" }[]>();

    for (const edge of parsed.edges) {
      const fromPage = pageOf.get(edge.from)!;
      const toPage = pageOf.get(edge.to)!;

      if (fromPage === toPage || (fromPage !== index && toPage !== index)) {
        continue;
      }

      const direction = fromPage === index ? "out" : "in";
      const nodeId = direction === "out" ? edge.from : edge.to;
      const shapeEl = byNode.get(nodeId)!;
      const other = direction === "out" ? toPage : fromPage;
      const stub = stubElements(
        {
          x: shapeEl.x,
          y: shapeEl.y,
          width: shapeEl.width,
          height: shapeEl.height,
        },
        shapeEl.id,
        direction,
        first + other,
        fontSize,
        ids2,
        groupOptions,
      );

      extra.push(stub.arrow, stub.label);
      boundTo.set(shapeEl.id, [
        ...(boundTo.get(shapeEl.id) ?? []),
        { id: stub.bound, type: "arrow" },
      ]);
    }

    for (const element of built.elements) {
      const more = boundTo.get(element.id);

      elements.push(
        more
          ? {
              ...element,
              boundElements: [...(element.boundElements ?? []), ...more],
            }
          : element,
      );
    }

    elements.push(...extra);

    // each element says which of the chart's pages it is on
    for (
      let i = elements.length - built.elements.length - extra.length;
      i < elements.length;
      i++
    ) {
      const element = elements[i];

      elements[i] = {
        ...element,
        ...(target.pageId ? { pageId: target.pageId } : {}),
        customData: {
          ...element.customData,
          flow: { ...element.customData?.flow, pageIndex: index },
        },
      };
    }

    all.push(built.bounds);
  });

  const left = Math.min(...all.map((b) => b.x));
  const top = Math.min(...all.map((b) => b.y));
  const right = Math.max(...all.map((b) => b.x + b.width));
  const bottom = Math.max(...all.map((b) => b.y + b.height));

  return {
    ok: true,
    elements,
    fontSize,
    bounds: { x: left, y: top, width: right - left, height: bottom - top },
    pages: groups.length,
  };
};

/**
 * Builds a chart from a preset and a script (D-162).
 *
 * With **Fit to page** (D-165, the default) the chart is **scaled to fit the
 * page**: the text is shrunk, step by step, until the whole chart is inside the
 * page's rect with its margin - and if it does not fit even at the smallest
 * readable text size, nothing is built and the failure says so, rather than
 * shrinking past readable. **Spread over pages** and **Allow larger than page**
 * are the other two ways of letting a large chart be built at a readable size
 * (D-226).
 */
export const buildFlowPreset = (
  preset: FlowPresetId,
  script: string,
  options: BuildFlowOptions = {},
): BuildFlowResult => {
  const parsed = parseFlowScript(preset, script);

  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const page = options.page ?? {
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
  };
  const nodes = numbered(parsed);
  const fit = options.fit ?? "page";

  // a chart that fits its page is built the same way in every mode
  const onePage = buildGroup(parsed, nodes, page, options, FONT_SIZES, true);

  if (onePage) {
    return {
      ...onePage,
      elements: remembered(onePage.elements, preset, script, options),
    };
  }

  if (fit === "larger") {
    const large = buildGroup(
      parsed,
      nodes,
      page,
      options,
      [LARGE_FONT_SIZE],
      false,
    )!;

    return {
      ...large,
      elements: remembered(large.elements, preset, script, options),
    };
  }

  if (fit === "spread") {
    const spread = buildSpread(parsed, nodes, page, options);

    return {
      ...spread,
      elements: remembered(spread.elements, preset, script, options),
    };
  }

  return { ok: false, error: TOO_BIG_ERROR, tooBig: true };
};
