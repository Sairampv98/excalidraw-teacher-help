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

import type { ExcalidrawLinearElement } from "@excalidraw/element/types";

export type PathPoint = { x: number; y: number };

/** the styles the section offers; `focus` is what wave 6c made */
export type FlowStyle =
  | "focus"
  | "beam"
  | "marching"
  | "pipe"
  | "token"
  | "pulse";

export const FLOW_STYLES: readonly { id: FlowStyle; label: string }[] = [
  { id: "focus", label: "Focus" },
  { id: "beam", label: "Beam" },
  { id: "marching", label: "Marching dashes" },
  { id: "pipe", label: "Pipe" },
  { id: "token", label: "Token" },
  { id: "pulse", label: "Pulse" },
];

/** how fast a mark travels, in scene units a second - never "a frame" (D-171) */
export const FLOW_SPEED = 240;

/** the limits of the speed setting, in scene units a second (D-179) */
export const FLOW_SPEED_MIN = 40;
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
export const getArrowPath = (arrow: ExcalidrawLinearElement): PathPoint[] => {
  const path = arrow.points.map(([px, py]) => ({
    x: arrow.x + px,
    y: arrow.y + py,
  }));

  if (!arrow.angle) {
    return path;
  }

  const cx = arrow.x + arrow.width / 2;
  const cy = arrow.y + arrow.height / 2;
  const cos = Math.cos(arrow.angle);
  const sin = Math.sin(arrow.angle);

  return path.map(({ x, y }) => ({
    x: cx + (x - cx) * cos - (y - cy) * sin,
    y: cy + (x - cx) * sin + (y - cy) * cos,
  }));
};

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
const dashFor = (options?: FlowMarkOptions): readonly [number, number] => [
  FLOW_DASH[0] * (options?.scale ?? 1),
  FLOW_DASH[1] * (options?.scale ?? 1),
];

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
  style: FlowStyle | "none",
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
export type FlowNodeStyle = "none" | "focus" | "pulse";

/** what the arrows do: the marks drawn along them */
export type FlowArrowStyle = "none" | "beam" | "marching" | "pipe" | "token";

export const FLOW_NODE_STYLES: readonly { id: FlowNodeStyle; label: string }[] =
  [
    { id: "none", label: "None" },
    { id: "focus", label: "Focus" },
    { id: "pulse", label: "Pulse" },
  ];

export const FLOW_ARROW_STYLES: readonly {
  id: FlowArrowStyle;
  label: string;
}[] = [
  { id: "none", label: "None" },
  { id: "beam", label: "Beam" },
  { id: "marching", label: "Marching dashes" },
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
