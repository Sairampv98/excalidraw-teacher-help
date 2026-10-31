/**
 * Exporting an animation: the look of the animation is in the file (D-383) - the
 * arrows the look hides or colours, the arrows as neon tubes, and the highlight
 * of the text: the rectangle on the label's box and the label's letters.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { pointFrom } from "@excalidraw/math";

import { getDefaultAppState } from "../appState";
import { drawFlowFrame } from "../scene/flowExport/compose";
import { createFrameSource } from "../scene/flowExport/browser";
import { sceneRectOf } from "../scene/flowExport/camera";
import { exportFlowAnimation } from "../scene/flowExport/exportAnimation";
import { FLOW_LOOK_DEFAULTS, neonCore } from "../scene/flowLook";

import { API } from "./helpers/api";
import { recorder } from "./helpers/recordingContext";

import type { FlowFrameScene } from "../scene/flowExport/compose";
import type { FlowGraph, FlowStep } from "../scene/flowOrder";

const captured: {
  elements: readonly { id: string; strokeColor: string }[];
  options?: {
    pageRect?: { x: number; y: number; width: number; height: number };
  };
  scale?: number;
}[] = [];

vi.mock("../scene/export", () => ({
  exportToCanvas: vi.fn(
    async (
      elements: never,
      _appState: never,
      _files: never,
      options: never,
      createCanvas?: (
        w: number,
        h: number,
      ) => { canvas: HTMLCanvasElement; scale: number },
    ) => {
      const made = createCanvas?.(0, 0);

      captured.push({ elements, options, scale: made?.scale });

      return made?.canvas ?? document.createElement("canvas");
    },
  ),
}));

vi.mock("../scene/flowExport/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scene/flowExport/runner")>()),
  runFlowExport: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));

vi.mock("../scene/flowExport/browser", () => ({
  createFrameSource: vi.fn(() => ({
    size: { width: 4, height: 4 },
    canvasAt: vi.fn(),
    rgba: vi.fn(),
    webp: vi.fn(),
  })),
  createVideoEncoder: vi.fn(() => null),
}));

const rect = (id: string, x: number) => ({
  id,
  type: "rectangle",
  x,
  y: 0,
  width: 100,
  height: 50,
  angle: 0,
  isDeleted: false,
  roundness: null,
  customData: {},
});

const label = {
  id: "t1",
  type: "text",
  x: 10,
  y: 15,
  width: 80,
  height: 20,
  angle: 0,
  isDeleted: false,
  text: "Plan",
  fontSize: 16,
  lineHeight: 1.25,
  fontFamily: 1,
  textAlign: "center",
  containerId: "n1",
  customData: {},
};

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
    elementIds: ["n1", "t1"],
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
  ["n1", rect("n1", 0)],
  ["n2", rect("n2", 300)],
  ["t1", label],
  ["a1", arrow],
]) as never;

const scene = (
  patch: Partial<FlowFrameScene["look"]> & {
    nodeStyle?: FlowFrameScene["nodeStyle"];
    arrowStyle?: FlowFrameScene["arrowStyle"];
  },
): FlowFrameScene => {
  const { nodeStyle, arrowStyle, ...look } = patch;

  return {
    steps,
    graph,
    elementsMap,
    arrowStyle: arrowStyle ?? "none",
    nodeStyle: nodeStyle ?? "pulse",
    look: { ...FLOW_LOOK_DEFAULTS, ...look },
    speed: 60,
    durationMs: 1000,
    chartScale: 1,
  };
};

const draw = (frame: FlowFrameScene, timeMs = 600) => {
  const { ctx, log } = recorder();

  drawFlowFrame(
    ctx,
    frame,
    timeMs,
    { scale: 1, offsetX: 0, offsetY: 0 },
    null,
    {
      width: 800,
      height: 200,
    },
  );

  return log;
};

const names = (log: unknown[][]) => log.map((entry) => entry[0]);

describe("the highlight of the text", () => {
  it("AC-446 the target of the highlight decides what is lit: the shape, the label's box, the letters, or two of them", () => {
    const lit = (nodeTarget: FlowFrameScene["look"]["nodeTarget"]) => {
      const log = draw(scene({ nodeTarget }));

      return {
        // a rectangle is traced with arcs, and its wash is a fill
        outlines: log.filter((entry) => entry[0] === "stroke").length,
        letters: log.filter((entry) => entry[0] === "fillText"),
      };
    };

    expect(lit("shape")).toMatchObject({ outlines: 1, letters: [] });
    expect(lit("shape-box")).toMatchObject({ outlines: 2, letters: [] });
    expect(lit("box")).toMatchObject({ outlines: 1, letters: [] });
    expect(lit("letters").outlines).toBe(0);
    expect(lit("letters").letters).toHaveLength(1);
    expect(lit("shape-text").outlines).toBe(1);
    expect(lit("shape-text").letters).toHaveLength(1);

    // a step with no label has no text: every choice that names a text takes the shape
    const bare = recorder();

    drawFlowFrame(
      bare.ctx,
      scene({ nodeTarget: "letters" }),
      1600,
      { scale: 1, offsetX: 0, offsetY: 0 },
      null,
      { width: 800, height: 200 },
    );

    expect(names(bare.log)).not.toContain("fillText");
    expect(names(bare.log)).toContain("stroke");
  });

  it("AC-446 the letters are the label's own: its words, its font, its size, centred in its own box, in the text's colour", () => {
    const log = draw(
      scene({
        nodeTarget: "letters",
        textColor: "#e8590c",
        nodeColor: "#2f9e44",
      }),
    );

    const text = log.find((entry) => entry[0] === "fillText")!;

    // the words, and the middle of the label's own box
    expect(text[1]).toBe("Plan");
    expect(text[2]).toBe(40);
    expect(text[3]).toBeGreaterThan(0);

    const fonts = log
      .filter((entry) => entry[0] === "set:font")
      .map((entry) => entry[1]);

    expect(String(fonts[0])).toMatch(/^16px /);
    expect(log.find((entry) => entry[0] === "set:textAlign")![1]).toBe(
      "center",
    );

    // the colour is the text's own, and the shape's when there is none
    const colorBeforeText = (look: Partial<FlowFrameScene["look"]>) => {
      const l = draw(scene({ nodeTarget: "letters", ...look }));
      const at = l.findIndex((entry) => entry[0] === "fillText");

      return l
        .slice(0, at)
        .reverse()
        .find((entry) => entry[0] === "set:fillStyle")![1];
    };

    expect(
      colorBeforeText({ textColor: "#e8590c", nodeColor: "#2f9e44" }),
    ).toBe("#e8590c");
    expect(colorBeforeText({ textColor: null, nodeColor: "#2f9e44" })).toBe(
      "#2f9e44",
    );
    expect(colorBeforeText({ textColor: null, nodeColor: null })).toBe(
      "#6965db",
    );
  });

  it("AC-446 a neon text has the bright core of its colour and a glow, and a plain one has neither", () => {
    const fillAndShadow = (glowText: boolean) => {
      const log = draw(
        scene({ nodeTarget: "letters", textColor: "#e8590c", glowText }),
      );
      const at = log.findIndex((entry) => entry[0] === "fillText");
      const before = log.slice(0, at);

      return {
        fill: before
          .reverse()
          .find((entry) => entry[0] === "set:fillStyle")![1],
        glow: before.some((entry) => entry[0] === "set:shadowBlur"),
      };
    };

    expect(fillAndShadow(false)).toEqual({ fill: "#e8590c", glow: false });
    expect(fillAndShadow(true)).toEqual({
      fill: neonCore("#e8590c"),
      glow: true,
    });
  });

  it("AC-446 a focus makes the lit letters a margin larger and a pulse leaves their size", () => {
    const scaleOf = (nodeStyle: "focus" | "pulse") =>
      draw(scene({ nodeTarget: "letters", nodeStyle })).find(
        (entry) => entry[0] === "scale",
      );

    const focus = scaleOf("focus")!;

    expect(focus[1]).toBeCloseTo(1 + 10 / 80, 6);
    expect(focus[2]).toBeCloseTo(1 + 10 / 20, 6);
    expect(scaleOf("pulse")).toEqual(["scale", 1, 1]);
  });
});

describe("the arrows as neon tubes", () => {
  it("AC-446 the look's neon arrows are three halos of one thin bright line along each arrow, in the arrow's colour", () => {
    const tubes = (look: Partial<FlowFrameScene["look"]>) => {
      const log = draw(scene({ nodeStyle: "none", ...look }), 200);

      return log.filter((entry) => entry[0] === "stroke").length;
    };

    expect(tubes({ glowArrow: false })).toBe(0);
    expect(tubes({ glowArrow: true })).toBe(3);

    const log = draw(
      scene({
        nodeStyle: "none",
        glowArrow: true,
        arrowColor: "#1971c2",
        markColor: "#e8590c",
      }),
      200,
    );

    expect(
      log.filter((e) => e[0] === "set:lineWidth").map((e) => e[1]),
    ).toEqual([3, 3, 3]);
    expect(
      log.filter((e) => e[0] === "set:strokeStyle").map((e) => e[1]),
    ).toEqual(Array(3).fill(neonCore("#1971c2")));
    expect(
      log.filter((e) => e[0] === "set:shadowColor").map((e) => e[1]),
    ).toEqual(Array(3).fill("#1971c2"));

    // the halos grow
    const blurs = log
      .filter((e) => e[0] === "set:shadowBlur")
      .map((e) => e[1] as number);

    expect(blurs[0]).toBeLessThan(blurs[1]);
    expect(blurs[1]).toBeLessThan(blurs[2]);

    // the arrow's colour is the mark's when it has none, and the accent when neither
    const colorOf = (look: Partial<FlowFrameScene["look"]>) =>
      draw(scene({ nodeStyle: "none", glowArrow: true, ...look }), 200).find(
        (e) => e[0] === "set:shadowColor",
      )![1];

    expect(colorOf({ arrowColor: null, markColor: "#e8590c" })).toBe("#e8590c");
    expect(colorOf({ arrowColor: null, markColor: null })).toBe("#6965db");
  });
});

describe("the arrows the canvas is given", () => {
  const appState = getDefaultAppState() as never;

  const chart = () => {
    const container = API.createElement({
      type: "rectangle",
      id: "n1",
      x: 0,
      y: 0,
    });
    const other = API.createElement({
      type: "rectangle",
      id: "n2",
      x: 300,
      y: 0,
    });
    const line = API.createElement({
      type: "arrow",
      id: "a1",
      x: 100,
      y: 25,
      points: [pointFrom(0, 0), pointFrom(200, 0)],
    });

    return { elements: [container, other, line], line };
  };

  const run = async (look: Partial<FlowFrameScene["look"]>, camera = false) => {
    captured.length = 0;

    const { elements } = chart();

    await exportFlowAnimation({
      graph: {
        steps: [
          {
            containerId: "n1",
            elementIds: ["n1"],
            box: { x: 0, y: 0, width: 100, height: 100 },
          },
          {
            containerId: "n2",
            elementIds: ["n2"],
            box: { x: 300, y: 0, width: 100, height: 100 },
          },
        ],
        edges: [{ from: "n1", to: "n2" }],
        edgeArrows: [{ from: "n1", to: "n2", arrowId: "a1" }],
      },
      steps: [
        {
          containerId: "n1",
          elementIds: ["n1"],
          box: { x: 0, y: 0, width: 100, height: 100 },
        },
        {
          containerId: "n2",
          elementIds: ["n2"],
          box: { x: 300, y: 0, width: 100, height: 100 },
        },
      ],
      elements,
      appState,
      files: {},
      animation: {
        ...FLOW_LOOK_DEFAULTS,
        ...look,
        durationMs: 1000,
        nodeStyle: "focus",
        arrowStyle: "marching",
        speed: 60,
      },
      options: {
        format: "gif",
        fps: 10,
        longest: 480,
        // a square picture, so the camera has somewhere to go on a wide chart
        shape: camera ? "square" : "chart",
        withBackground: true,
        camera,
      },
      name: "chart",
      onProgress: () => undefined,
      isStopped: () => false,
    });

    return captured[0]?.elements ?? [];
  };

  beforeEach(() => {
    captured.length = 0;
  });

  it("AC-446 an arrow is given as it is, and is not touched, when the look leaves it alone", async () => {
    const given = await run({});

    expect(given.map((e) => e.id).sort()).toEqual(["a1", "n1", "n2"]);
    expect(given.find((e) => e.id === "a1")!.strokeColor).toBe("#1e1e1e");
  });

  it("AC-446 an arrow the look hides is not given, and one it colours is given in that colour", async () => {
    expect((await run({ hideArrow: true })).map((e) => e.id).sort()).toEqual([
      "n1",
      "n2",
    ]);

    const coloured = await run({ arrowColor: "#1971c2" });

    expect(coloured.find((e) => e.id === "a1")!.strokeColor).toBe("#1971c2");
    // the nodes are as they were
    expect(coloured.find((e) => e.id === "n1")!.strokeColor).toBe("#1e1e1e");
  });

  it("AC-446 an arrow drawn as a neon tube is not given: the tube is drawn over the picture instead", async () => {
    expect((await run({ glowArrow: true })).map((e) => e.id).sort()).toEqual([
      "n1",
      "n2",
    ]);
  });

  it("AC-446 the element on the page is never changed by an export", async () => {
    const { elements, line } = chart();
    const before = JSON.stringify(line);

    captured.length = 0;
    await run({ arrowColor: "#1971c2", hideArrow: false });

    expect(JSON.stringify(elements[2])).toBe(before);
  });

  it("AC-447 without the camera the chart is drawn once, and the source has no flight", async () => {
    vi.mocked(createFrameSource).mockClear();
    await run({}, false);

    const options = vi.mocked(createFrameSource).mock.calls[0][0];

    expect(options.flight).toBeUndefined();
    expect(options.base).not.toBeNull();
    expect(captured).toHaveLength(1);
  });

  it("AC-447 with the camera nothing is drawn up front: each camera has the chart drawn as it sees it", async () => {
    vi.mocked(createFrameSource).mockClear();
    await run({}, true);

    const options = vi.mocked(createFrameSource).mock.calls[0][0];

    expect(options.base).toBeNull();
    expect(captured).toHaveLength(0);

    const flight = options.flight!;

    // the camera is a function of the moment: it moves, and it comes back
    const first = flight.transformAt(0);
    const later = flight.transformAt(1500);

    expect(later).not.toEqual(first);
    expect(flight.transformAt(0)).toEqual(first);
    // one round is two steps of one second
    expect(flight.transformAt(2000).scale).toBeCloseTo(first.scale, 9);

    // the chart is drawn for that camera: the part of the page it sees, at its scale
    await flight.renderBase(later);

    expect(captured).toHaveLength(1);
    expect(captured[0].options?.pageRect).toEqual(
      sceneRectOf(later, options.size),
    );
    expect(captured[0].scale).toBe(later.scale);

    // and drawn again for the next one
    await flight.renderBase(first);

    expect(captured).toHaveLength(2);
    expect(captured[1].options?.pageRect).toEqual(
      sceneRectOf(first, options.size),
    );
  });
});
