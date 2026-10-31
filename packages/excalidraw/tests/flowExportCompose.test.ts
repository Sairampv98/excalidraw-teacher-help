/**
 * Exporting an animation: the picture of one moment (D-374). What is drawn is
 * read from a recording of the 2D context, so the test says what was drawn, in
 * which order and with what - and the same moment must always be the same
 * picture.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it } from "vitest";

import {
  drawFlowFrame,
  highlightIn,
  pulseGlow,
} from "../scene/flowExport/compose";
import { chartToExport } from "../scene/flowExport/chart";
import { FLOW_LOOK_DEFAULTS } from "../scene/flowLook";
import { flowMarksFor } from "../scene/flowStyles";

import { API } from "./helpers/api";

import type { FlowFrameScene } from "../scene/flowExport/compose";
import type { FlowGraph, FlowStep } from "../scene/flowOrder";

/** a 2D context that remembers every call and every property it was given */
const recorder = () => {
  const log: unknown[][] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (typeof name !== "string") {
          return undefined;
        }

        return name in state
          ? state[name]
          : (...args: unknown[]) => {
              log.push([name, ...args]);
            };
      },
      set: (_target, name, value) => {
        log.push([`set:${String(name)}`, value]);
        state[String(name)] = value;

        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;

  return { ctx, log };
};

const rect = (id: string, x: number, y: number, extra: object = {}) => ({
  id,
  type: "rectangle",
  x,
  y,
  width: 100,
  height: 50,
  angle: 0,
  isDeleted: false,
  roundness: null,
  customData: {},
  ...extra,
});

const arrow = {
  id: "a1",
  type: "arrow",
  x: 100,
  y: 25,
  width: 200,
  height: 0,
  angle: 0,
  isDeleted: false,
  points: [
    [0, 0],
    [200, 0],
  ],
  customData: {},
};

const steps: FlowStep[] = [
  {
    containerId: "n1",
    elementIds: ["n1"],
    box: { x: 0, y: 0, width: 100, height: 50 },
  },
  {
    containerId: "n2",
    elementIds: ["n2"],
    box: { x: 300, y: 0, width: 100, height: 50 },
  },
];

const graph: FlowGraph = {
  steps,
  edges: [{ from: "n1", to: "n2" }],
  edgeArrows: [{ from: "n1", to: "n2", arrowId: "a1" }],
};

const elementsMap = new Map<string, unknown>([
  ["n1", rect("n1", 0, 0)],
  ["n2", rect("n2", 300, 0)],
  ["a1", arrow],
]) as never;

const scene = (patch: Partial<FlowFrameScene> = {}): FlowFrameScene => ({
  steps,
  graph,
  elementsMap,
  arrowStyle: "marching",
  nodeStyle: "focus",
  look: FLOW_LOOK_DEFAULTS,
  speed: 60,
  durationMs: 1000,
  chartScale: 1,
  ...patch,
});

const transform = { scale: 2, offsetX: 10, offsetY: 20 };
const size = { width: 800, height: 200 };
const baseImage = { name: "the chart" } as unknown as CanvasImageSource;

const names = (log: unknown[][]) => log.map((entry) => entry[0]);

