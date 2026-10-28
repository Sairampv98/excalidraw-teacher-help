/**
 * The small picture of a kind of chart (D-239).
 *
 * The picture is not drawn by hand: it is the chart that the builder makes from
 * the kind's example, taken as plain shapes and lines and scaled into a small
 * box - the shapes in their fills and their shapes, the arrows, connectors and
 * lines, and no words. So it is always what the kind draws.
 *
 * Everything here is pure.
 */

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { buildFlowPreset } from "./flowPresets";

import type { BuildFlowOptions } from "./flowPresets";
import type { FlowPresetId } from "./flowScript";

export type FlowPreviewItem =
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
      fill: string;
      stroke: string;
      opacity: number;
    }
  | {
      kind: "ellipse";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      fill: string;
      stroke: string;
      opacity: number;
    }
  | {
      kind: "diamond";
      points: string;
      fill: string;
      stroke: string;
      opacity: number;
    }
  | {
      kind: "line";
      points: string;
      stroke: string;
      /** the arrowhead, when the line has one */
      head?: string;
    };

export type FlowPreview = {
  width: number;
  height: number;
  items: FlowPreviewItem[];
};

/** the size a picture is drawn in, in its own units */
export const FLOW_PREVIEW_SIZE = { width: 96, height: 60 } as const;

const PAD = 5;

const n = (value: number) => Math.round(value * 100) / 100;

/**
 * The picture of some elements: their shapes and lines, scaled to fit the box
 * with a margin, and centred in it. Words are left out.
 */
export const flowPreviewOf = (
  elements: readonly ExcalidrawElement[],
  size: { width: number; height: number } = FLOW_PREVIEW_SIZE,
): FlowPreview => {
  const drawn = elements.filter(
    (element) => !element.isDeleted && element.type !== "text",
  );

  if (drawn.length === 0) {
    return { ...size, items: [] };
  }

  // the points of every line, in the scene
  const pointsOf = (element: ExcalidrawElement) =>
    element.type === "arrow" || element.type === "line"
      ? element.points.map(([px, py]) => ({
          x: element.x + px,
          y: element.y + py,
        }))
      : [];

  const xs: number[] = [];
  const ys: number[] = [];

  for (const element of drawn) {
    if (element.type === "arrow" || element.type === "line") {
      for (const p of pointsOf(element)) {
        xs.push(p.x);
        ys.push(p.y);
      }
    } else {
      xs.push(element.x, element.x + element.width);
      ys.push(element.y, element.y + element.height);
    }
  }

  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(Math.max(...xs) - left, 1);
  const height = Math.max(Math.max(...ys) - top, 1);
  const scale = Math.min(
    (size.width - PAD * 2) / width,
    (size.height - PAD * 2) / height,
  );
  const dx = (size.width - width * scale) / 2 - left * scale;
  const dy = (size.height - height * scale) / 2 - top * scale;

  const X = (x: number) => n(x * scale + dx);
  const Y = (y: number) => n(y * scale + dy);
  const items: FlowPreviewItem[] = [];

  for (const element of drawn) {
    const fill =
      element.backgroundColor && element.backgroundColor !== "transparent"
        ? element.backgroundColor
        : "none";
    const opacity = element.opacity / 100;

    if (element.type === "rectangle") {
      items.push({
        kind: "rect",
        x: X(element.x),
        y: Y(element.y),
        width: n(element.width * scale),
        height: n(element.height * scale),
        radius: element.roundness
          ? n(Math.min(element.width, element.height) * 0.2 * scale)
          : 0,
        fill,
        stroke: element.strokeColor,
        opacity,
      });
    } else if (element.type === "ellipse") {
      items.push({
        kind: "ellipse",
        cx: X(element.x + element.width / 2),
        cy: Y(element.y + element.height / 2),
        rx: n((element.width / 2) * scale),
        ry: n((element.height / 2) * scale),
        fill,
        stroke: element.strokeColor,
        opacity,
      });
    } else if (element.type === "diamond") {
      const { x, y, width: w, height: h } = element;

      items.push({
        kind: "diamond",
        points: [
          [x + w / 2, y],
          [x + w, y + h / 2],
          [x + w / 2, y + h],
          [x, y + h / 2],
        ]
          .map(([px, py]) => `${X(px)},${Y(py)}`)
          .join(" "),
        fill,
        stroke: element.strokeColor,
        opacity,
      });
    } else if (element.type === "arrow" || element.type === "line") {
      const points = pointsOf(element);

      if (points.length < 2) {
        continue;
      }

      const item: FlowPreviewItem = {
        kind: "line",
        points: points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" "),
        stroke: element.strokeColor,
      };

      // an arrowhead: a small triangle on the last segment
      if (element.type === "arrow" && element.endArrowhead) {
        const a = points[points.length - 2];
        const b = points[points.length - 1];
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const length = 5;
        const wing = (turn: number) => ({
          x: X(b.x) - Math.cos(angle + turn) * length,
          y: Y(b.y) - Math.sin(angle + turn) * length,
        });
        const p1 = wing(0.45);
        const p2 = wing(-0.45);

        item.head = `${n(p1.x)},${n(p1.y)} ${X(b.x)},${Y(b.y)} ${n(p2.x)},${n(
          p2.y,
        )}`;
      }

      items.push(item);
    }
  }

  return { ...size, items };
};

const kept = new Map<string, FlowPreview | null>();

/**
 * The picture of a kind from its example (D-239). \`options\` are the ones a
 * custom preset's charts are built with - its colours, its shape, its arrows -
 * so its picture is in them. A kind that cannot be built has no picture.
 */
export const flowKindPreview = (
  preset: FlowPresetId,
  example: string,
  options: Pick<
    BuildFlowOptions,
    "palette" | "shape" | "arrows" | "direction"
  > = {},
): FlowPreview | null => {
  const key = JSON.stringify([preset, example, options]);

  if (kept.has(key)) {
    return kept.get(key)!;
  }

  const built = buildFlowPreset(preset, example, {
    seed: 1,
    fit: "larger",
    ...options,
  });
  const preview = built.ok ? flowPreviewOf(built.elements) : null;

  kept.set(key, preview);

  return preview;
};
