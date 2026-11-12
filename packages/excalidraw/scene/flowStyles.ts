/**
 * The geometry of the flow animation's styles (D-166, D-171).
 *
 * Everything here is a **pure function of time**: given an arrow's path and the
 * time elapsed, it says where the beam, the dashes or the token are. Nothing
 * reads a clock and nothing is remembered between calls, so
 *
 *  - the same elapsed time gives the same picture whatever the frame rate (the
 *    speed is in scene units a second, never in units a frame - D-171), and
 *  - it is tested without a canvas, and the overlay only has to put the result
 *    on screen.
 *
 * The path is the **arrow's own geometry** - its points, taken from the element
 * - so a mark follows a bent or an elbowed arrow and moves when the arrow
 * moves (D-166).
 */

import { getArrowheadAngle, getArrowheadSize } from "@excalidraw/element";
import { generateLinearCollisionShape } from "@excalidraw/element/shape";
import { isElbowArrow } from "@excalidraw/element/typeChecks";

import type {
  ElementsMap,
  ExcalidrawLinearElement,
} from "@excalidraw/element/types";

export type PathPoint = { x: number; y: number };

/** the styles the section offers; `focus` is what wave 6c made */
export type FlowStyle =
  | "focus"
  | "beam"
  | "marching"
  | "marching-beam"
  | "marching-token"
  | "pipe"
  | "token"
  | "pulse";

export const FLOW_STYLES: readonly { id: FlowStyle; label: string }[] = [
  { id: "focus", label: "Focus" },
  { id: "beam", label: "Beam" },
  { id: "marching", label: "Marching dashes" },
  { id: "marching-beam", label: "Marching beams" },
  { id: "marching-token", label: "Marching tokens" },
  { id: "pipe", label: "Pipe" },
  { id: "token", label: "Token" },
  { id: "pulse", label: "Pulse" },
];

/** how fast a mark travels, in scene units a second - never "a frame" (D-171) */
export const FLOW_SPEED = 240;

/** the limits of the speed setting, in scene units a second (D-179) */
export const FLOW_SPEED_MIN = 10;
export const FLOW_SPEED_MAX = 600;

/** a speed held between the limits */
export const clampFlowSpeed = (speed: number) =>
  Math.min(
    Math.max(Number.isFinite(speed) ? speed : FLOW_SPEED, FLOW_SPEED_MIN),
    FLOW_SPEED_MAX,
  );

/** how long the beam's streak of light is, in scene units */
export const FLOW_BEAM_LENGTH = 90;

/** the dash and the gap of the marching dashes, in scene units */
export const FLOW_DASH: readonly [number, number] = [10, 10];

/** the size of the token, in scene units */
export const FLOW_TOKEN_RADIUS = 8;

/* ----------------------------------------------------------------------- path */

/**
 * The arrow's path in scene coordinates.
 *
 * The points are stored relative to the arrow's position, and the arrow may be
 * rotated: the library rotates an element about the centre of its own bounds.
 */
/**
 * The arrowheads of an arrow as polylines (the two wings, or the whole bar), at
 * the end of its path and at its start, so that a neon arrow glows along its
 * head too. The head is laid out as the editor lays it out: its size, capped at
 * half of the last section, and its angle either side of the way the arrow goes.
 */
export const arrowheadsOf = (
  arrow: ExcalidrawLinearElement,
  path: readonly PathPoint[],
): PathPoint[][] => {
  const heads: PathPoint[][] = [];
  const ends: [
    PathPoint,
    PathPoint,
    ExcalidrawLinearElement["endArrowhead"],
  ][] = [];

  if (path.length >= 2) {
    ends.push([
      path[path.length - 1],
      path[path.length - 2],
      arrow.endArrowhead,
    ]);
    ends.push([path[0], path[1], arrow.startArrowhead]);
  }

  for (const [tip, before, head] of ends) {
    if (!head || head === "circle" || head === "circle_outline") {
      continue;
    }

    const length = Math.hypot(tip.x - before.x, tip.y - before.y);

    if (length < 0.001) {
      continue;
    }

    // from the tip back along the arrow
    const bx = (before.x - tip.x) / length;
    const by = (before.y - tip.y) / length;
    const size = Math.min(getArrowheadSize(head), length * 0.5);
    const angle = (getArrowheadAngle(head) * Math.PI) / 180;
    const wing = (sign: number) => {
      const cos = Math.cos(angle * sign);
      const sin = Math.sin(angle * sign);

      return {
        x: tip.x + (bx * cos - by * sin) * size,
        y: tip.y + (bx * sin + by * cos) * size,
      };
    };

    heads.push([wing(1), tip, wing(-1)]);
  }

  return heads;
};

