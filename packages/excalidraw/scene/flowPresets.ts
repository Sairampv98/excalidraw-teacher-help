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

import { PAGE_HEIGHT, PAGE_WIDTH } from "../types";

import { layoutFlow } from "./flowLayout";
import { parseFlowScript } from "./flowScript";

import type { FlowBox } from "./flowOrder";
import type {
  FlowNodeKind,
  FlowPresetId,
  FlowScriptEdge,
  FlowScriptNode,
  ParsedFlow,
} from "./flowScript";

export type { FlowPresetId } from "./flowScript";

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

const FILL: Record<FlowNodeKind, string> = {
  step: "#a5d8ff",
  question: "#ffec99",
  branch: "#b2f2bb",
  hub: "#d0bfff",
  spoke: "#ffd8a8",
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

export type BuildFlowOptions = {
  /** the page the chart has to fit; defaults to the first page's rect */
  page?: FlowPageRect;
  /** where the chart's centre should be (clamped so it stays on the page); defaults to the page's centre */
  center?: { x: number; y: number };
  /** the same seed gives the same chart: it decides every id and every rough seed */
  seed?: number;
  /** the page the elements belong to, when the caller already knows it */
  pageId?: string;
};

export type BuiltFlow = {
  ok: true;
  elements: ExcalidrawElement[];
  /** the text size the chart ended up with */
  fontSize: number;
  /** the chart's bounding box, in scene coordinates */
  bounds: FlowPageRect;
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

type Placed = Sized & { x: number; y: number };

const wrapLabel = (label: string, maxChars = WRAP_CHARS) => {
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

const shapeTypeFor = (kind: FlowNodeKind) => {
  switch (kind) {
    case "question":
      return "diamond" as const;
    case "hub":
      return "ellipse" as const;
    default:
      return "rectangle" as const;
  }
};

/** the text's own size, measured with the library's own text element */
const measure = (text: string, fontSize: number) => {
  const probe = newTextElement({ text, fontSize, x: 0, y: 0 });

  return { width: probe.width, height: probe.height };
};

const sizeNode = (
  node: FlowScriptNode,
  label: string,
  fontSize: number,
): Sized => {
  const text = wrapLabel(label);
  const metrics = measure(text, fontSize);
  const padX = fontSize * 1.2;
  const padY = fontSize * 0.8;
  const minWidth = fontSize * 5;
  const minHeight = fontSize * 2.4;

  let width = Math.max(minWidth, metrics.width + padX * 2);
  let height = Math.max(minHeight, metrics.height + padY * 2);

  // the text sits in the inscribed rectangle of a diamond and an ellipse, which
  // is a fraction of the shape's own box
  if (node.kind === "question") {
    width *= 1.8;
    height *= 1.8;
  } else if (node.kind === "hub") {
    width *= 1.4;
    height *= 1.5;
  }

  return { node, text, width, height };
};

/** a graph laid out in layers, in the direction that fits the page best */
const layoutLayers = (
  sized: Sized[],
  edges: FlowScriptEdge[],
  fontSize: number,
  page: FlowPageRect,
): Placed[] => {
  const attempts = (["TB", "LR"] as const).map((rankdir) => {
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

const layoutTiers = (
  sized: Sized[],
  tiers: string[][],
  fontSize: number,
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
      placed.push({
        ...s,
        width: itemWidth,
        height: rowHeight[index],
        x: i * (itemWidth + gap),
        y,
      });
    });

    y += rowHeight[index] + gap;
  });

  return placed;
};

const layoutFor = (
  flow: Extract<ParsedFlow, { ok: true }>,
  sized: Sized[],
  fontSize: number,
  page: FlowPageRect,
): Placed[] => {
  switch (flow.preset) {
    case "tiers":
      return layoutTiers(sized, flow.tiers ?? [], fontSize);

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

    default:
      return layoutLayers(sized, flow.edges, fontSize, page);
  }
};

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
const createIds = (seed: number) => {
  let counter = 0;

  return {
    id: (kind: string) => `flow${seed}-${kind}${counter++}`,
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

const buildElements = (
  flow: Extract<ParsedFlow, { ok: true }>,
  placed: Placed[],
  fontSize: number,
  origin: { x: number; y: number },
  options: BuildFlowOptions,
): ExcalidrawElement[] => {
  const ids = createIds(options.seed ?? 1);
  const boxes = new Map<string, FlowBox>();
  const shapeIds = new Map<string, string>();
  const shapes = new Map<string, ExcalidrawElement>();
  const texts: ExcalidrawElement[] = [];

  placed.forEach((p) => {
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
        ? TIER_FILLS[p.node.tier % TIER_FILLS.length]
        : undefined;

    // the constructors do not take an id, so it is set on what they return -
    // and the text needs its container's id before it is made
    const shapeId = ids.id("shape");
    const textId = ids.id("text");

    const shape: ExcalidrawElement = {
      ...newElement({
        type: shapeTypeFor(p.node.kind),
        seed: ids.roughSeed(),
        ...box,
        strokeColor: STROKE,
        backgroundColor:
          tierFill ?? (isNoBranch ? NO_BRANCH_FILL : FILL[p.node.kind]),
        fillStyle: "solid",
        roundness: p.node.kind === "question" ? null : { type: 3 },
        customData: { flow: { role: "node", nodeId: p.node.id } },
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
      containerId: shapeId,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      seed: ids.roughSeed(),
      strokeColor: STROKE,
      customData: { flow: { role: "label", nodeId: p.node.id } },
      pageId: options.pageId,
    });

    // the text is centred in its container
    const centred: ExcalidrawTextElement = {
      ...text,
      id: textId,
      x: box.x + (box.width - text.width) / 2,
      y: box.y + (box.height - text.height) / 2,
    };

    shapeIds.set(p.node.id, shapeId);
    shapes.set(p.node.id, withBound(shape, { id: textId, type: "text" }));
    texts.push(centred);
  });

  const arrows: ExcalidrawElement[] = [];

  for (const edge of flow.edges) {
    const fromBox = boxes.get(edge.from)!;
    const toBox = boxes.get(edge.to)!;
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
      endArrowhead: "arrow",
      strokeColor: STROKE,
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
        elementId: shapeIds.get(edge.from)!,
        fixedPoint: FIXED_POINT[fromSide],
        mode: "orbit",
      },
      endBinding: {
        elementId: shapeIds.get(edge.to)!,
        fixedPoint: FIXED_POINT[toSide],
        mode: "orbit",
      },
    };

    // both sides of the binding: the shapes name the arrow back
    shapes.set(
      edge.from,
      withBound(shapes.get(edge.from)!, { id: arrowId, type: "arrow" }),
    );
    shapes.set(
      edge.to,
      withBound(shapes.get(edge.to)!, { id: arrowId, type: "arrow" }),
    );

    if (edge.label) {
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
        strokeColor: STROKE,
        customData: { flow: { role: "edge-label" } },
        pageId: options.pageId,
      });

      bound = {
        ...bound,
        boundElements: [{ id: labelId, type: "text" }],
      };

      arrows.push(bound, {
        ...label,
        id: labelId,
        x: (start.x + end.x) / 2 - label.width / 2,
        y: (start.y + end.y) / 2 - label.height / 2,
      });
    } else {
      arrows.push(bound);
    }
  }

  // shapes (each followed by its label), then the arrows and their labels
  const ordered: ExcalidrawElement[] = [];

  placed.forEach((p, i) => {
    ordered.push(shapes.get(p.node.id)!, texts[i]);
  });

  return [...ordered, ...arrows];
};

/* ---------------------------------------------------------------------- build */

const numbered = (flow: Extract<ParsedFlow, { ok: true }>) =>
  flow.preset === "steps"
    ? flow.nodes.map((node, i) => ({
        ...node,
        label: `${i + 1}. ${node.label}`,
      }))
    : flow.nodes;

const TOO_BIG_ERROR =
  "That is too much for one page at a size that can be read from the back of the room. Split it across two pages.";

/**
 * Builds a chart from a preset and a script (D-162).
 *
 * The chart is **scaled to fit the page** (D-165): the text is shrunk, step by
 * step, until the whole chart is inside the page's rect with its margin - and
 * if it does not fit even at the smallest readable text size, nothing is built
 * and the failure says so, rather than shrinking past readable.
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
  const room = {
    width: page.width - PAGE_MARGIN * 2,
    height: page.height - PAGE_MARGIN * 2,
  };
  const nodes = numbered(parsed);

  for (const fontSize of FONT_SIZES) {
    const sized = nodes.map((node) => sizeNode(node, node.label, fontSize));
    const placed = layoutFor(parsed, sized, fontSize, page);
    const bounds = boundsOf(placed);

    if (bounds.width > room.width || bounds.height > room.height) {
      continue;
    }

    // centred where the caller asked, but never off the page
    const centre = options.center ?? {
      x: page.x + page.width / 2,
      y: page.y + page.height / 2,
    };
    const clamp = (value: number, min: number, max: number) =>
      Math.min(Math.max(value, min), max);
    const origin = {
      x:
        clamp(
          centre.x - bounds.width / 2,
          page.x + PAGE_MARGIN,
          page.x + page.width - PAGE_MARGIN - bounds.width,
        ) - bounds.x,
      y:
        clamp(
          centre.y - bounds.height / 2,
          page.y + PAGE_MARGIN,
          page.y + page.height - PAGE_MARGIN - bounds.height,
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
    };
  }

  return { ok: false, error: TOO_BIG_ERROR, tooBig: true };
};
