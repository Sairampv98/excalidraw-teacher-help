import { describe, expect, it } from "vitest";

import { newArrowElement } from "@excalidraw/element";
import { deconstructLinearOrFreeDrawElement } from "@excalidraw/element/utils";
import { pointFrom } from "@excalidraw/math";

import type { ElementsMap } from "@excalidraw/element/types";

import { flowMarksFor, getArrowPath } from "../scene/flowStyles";
import { drawFlowFrame } from "../scene/flowExport/compose";
import { FLOW_LOOK_DEFAULTS } from "../scene/flowLook";

import { recorder } from "./helpers/recordingContext";

import type { FlowArrowStyle } from "../scene/flowStyles";
import type { FlowFrameScene } from "../scene/flowExport/compose";

const arrow = newArrowElement({
  type: "arrow",
  x: 10,
  y: 20,
  width: 300,
  height: 200,
  roundness: { type: 2 },
  points: [pointFrom(0, 0), pointFrom(150, 200), pointFrom(300, 0)],
  seed: 8,
});
const map = new Map([[arrow.id, arrow]]) as ElementsMap;

describe("AC-581 route marks", () => {
  it("uses the editor curve rather than its control-point polyline", () => {
    const path = getArrowPath(arrow);
    const [, curves] = deconstructLinearOrFreeDrawElement(arrow, map);
    const [a, b, c, d] = curves[0];
    const midpoint = {
      x: (a[0] + 3 * b[0] + 3 * c[0] + d[0]) / 8,
      y: (a[1] + 3 * b[1] + 3 * c[1] + d[1]) / 8,
    };
    expect(path.length).toBeGreaterThan(3);
    expect(
      path.some(
        (point) => Math.hypot(point.x - midpoint.x, point.y - midpoint.y) < 0.5,
      ),
    ).toBe(true);
  });

  it.each<FlowArrowStyle>([
    "beam",
    "token",
    "marching",
    "marching-beam",
    "marching-token",
  ])("live and exported %s positions agree at ten moments", (style) => {
    const step = {
      containerId: "from",
      elementIds: [],
      box: { x: 0, y: 0, width: 100, height: 50 },
    };
    const scene: FlowFrameScene = {
      steps: [step],
      graph: {
        steps: [step],
        edges: [{ from: "from", to: "to" }],
        edgeArrows: [{ from: "from", to: "to", arrowId: arrow.id }],
      },
      elementsMap: map,
      arrowStyle: style,
      nodeStyle: "none",
      look: FLOW_LOOK_DEFAULTS,
      speed: 240,
      durationMs: 1000,
      chartScale: 1,
    };
    for (let moment = 0; moment < 10; moment++) {
      const time = moment * 173;
      const marks = flowMarksFor(style, getArrowPath(arrow), time % 1000, {
        speed: 240,
        scale: 1,
      });
      const { ctx, log } = recorder();
      drawFlowFrame(
        ctx,
        scene,
        time,
        { scale: 1, offsetX: 0, offsetY: 0 },
        null,
        { width: 500, height: 500 },
      );
      expect(
        log
          .filter((entry) => entry[0] === "arc")
          .map((entry) => entry.slice(1, 4)),
      ).toEqual(marks.dots.map((dot) => [dot.x, dot.y, dot.radius]));
      const vertices = log
        .filter((entry) => entry[0] === "moveTo" || entry[0] === "lineTo")
        .map((entry) => entry.slice(1));
      expect(vertices).toEqual(
        marks.strokes.flatMap((stroke) =>
          stroke.points.map((point) => [point.x, point.y]),
        ),
      );
      expect(
        log
          .filter((entry) => entry[0] === "set:lineDashOffset")
          .map((entry) => entry[1]),
      ).toEqual(marks.strokes.map((stroke) => stroke.dashOffset ?? 0));
    }
  });
});