export const getArrowPath = (arrow: ExcalidrawLinearElement): PathPoint[] => {
  const routed = !!(
    arrow.customData?.flow?.route || arrow.customData?.flow?.fork
  );
  const saved = routed ? curvePaths.get(arrow) : undefined;
  if (saved && saved.version === arrow.version) {
    return saved.path;
  }
  if (arrow.roundness || isElbowArrow(arrow)) {
    const cached = curvePaths.get(arrow);
    if (cached?.version === arrow.version) {
      return cached.path;
    }
    const ops = generateLinearCollisionShape(
      arrow,
      new Map([[arrow.id, arrow]]) as ElementsMap,
    );
    const sampled: PathPoint[] = [];
    for (const op of ops) {
      if (op.op === "move" || op.op === "lineTo") {
        sampled.push({ x: arrow.x + op.data[0], y: arrow.y + op.data[1] });
      } else if (op.op === "bcurveTo" && sampled.length) {
        const from = sampled[sampled.length - 1];
        const [ax, ay, bx, by, cx, cy] = op.data;
        const controlLength =
          Math.hypot(arrow.x + ax - from.x, arrow.y + ay - from.y) +
          Math.hypot(bx - ax, by - ay) +
          Math.hypot(cx - bx, cy - by);
        const count = Math.max(
          32,
          Math.min(4096, Math.ceil(controlLength / 2 / 2) * 2),
        );
        for (let index = 1; index <= count; index++) {
          const t = index / count;
          const u = 1 - t;
          sampled.push({
            x:
              u ** 3 * from.x +
              3 * u ** 2 * t * (arrow.x + ax) +
              3 * u * t ** 2 * (arrow.x + bx) +
              t ** 3 * (arrow.x + cx),
            y:
              u ** 3 * from.y +
              3 * u ** 2 * t * (arrow.y + ay) +
              3 * u * t ** 2 * (arrow.y + by) +
              t ** 3 * (arrow.y + cy),
          });
        }
      }
    }
    curvePaths.set(arrow, { version: arrow.version, path: sampled });
    return sampled;
  }
  const path = arrow.points.map(([px, py]) => ({
    x: arrow.x + px,
    y: arrow.y + py,
  }));

  if (!arrow.angle) {
    if (routed) {
      curvePaths.set(arrow, { version: arrow.version, path });
    }
    return path;
  }

  const cx = arrow.x + arrow.width / 2;
  const cy = arrow.y + arrow.height / 2;
  const cos = Math.cos(arrow.angle);
  const sin = Math.sin(arrow.angle);

  const rotated = path.map(({ x, y }) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  }));
  if (routed) {
    curvePaths.set(arrow, { version: arrow.version, path: rotated });
  }
  return rotated;
};

const curvePaths = new WeakMap<
  ExcalidrawLinearElement,
  { version: number; path: PathPoint[] }
>();

export const pathLength = (path: readonly PathPoint[]) => {
  let length = 0;

  for (let i = 1; i < path.length; i++) {
    length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }

  return length;
};

/** the point `distance` along the path, which is held at its two ends */
export const pointAtDistance = (
  path: readonly PathPoint[],
  distance: number,
): PathPoint => {
  if (path.length === 0) {
    return { x: 0, y: 0 };
  }

  let remaining = Math.max(0, distance);

  for (let i = 1; i < path.length; i++) {
    const segment = Math.hypot(
      path[i].x - path[i - 1].x,
      path[i].y - path[i - 1].y,
    );

    if (remaining <= segment && segment > 0) {
      const t = remaining / segment;

      return {
        x: path[i - 1].x + (path[i].x - path[i - 1].x) * t,
        y: path[i - 1].y + (path[i].y - path[i - 1].y) * t,
      };
    }

    remaining -= segment;
  }

  return path[path.length - 1];
};

