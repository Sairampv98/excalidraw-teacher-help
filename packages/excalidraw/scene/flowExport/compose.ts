/**
 * One picture of an exported animation (D-374): the chart as the canvas draws it,
 * and over it what the animation draws at that moment - the marks that run along
 * the arrows, and the highlight of the step that is current.
 *
 * The picture is made **from the time**, not from the screen: the same moment is
 * always the same picture, on any machine, with or without a background. The
 * rules are the overlay's own - the same functions give the marks and the steps -
 * so what is exported is what the animation does. It draws on any 2D context,
 * so a test can read what was drawn.
 */

import type { ElementsMap } from "@excalidraw/element/types";

import { arrowsFor } from "../../components/FlowAnimationOverlay";
import { FLOW_FOCUS_MARGIN, flowFocusScale } from "../flowAnimation";
import {
  highlightBoxOf,
  highlightShapeOf,
  stepHoldsMedia,
} from "../flowHighlight";
import {
  FLOW_ACCENT_HEX,
  neonCore,
  pipeColorsFor,
  isFlowColor,
} from "../flowLook";
import { flowMarksFor } from "../flowStyles";

import { stepAt } from "./plan";

import type { FlowLook } from "../flowLook";
import type { FlowGraph, FlowStep } from "../flowOrder";
import type { FlowArrowStyle, FlowNodeStyle, FlowStroke } from "../flowStyles";

/** what a frame is drawn from: the animation as it was set when the export began */
export type FlowFrameScene = {
  steps: readonly FlowStep[];
  graph: FlowGraph | null;
  elementsMap: ElementsMap;
  arrowStyle: FlowArrowStyle;
  nodeStyle: FlowNodeStyle;
  look: FlowLook;
  /** the marks' speed, in scene units a second */
  speed: number;
  /** how long a step is held, in ms */
  durationMs: number;
  /** the chart scale the marks are drawn at */
  chartScale: number;
};

/** scene units to pixels: `x * scale + offsetX` */
export type FlowFrameTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

/** how long a highlight takes to appear, as in the overlay's stylesheet */
export const FLOW_HIGHLIGHT_IN_MS = 400;

/** the length of one breath of a pulsing highlight, as in the stylesheet */
export const FLOW_PULSE_MS = 1200;

/** the stroke of a node's outline, as the overlay draws it */
const OUTLINE_STROKE = 2;

/** what a shadow of `px` looks like once the picture is `scale` times the scene */
const blurOf = (px: number, scale: number) => px * Math.max(0.5, scale);

const colorOr = (value: string | null | undefined, fallback: string) =>
  value && isFlowColor(value) ? value : fallback;

/** an outline of a node's shape in the box, inset by half the stroke */
const traceShape = (
  ctx: CanvasRenderingContext2D,
  shape: { kind: "rect" | "ellipse" | "diamond"; radius: number },
  box: { x: number; y: number; width: number; height: number },
) => {
  const inset = OUTLINE_STROKE / 2;
  const x = box.x + inset;
  const y = box.y + inset;
  const w = Math.max(box.width - OUTLINE_STROKE, 0);
  const h = Math.max(box.height - OUTLINE_STROKE, 0);

  ctx.beginPath();

  if (shape.kind === "ellipse") {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (shape.kind === "diamond") {
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w, y + h / 2);
    ctx.lineTo(x + w / 2, y + h);
    ctx.lineTo(x, y + h / 2);
    ctx.closePath();
  } else {
    const r = Math.min(Math.max(shape.radius - inset, 0), w / 2, h / 2);

    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
};

/** the colour and the look of one stroke, as the overlay's stylesheet gives it */
const strokeLook = (
  stroke: FlowStroke,
  look: FlowLook,
): { color: string; alpha: number; glow: number } => {
  const mark = colorOr(look.markColor, FLOW_ACCENT_HEX);
  const pipe = look.markColor ? pipeColorsFor(look.markColor) : null;

  switch (stroke.role) {
    case "base":
      return { color: mark, alpha: 0.3, glow: 0 };
    case "beam":
      return { color: mark, alpha: 1, glow: 6 };
    case "dash":
      return { color: mark, alpha: 1, glow: 0 };
    case "pipe-dark":
      return { color: pipe?.dark ?? "#1e1e1e", alpha: 1, glow: 0 };
    case "pipe-light":
      return { color: pipe?.body ?? "#868e96", alpha: 1, glow: 0 };
    case "pipe-flow":
      return { color: pipe?.flow ?? "#ffffff", alpha: 1, glow: 0 };
    default:
      return { color: mark, alpha: 1, glow: 0 };
  }
};

const drawStroke = (
  ctx: CanvasRenderingContext2D,
  stroke: FlowStroke,
  look: FlowLook,
  scale: number,
) => {
  const { color, alpha, glow } = strokeLook(stroke, look);
  // a neon tube: the colour glows, and the bright core is drawn in the middle
  const neon =
    look.glowMark &&
    stroke.role !== "pipe-dark" &&
    stroke.role !== "pipe-light";

  ctx.save();
  ctx.beginPath();

  stroke.points.forEach((point, i) => {
    if (i === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });

  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(stroke.dash ? [stroke.dash[0], stroke.dash[1]] : []);
  ctx.lineDashOffset = stroke.dashOffset ?? 0;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = neon ? neonCore(color) : color;

  if (neon) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blurOf(14, scale);
  } else if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blurOf(glow, scale);
  }

  ctx.stroke();
  ctx.restore();
};