describe("the picture of one moment", () => {
  it("AC-437 the chart's own picture comes first, then what is drawn in scene units", () => {
    const { ctx, log } = recorder();

    drawFlowFrame(ctx, scene(), 0, transform, baseImage, size);

    // the picture is cleared, the chart laid down whole, and only then the marks
    expect(log[0]).toEqual(["setTransform", 1, 0, 0, 1, 0, 0]);
    expect(log[1]).toEqual(["clearRect", 0, 0, 800, 200]);
    expect(log[2]).toEqual(["drawImage", baseImage, 0, 0, 800, 200]);
    expect(log[3]).toEqual(["setTransform", 2, 0, 0, 2, 10, 20]);

    // and it is left as it was found
    expect(log[log.length - 1]).toEqual(["setTransform", 1, 0, 0, 1, 0, 0]);

    // with no chart picture (a transparent background) nothing is laid down
    const bare = recorder();

    drawFlowFrame(bare.ctx, scene(), 0, transform, null, size);

    expect(names(bare.log)).not.toContain("drawImage");
    expect(names(bare.log)).toContain("clearRect");
  });

  it("AC-437 the same moment is the same picture, and another moment is another", () => {
    const first = recorder();
    const second = recorder();
    const later = recorder();

    drawFlowFrame(first.ctx, scene(), 250, transform, baseImage, size);
    drawFlowFrame(second.ctx, scene(), 250, transform, baseImage, size);
    drawFlowFrame(later.ctx, scene(), 400, transform, baseImage, size);

    expect(second.log).toEqual(first.log);
    expect(later.log).not.toEqual(first.log);
  });

  it("AC-437 marching dashes are the animation's own marks, and they move with the time", () => {
    const dashOffsetAt = (timeMs: number) => {
      const { ctx, log } = recorder();

      drawFlowFrame(ctx, scene(), timeMs, transform, null, size);

      return {
        dash: log.find((entry) => entry[0] === "setLineDash")?.[1],
        offset: log.find((entry) => entry[0] === "set:lineDashOffset")?.[1],
        width: log.find((entry) => entry[0] === "set:lineWidth")?.[1],
      };
    };

    const path = [
      { x: 100, y: 25 },
      { x: 300, y: 25 },
    ];

    for (const t of [0, 250, 600]) {
      const marks = flowMarksFor("marching", path, t, { scale: 1, speed: 60 });
      const drawn = dashOffsetAt(t);

      // what the overlay would have drawn at that moment, to the number
      expect(drawn.dash).toEqual([...marks.strokes[0].dash!]);
      expect(drawn.offset).toBe(marks.strokes[0].dashOffset);
      expect(drawn.width).toBe(marks.strokes[0].width);
    }

    expect(dashOffsetAt(250).offset).not.toBe(dashOffsetAt(0).offset);
  });

  it("AC-437 the marks restart with each step, and the step is the one the clock is at", () => {
    // 1000 ms a step: at 1250 the second step has been current for 250
    const at = (timeMs: number) => {
      const { ctx, log } = recorder();
      const result = drawFlowFrame(ctx, scene(), timeMs, transform, null, size);

      return {
        step: result.stepIndex,
        offset: log.find((entry) => entry[0] === "set:lineDashOffset")?.[1],
        translations: log.filter((entry) => entry[0] === "translate"),
      };
    };

    expect(at(250).step).toBe(0);
    expect(at(1250).step).toBe(1);
    expect(at(1250).offset).toBe(at(250).offset);

    // the highlight is on the node of the step: its centre, rotated about it
    expect(at(250).translations).toContainEqual(["translate", 50, 25]);
    expect(at(1250).translations).toContainEqual(["translate", 350, 25]);

    // and the steps loop
    expect(at(2250).step).toBe(0);
  });

  it("AC-437 the colour of the marks is the look's, and the accent when there is none", () => {
    const colorOfStroke = (markColor: string | null) => {
      const { ctx, log } = recorder();

      drawFlowFrame(
        ctx,
        scene({ look: { ...FLOW_LOOK_DEFAULTS, markColor } }),
        100,
        transform,
        null,
        size,
      );

      const at = log.findIndex((entry) => entry[0] === "stroke");

      // the colour set most recently before the first stroke
      return log
        .slice(0, at)
        .reverse()
        .find((entry) => entry[0] === "set:strokeStyle")?.[1];
    };

    expect(colorOfStroke(null)).toBe("#6965db");
    expect(colorOfStroke("#e8590c")).toBe("#e8590c");
  });

  it("AC-437 an arrow style that draws a dot draws it, and none draws no mark at all", () => {
    const token = recorder();

    drawFlowFrame(
      token.ctx,
      scene({ arrowStyle: "token" }),
      500,
      transform,
      null,
      size,
    );

    const arc = token.log.find((entry) => entry[0] === "arc");

    expect(arc).toBeTruthy();
    // 500 ms at 60 units a second along an arrow that starts at x = 100
    expect(arc![1]).toBeCloseTo(130, 6);
    expect(arc![2]).toBe(25);

    const none = recorder();

    drawFlowFrame(
      none.ctx,
      scene({ arrowStyle: "none" }),
      500,
      transform,
      null,
      size,
    );

    expect(names(none.log)).not.toContain("setLineDash");
    expect(names(none.log)).not.toContain("arc");
  });

  it("AC-437 the highlight is drawn for focus and for pulse, and not for none", () => {
    const highlight = (nodeStyle: "none" | "focus" | "pulse") => {
      const { ctx, log } = recorder();

      drawFlowFrame(
        ctx,
        scene({ nodeStyle, arrowStyle: "none" }),
        300,
        transform,
        null,
        size,
      );

      return log;
    };

    expect(names(highlight("none"))).not.toContain("fill");
    expect(names(highlight("focus"))).toContain("fill");
    expect(names(highlight("pulse"))).toContain("fill");

    // a pulse glows; a focus grows the box by its margin instead
    expect(
      highlight("pulse").some((entry) => entry[0] === "set:shadowBlur"),
    ).toBe(true);
    expect(
      highlight("focus").some((entry) => entry[0] === "set:shadowBlur"),
    ).toBe(false);

    const line = (log: unknown[][]) =>
      log.find((entry) => entry[0] === "moveTo")!;

    // the focus outline starts further out than the pulse's
    expect(
      (line(highlight("focus"))[1] as number) <
        (line(highlight("pulse"))[1] as number),
    ).toBe(true);
  });

  it("AC-437 a highlight comes in over 400 ms and a pulse breathes once in 1.2 s", () => {
    expect(highlightIn(0)).toBe(0);
    expect(highlightIn(400)).toBe(1);
    expect(highlightIn(900)).toBe(1);
    expect(highlightIn(200)).toBeGreaterThan(0.5);
    expect(highlightIn(200)).toBeLessThan(1);

    expect(pulseGlow(0)).toBeCloseTo(0, 6);
    expect(pulseGlow(600)).toBeCloseTo(1, 6);
    expect(pulseGlow(1200)).toBeCloseTo(0, 6);
  });
});