/** the part of the path between two distances along it */
export const subPath = (
  path: readonly PathPoint[],
  from: number,
  to: number,
): PathPoint[] => {
  const total = pathLength(path);
  const start = Math.min(Math.max(from, 0), total);
  const end = Math.min(Math.max(to, 0), total);

  if (end <= start) {
    return [];
  }

  const out: PathPoint[] = [pointAtDistance(path, start)];
  let travelled = 0;

  for (let i = 1; i < path.length; i++) {
    travelled += Math.hypot(
      path[i].x - path[i - 1].x,
      path[i].y - path[i - 1].y,
    );

    if (travelled > start && travelled < end) {
      out.push(path[i]);
    }
  }

  out.push(pointAtDistance(path, end));

  return out;
};

/* ---------------------------------------------------------------------- marks */

/** a stroke the overlay draws, in scene units */
export type FlowStroke = {
  points: PathPoint[];
  /** the stroke's width in scene units */
  width: number;
  /** a role, not a colour: the overlay's stylesheet decides what it looks like */
  role: "base" | "beam" | "dash" | "pipe-dark" | "pipe-light" | "pipe-flow";
  dash?: readonly [number, number];
  /** where the dash pattern starts: it decreases, so the dashes run forward */
  dashOffset?: number;
};

export type FlowDot = PathPoint & { radius: number; role: "token" };

export type FlowMarks = { strokes: FlowStroke[]; dots: FlowDot[] };

/** what the marks are drawn with: the chart's size and how fast they travel */
export type FlowMarkOptions = {
  /** repeated marks' separation, before chart scale; default 150 scene units */
  spacing?: number;
  /** the gap between two marching dashes, before chart scale; default 10 */
  dashGap?: number;
  /** how many times the normal width the neon marks are drawn (small, large) */
  widthK?: number;
  /** the chart scale of D-175; marks are drawn this much larger */
  scale?: number;
  /** scene units a second before the scale, between the limits (D-179) */
  speed?: number;
};

/** how far along the path a mark has got `elapsedMs` after it started */
const travelled = (elapsedMs: number, options?: FlowMarkOptions) =>
  (elapsedMs / 1000) *
  clampFlowSpeed(options?.speed ?? FLOW_SPEED) *
  (options?.scale ?? 1);

/** the dash and the gap, at the chart's size */
const dashFor = (options?: FlowMarkOptions): readonly [number, number] => {
  const requested = options?.dashGap;
  const gap =
    typeof requested === "number" && Number.isFinite(requested)
      ? Math.max(2, requested)
      : FLOW_DASH[1];

  return [FLOW_DASH[0] * (options?.scale ?? 1), gap * (options?.scale ?? 1)];
};

/** the dash pattern's offset after `elapsedMs`: it runs toward the arrow's end */
const flowingOffset = (elapsedMs: number, options?: FlowMarkOptions) => {
  const [dash, gap] = dashFor(options);

  // a decreasing offset moves the dashes in the direction the path is drawn
  return -(travelled(elapsedMs, options) % (dash + gap));
};

/**
 * What a style draws along one arrow, `elapsedMs` after the animation reached
 * the step. `focus`, `pulse` and `none` draw nothing on an arrow: they are
 * treatments of the step.
 */
export const flowMarksFor = (
  style: FlowStyle | "none" | "off",
  path: readonly PathPoint[],
  elapsedMs: number,
  options?: FlowMarkOptions,
): FlowMarks => {
  const marks = rawMarksFor(style, path, elapsedMs, options);
  const k = options?.widthK;

  // the neon width: small, normal or large lines (1 leaves the marks alone)
  if (typeof k !== "number" || !Number.isFinite(k) || k === 1 || k <= 0) {
    return marks;
  }

  return {
    strokes: marks.strokes.map((stroke) => ({
      ...stroke,
      width: stroke.width * k,
    })),
    dots: marks.dots.map((dot) => ({ ...dot, radius: dot.radius * k })),
  };
};

