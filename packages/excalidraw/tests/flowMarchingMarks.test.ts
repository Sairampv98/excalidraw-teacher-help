import { describe, expect, it } from "vitest";

import type { ElementsMap } from "@excalidraw/element/types";

import { arrowsFor, marksForArrow } from "../components/FlowAnimationOverlay";
import { buildFlowPreset } from "../scene/flowPresets";
import { buildFlowGraph } from "../scene/flowOrder";

import {
  flowMarksFor,
  FLOW_BEAM_LENGTH,
  FLOW_TOKEN_RADIUS,
} from "../scene/flowStyles";

const path = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
];

describe("AC-582 marching marks", () => {
  it("runs marching marks on every arrow alongside only the current step's token", () => {
    const built = buildFlowPreset("process", "A\nB\nC", { seed: 3 });
    if (!built.ok) {
      throw new Error(built.error);
    }
    const anchor = built.elements.find(
      (element) => element.customData?.flow.role === "node",
    )!;
    const elements = built.elements.map((element) =>
      element.id === anchor.id
        ? {
            ...element,
            customData: {
              ...element.customData,
              flowPanelAnimation: {
                marchingStyle: "marching-beam",
                spacing: 100,
              },
            },
          }
        : element,
    );
    const map = new Map(
      elements.map((element) => [element.id, element]),
    ) as ElementsMap;
    const graph = buildFlowGraph(elements, map);
    const arrows = arrowsFor("token", graph, graph.steps[0], map);
    expect(arrows).toHaveLength(2);
    expect(arrows[0].styles).toEqual(["token", "marching-beam"]);
    expect(arrows[1].styles).toEqual(["marching-beam"]);
    const marks = marksForArrow(arrows[0], "token", 125, { speed: 240 });
    expect(marks.dots).toHaveLength(1);
    expect(marks.strokes.some((stroke) => stroke.role === "beam")).toBe(true);
    expect(arrows[0].spacing).toBe(100);
  });
  it("pins the old dash phase, width and pattern at each step", () => {
    expect(flowMarksFor("marching", path, 125, { speed: 240 })).toEqual({
      strokes: [
        {
          points: path,
          width: 3,
          role: "dash",
          dash: [10, 10],
          dashOffset: -10,
        },
      ],
      dots: [],
    });
    expect(flowMarksFor("marching", path, 0).strokes[0].dashOffset).toBe(-0);
  });

  it("repeats tokens at fixed spacing and restarts on each step", () => {
    const marks = flowMarksFor("marching-token", path, 125, {
      speed: 240,
      spacing: 100,
    });
    expect(marks.dots).toHaveLength(4);
    marks.dots.forEach((dot, index) =>
      expect(dot.x).toBeCloseTo(30 + index * 100),
    );
    expect(marks.dots.every((dot) => dot.radius === FLOW_TOKEN_RADIUS)).toBe(
      true,
    );
    expect(
      flowMarksFor("marching-token", path, 0, { spacing: 100 }).dots[0].x,
    ).toBe(0);
  });

  it("repeats the stepped beam at the same size, following corners", () => {
    const bent = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 300 },
    ];
    const marks = flowMarksFor("marching-beam", bent, 125, {
      speed: 240,
      spacing: 150,
    });
    expect(marks.strokes).toHaveLength(3);
    expect(
      marks.strokes.every(
        (stroke) => stroke.role === "beam" && stroke.width === 5,
      ),
    ).toBe(true);
    expect(marks.strokes[1].points).toEqual([
      { x: 90, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ]);
    expect(FLOW_BEAM_LENGTH).toBe(90);
  });

  it("invalid spacing cannot hang a large or empty path", () => {
    expect(flowMarksFor("marching-token", [], 100)).toEqual({
      strokes: [],
      dots: [],
    });
    expect(
      flowMarksFor("marching-token", path, 100, { spacing: 0 }).dots.length,
    ).toBeGreaterThan(0);
    expect(
      flowMarksFor("marching-token", path, 100, { spacing: NaN }).dots.length,
    ).toBeLessThan(100);
  });

  it("pins the default spacing (150) and the least (16) for beams and tokens", () => {
    // a 400-long arrow: marks every 150 are three; the default is 150
    expect(flowMarksFor("marching-token", path, 0).dots).toHaveLength(3);
    expect(
      flowMarksFor("marching-token", path, 0, { spacing: 200 }).dots,
    ).toHaveLength(2);
    // nothing closer than 16: a request for 1 is drawn as 16
    expect(
      flowMarksFor("marching-token", path, 0, { spacing: 1 }).dots,
    ).toHaveLength(
      flowMarksFor("marching-token", path, 0, { spacing: 16 }).dots.length,
    );
    expect(
      flowMarksFor("marching-beam", path, 0, { spacing: 1 }).strokes,
    ).toHaveLength(25);
  });

  it("the gap between marching dashes is a setting and its default is the old one", () => {
    const dashOf = (options?: { dashGap?: number; scale?: number }) =>
      flowMarksFor("marching", path, 0, options).strokes[0].dash;
    expect(dashOf()).toEqual([10, 10]);
    expect(dashOf({ dashGap: 30 })).toEqual([10, 30]);
    expect(dashOf({ dashGap: 0 })).toEqual([10, 2]);
    expect(dashOf({ dashGap: 30, scale: 2 })).toEqual([20, 60]);
    // the dashes still run: a bigger gap is a longer period
    const at = (gap: number, ms: number) =>
      flowMarksFor("marching", path, ms, { dashGap: gap, speed: 240 })
        .strokes[0].dashOffset ?? 0;
    expect(at(30, 0)).toBeCloseTo(0);
    expect(at(30, 300)).not.toBeCloseTo(at(10, 300));
  });
});