/** how far a highlight has come in: 0 to 1, easing out, as the stylesheet's 400 ms */
export const highlightIn = (sinceStepMs: number): number => {
  const t = Math.min(1, Math.max(0, sinceStepMs / FLOW_HIGHLIGHT_IN_MS));

  return 1 - (1 - t) * (1 - t);
};

/** the glow of a pulse, 0 to 1 and back, once in `FLOW_PULSE_MS` */
export const pulseGlow = (sinceStepMs: number): number =>
  0.5 - 0.5 * Math.cos((2 * Math.PI * sinceStepMs) / FLOW_PULSE_MS);

const drawHighlight = (
  ctx: CanvasRenderingContext2D,
  scene: FlowFrameScene,
  step: FlowStep,
  sinceStepMs: number,
  scale: number,
) => {
  if (scene.nodeStyle === "none") {
    return;
  }

  const container = scene.elementsMap.get(step.containerId);
  const box = container ? highlightBoxOf(container) : step.box;
  const shape = container
    ? highlightShapeOf(container)
    : { kind: "rect" as const, radius: 0, angle: 0 };
  const color = colorOr(scene.look.nodeColor, FLOW_ACCENT_HEX);
  const media = stepHoldsMedia(step, scene.elementsMap);
  const came = highlightIn(sinceStepMs);

  ctx.save();

  // the highlight comes in from below, as the overlay's does
  ctx.translate(0, 12 * (1 - came));
  ctx.globalAlpha = came;

  // rotated about the centre, as the node is
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  ctx.translate(cx, cy);
  ctx.rotate(shape.angle);

  // the focus is a margin round the box; a pulse leaves the size alone
  let drawBox = {
    x: -box.width / 2,
    y: -box.height / 2,
    width: box.width,
    height: box.height,
  };

  if (scene.nodeStyle === "focus") {
    const grown = flowFocusScale(drawBox, FLOW_FOCUS_MARGIN);

    drawBox = {
      x: drawBox.x * grown.x,
      y: drawBox.y * grown.y,
      width: drawBox.width * grown.x,
      height: drawBox.height * grown.y,
    };
  }

  traceShape(ctx, shape, drawBox);

  ctx.globalAlpha = came * (media ? 0 : 0.18);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.globalAlpha = came;
  ctx.lineWidth = OUTLINE_STROKE;
  ctx.strokeStyle = scene.look.glowShape ? neonCore(color) : color;

  if (scene.look.glowShape) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blurOf(14, scale);
  } else if (scene.nodeStyle === "pulse") {
    ctx.shadowColor = color;
    ctx.shadowBlur = blurOf(8 * pulseGlow(sinceStepMs), scale);
  }

  ctx.stroke();
  ctx.restore();
};

/**
 * Draws the picture of the animation at `timeMs` on `ctx`: the chart's own
 * picture first (when there is one), then the marks along the arrows, then the
 * highlight of the current step. `size` is the picture's, in pixels.
 */
export const drawFlowFrame = (
  ctx: CanvasRenderingContext2D,
  scene: FlowFrameScene,
  timeMs: number,
  transform: FlowFrameTransform,
  base: CanvasImageSource | null,
  size: { width: number; height: number },
): { stepIndex: number } => {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);

  if (base) {
    ctx.drawImage(base, 0, 0, size.width, size.height);
  }

  const { stepIndex, sinceStepMs } = stepAt(
    timeMs,
    scene.steps.length,
    scene.durationMs,
  );
  const step = scene.steps[stepIndex];

  if (!step) {
    return { stepIndex };
  }

  // from here on, scene units
  ctx.setTransform(
    transform.scale,
    0,
    0,
    transform.scale,
    transform.offsetX,
    transform.offsetY,
  );

  const arrows = arrowsFor(
    scene.arrowStyle,
    scene.graph,
    step,
    scene.elementsMap,
  );

  for (const arrow of arrows) {
    const marks = flowMarksFor(scene.arrowStyle, arrow.path, sinceStepMs, {
      scale: scene.chartScale,
      speed: scene.speed,
    });

    for (const stroke of marks.strokes) {
      drawStroke(ctx, stroke, scene.look, transform.scale);
    }

    for (const dot of marks.dots) {
      const color = colorOr(scene.look.markColor, FLOW_ACCENT_HEX);

      ctx.save();
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
      ctx.fillStyle = scene.look.glowMark ? neonCore(color) : color;
      ctx.shadowColor = color;
      ctx.shadowBlur = blurOf(scene.look.glowMark ? 14 : 5, transform.scale);
      ctx.fill();
      ctx.restore();
    }
  }

  drawHighlight(ctx, scene, step, sinceStepMs, transform.scale);

  ctx.setTransform(1, 0, 0, 1, 0, 0);

  return { stepIndex };
};