const rawMarksFor = (
  style: FlowStyle | "none" | "off",
  path: readonly PathPoint[],
  elapsedMs: number,
  options?: FlowMarkOptions,
): FlowMarks => {
  const none: FlowMarks = { strokes: [], dots: [] };

  if (path.length < 2) {
    return none;
  }

  const length = pathLength(path);
  const scale = options?.scale ?? 1;
  const beamLength = FLOW_BEAM_LENGTH * scale;

  switch (style) {
    case "marching-beam":
    case "marching-token": {
      const requested = options?.spacing;
      const spacing =
        (Number.isFinite(requested) && requested! > 0
          ? Math.max(16, requested!)
          : 150) * scale;
      const phase = travelled(elapsedMs, options) % spacing;
      const count = Math.ceil(length / spacing);
      const marks: FlowMarks = { strokes: [], dots: [] };
      for (let index = 0; index < count; index++) {
        const head = phase + index * spacing;
        if (style === "marching-token") {
          marks.dots.push({
            ...pointAtDistance(path, head),
            radius: head <= length ? FLOW_TOKEN_RADIUS * scale : 0,
            role: "token",
          });
        } else {
          marks.strokes.push({
            points: subPath(path, head - beamLength, Math.min(head, length)),
            width: 5 * scale,
            role: "beam",
          });
        }
      }
      return marks;
    }
    case "beam": {
      // the streak enters at the start, crosses, and leaves at the end
      const head = travelled(elapsedMs, options) % (length + beamLength);

      return {
        strokes: [
          { points: [...path], width: 2 * scale, role: "base" },
          {
            points: subPath(path, head - beamLength, head),
            width: 5 * scale,
            role: "beam",
          },
        ],
        dots: [],
      };
    }

    case "marching":
      return {
        strokes: [
          {
            points: [...path],
            width: 3 * scale,
            role: "dash",
            dash: dashFor(options),
            dashOffset: flowingOffset(elapsedMs, options),
          },
        ],
        dots: [],
      };

    case "pipe":
      // three strokes laid one over another: a dark outer, a lighter inner,
      // and a dashed highlight that runs along it (D-171)
      return {
        strokes: [
          { points: [...path], width: 11 * scale, role: "pipe-dark" },
          { points: [...path], width: 7 * scale, role: "pipe-light" },
          {
            points: [...path],
            width: 2 * scale,
            role: "pipe-flow",
            dash: dashFor(options),
            dashOffset: flowingOffset(elapsedMs, options),
          },
        ],
        dots: [],
      };

    case "token": {
      const at = pointAtDistance(
        path,
        travelled(elapsedMs, options) % Math.max(length, 1),
      );

      return {
        strokes: [{ points: [...path], width: 2 * scale, role: "base" }],
        dots: [{ ...at, radius: FLOW_TOKEN_RADIUS * scale, role: "token" }],
      };
    }

    default:
      return none;
  }
};

/* ------------------------------------------------- the two animations (D-178) */

/** what the shapes do while a step is current */
export type FlowNodeStyle = "off" | "none" | "focus" | "pulse";

/** the arrow styles that draw something: not "none" and not "off" */
export const arrowAnimates = (style: unknown) =>
  style !== "none" && style !== "off";

/** the node styles that move: the highlight follows the step */
export const nodeAnimates = (style: unknown) =>
  style === "focus" || style === "pulse";

/** what the arrows do: the marks drawn along them */
export type FlowArrowStyle =
  | "off"
  | "none"
  | "beam"
  | "marching"
  | "marching-beam"
  | "marching-token"
  | "pipe"
  | "token";

export const FLOW_NODE_STYLES: readonly { id: FlowNodeStyle; label: string }[] =
  [
    { id: "off", label: "Off" },
    { id: "none", label: "None" },
    { id: "focus", label: "Focus" },
    { id: "pulse", label: "Pulse" },
  ];

export const FLOW_ARROW_STYLES: readonly {
  id: FlowArrowStyle;
  label: string;
}[] = [
  { id: "off", label: "Off" },
  { id: "none", label: "None" },
  { id: "beam", label: "Beam" },
  { id: "marching", label: "Marching dashes" },
  { id: "marching-beam", label: "Marching beams" },
  { id: "marching-token", label: "Marching tokens" },
  { id: "pipe", label: "Pipe" },
  { id: "token", label: "Token" },
];

/**
 * A single style (D-166) read as the pair it stands for: focus and pulse treat
 * the nodes, the other four draw on the arrows.
 */
export const splitFlowStyle = (
  style: FlowStyle,
): { node: FlowNodeStyle; arrow: FlowArrowStyle } => {
  switch (style) {
    case "focus":
      return { node: "focus", arrow: "none" };
    case "pulse":
      return { node: "pulse", arrow: "none" };
    default:
      return { node: "none", arrow: style };
  }
};