describe("what of the page is exported", () => {
  // real elements, made as the library makes them: the bounds read their shape
  const element = (id: string, extra: Record<string, unknown> = {}) => {
    const { customData, containerId, points, type, ...rest } = extra;
    const made = API.createElement({
      id,
      type: (type ?? "rectangle") as "rectangle",
      width: 10,
      height: 10,
      ...(rest as object),
      ...(type === "text" ? { text: "label", containerId } : {}),
      ...(type === "arrow"
        ? {
            points: points ?? [
              [0, 0],
              [10, 10],
            ],
          }
        : {}),
    } as never);

    return Object.assign(made, customData ? { customData } : {}) as never;
  };

  it("AC-437 the chart is its steps, its arrows, the labels of its arrows and its own elements, and nothing next to it", () => {
    const elements = [
      element("n1", { x: 0, y: 0, customData: { flow: { chartId: "c1" } } }),
      element("n2", { x: 200, y: 100 }),
      element("a1", {
        type: "arrow",
        x: 10,
        y: 5,
        width: 190,
        height: 95,
        points: [
          [0, 0],
          [190, 95],
        ],
      }),
      element("label", { type: "text", containerId: "a1", x: 100, y: 50 }),
      // made with the chart, though no step and no arrow
      element("stem", {
        x: 100,
        y: 0,
        customData: { flow: { chartId: "c1" } },
      }),
      // elsewhere on the page
      element("other", { x: 5000, y: 5000 }),
      element("gone", { x: 0, y: 0, isDeleted: true }),
    ];

    const chart = chartToExport(
      {
        steps: [
          {
            containerId: "n1",
            elementIds: ["n1"],
            box: { x: 0, y: 0, width: 10, height: 10 },
          },
          {
            containerId: "n2",
            elementIds: ["n2"],
            box: { x: 200, y: 100, width: 10, height: 10 },
          },
        ],
        edges: [{ from: "n1", to: "n2" }],
        edgeArrows: [{ from: "n1", to: "n2", arrowId: "a1" }],
      },
      [
        {
          containerId: "n1",
          elementIds: ["n1"],
          box: { x: 0, y: 0, width: 10, height: 10 },
        },
        {
          containerId: "n2",
          elementIds: ["n2"],
          box: { x: 200, y: 100, width: 10, height: 10 },
        },
      ],
      elements,
    )!;

    expect(chart.elements.map((e) => e.id).sort()).toEqual(
      ["a1", "label", "n1", "n2", "stem"].sort(),
    );

    // the box holds the chart and not the element far away
    expect(chart.box).toEqual({ x: 0, y: 0, width: 210, height: 110 });
  });

  it("AC-437 a flow with nothing of it on the page gives no chart", () => {
    expect(
      chartToExport(
        { steps: [], edges: [], edgeArrows: [] },
        [
          {
            containerId: "x",
            elementIds: ["x"],
            box: { x: 0, y: 0, width: 1, height: 1 },
          },
        ],
        [],
      ),
    ).toBeNull();
  });
});
