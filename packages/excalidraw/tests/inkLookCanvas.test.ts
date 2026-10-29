/**
 * AC-270 - the canvas draws each look (D-241).
 *
 * The plan of a look is read as data; the painting of it is read on a canvas
 * whose context records what it is asked to do; and the cached canvas of an
 * element is read through the renderer that makes it.
 */

import rough from "roughjs/bin/rough";
import { describe, expect, it } from "vitest";

import { arrayToMap, THEME } from "@excalidraw/common";
import {
  applyInkLook,
  elementWithCanvasCache,
  inkPadding,
  inkPlan,
  lightenInkColor,
  renderElement,
} from "@excalidraw/element";

import type { Ink } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";

import { API } from "./helpers/api";

const inked = (
  element: ExcalidrawElement,
  look: string,
  amount = 50,
): ExcalidrawElement =>
  ({ ...element, customData: { ink: { look, amount } } } as ExcalidrawElement);

/** a canvas with something drawn on it, and the calls its context gets */
const paint = (ink: Ink, color = "#ff2bd6", seed = 11, px = 2) => {
  const canvas = document.createElement("canvas");

  canvas.width = 120;
  canvas.height = 80;

  const context = canvas.getContext("2d")!;
  const blurs: number[] = [];

  Object.defineProperty(context, "shadowBlur", {
    configurable: true,
    get: () => 0,
    set: (value: number) => {
      blurs.push(value);
    },
  });

  context.fillRect(20, 20, 60, 30);

  // every canvas the painting works on, so that what it does to them can be counted
  const contexts = new Set<CanvasRenderingContext2D>([context]);
  const make = () => {
    const made = document.createElement("canvas");

    contexts.add(made.getContext("2d")!);

    return made;
  };

  const total = (name: "drawImage" | "createPattern") =>
    [...contexts].reduce(
      (sum, c) => sum + (((c as any)[name].mock?.calls.length as number) ?? 0),
      0,
    );
  const before = {
    drawImage: total("drawImage"),
    createPattern: total("createPattern"),
  };

  applyInkLook(canvas, ink, color, seed, px, make);

  const after = {
    drawImage: total("drawImage"),
    createPattern: total("createPattern"),
  };

  return {
    blurs,
    drawImage: after.drawImage - before.drawImage,
    createPattern: after.createPattern - before.createPattern,
  };
};

const draw = (element: ExcalidrawElement) => {
  const canvas = document.createElement("canvas");

  canvas.width = 400;
  canvas.height = 400;

  renderElement(
    element as never,
    arrayToMap([element]) as never,
    arrayToMap([element]) as never,
    rough.canvas(canvas),
    canvas.getContext("2d")!,
    {
      canvasBackgroundColor: "#ffffff",
      imageCache: new Map(),
      renderGrid: false,
      isExporting: false,
      embedsValidationStatus: { element: new Map(), frame: new Map() },
      elementsPendingErasure: new Map(),
      pendingFlowchartNodes: null,
      theme: THEME.LIGHT,
    } as never,
    {
      ...getDefaultAppState(),
      width: 400,
      height: 400,
      zoom: { value: 1 },
      scrollX: 0,
      scrollY: 0,
    } as never,
  );

  return elementWithCanvasCache.get(element as never);
};

describe("AC-270 the canvas draws each look", () => {
  it("AC-270 normal is drawn as before", () => {
    expect(inkPlan({ look: "normal", amount: 50 }, "#000000", 1)).toEqual([]);

    // nothing is painted over it
    expect(paint({ look: "normal", amount: 50 })).toEqual({
      blurs: [],
      drawImage: 0,
      createPattern: 0,
    });

    // and its canvas has the room it always had
    const rect = API.createElement({
      type: "rectangle",
      width: 100,
      height: 60,
    });
    const plain = draw(rect)!;

    expect(plain.inkKey).toBe("");
    expect(inkPadding({ look: "normal", amount: 50 })).toBe(0);
    expect(draw(inked(rect, "normal"))!.canvas.width).toBe(plain.canvas.width);
  });

  it("AC-270 neon is a core inside a halo", () => {
    const plan = inkPlan({ look: "neon", amount: 50 }, "#00f0ff", 3);
    const halos = plan.filter((step) => step.op === "halo");
    const cores = plan.filter((step) => step.op === "core");

    // four shadows of growing reach, in the colour of the ink, and a lighter core
    expect(halos.map((h) => (h as { blur: number }).blur)).toEqual([
      2, 6, 14, 28,
    ]);
    expect(
      halos.every((h) => (h as { color: string }).color === "#00f0ff"),
    ).toBe(true);
    expect(cores).toHaveLength(1);
    expect((cores[0] as { color: string }).color).toBe(
      lightenInkColor("#00f0ff", 25),
    );
    expect(lightenInkColor("#00f0ff", 25)).not.toBe("#00f0ff");

    // on the canvas the shadows are asked for in pixels, a scene unit being `px` of them
    const painted = paint({ look: "neon", amount: 50 }, "#00f0ff", 3, 2);

    expect(painted.blurs.filter((b) => b > 0)).toEqual([4, 12, 28, 56]);

    // more glow is a wider halo
    const wide = paint({ look: "neon", amount: 100 }, "#00f0ff", 3, 2);

    expect(Math.max(...wide.blurs)).toBeGreaterThan(Math.max(...painted.blurs));
  });

  it("AC-270 chalk marker and pencil each draw differently", () => {
    const chalk = paint({ look: "chalk", amount: 50 });
    const marker = paint({ look: "marker", amount: 50 });
    const pencil = paint({ look: "pencil", amount: 50 });

    // chalk has gaps and loose dust (two patterns), pencil has grain; marker has none and is spread instead
    expect(chalk.createPattern).toBe(2);
    expect(pencil.createPattern).toBe(1);
    expect(marker.createPattern).toBe(0);

    // chalk has a faint dust around it, marker and pencil have no halo
    expect(chalk.blurs.filter((b) => b > 0)).toHaveLength(1);
    expect(marker.blurs.filter((b) => b > 0)).toHaveLength(0);
    expect(pencil.blurs.filter((b) => b > 0)).toHaveLength(0);

    const plans = (look: Ink["look"]) =>
      inkPlan({ look, amount: 50 }, "#333", 5);
    const op = (look: Ink["look"], name: string) =>
      plans(look).find((step) => step.op === name) as never as Record<
        string,
        number
      >;

    // the pencil's grain is finer than the chalk's and see-through; the marker is see-through too
    expect(op("pencil", "holes").cell).toBeLessThan(op("chalk", "holes").cell);
    expect(op("pencil", "alpha").value).toBeLessThan(1);
    expect(op("marker", "alpha").value).toBe(0.5);
    // the chalk scatters dust around the ink; the others do not
    expect(op("chalk", "dust").reach).toBeGreaterThan(0);
    expect(plans("pencil").some((s) => s.op === "dust")).toBe(false);
    expect(plans("marker").some((s) => s.op === "dust")).toBe(false);
    expect(op("marker", "thicken").radius).toBeGreaterThan(0);

    // more dust is more gaps; more weight is a broader nib; more grain is more gaps
    const dusty = (amount: number) =>
      (
        inkPlan({ look: "chalk", amount }, "#fff", 5).find(
          (s) => s.op === "holes",
        ) as { density: number }
      ).density;
    const broad = (amount: number) =>
      (
        inkPlan({ look: "marker", amount }, "#fff", 5).find(
          (s) => s.op === "thicken",
        ) as { radius: number }
      ).radius;

    const reach = (amount: number) =>
      (
        inkPlan({ look: "chalk", amount }, "#fff", 5).find(
          (s) => s.op === "dust",
        ) as { reach: number }
      ).reach;
    const pencilStep = (amount: number, name: "holes" | "alpha") =>
      inkPlan({ look: "pencil", amount }, "#333", 5).find(
        (s) => s.op === name,
      ) as never as Record<string, number>;

    expect(dusty(90)).toBeGreaterThan(dusty(10));
    expect(reach(90)).toBeGreaterThan(reach(10));
    expect(broad(90)).toBeGreaterThan(broad(10));

    // a darker pencil is more solid and less see-through than a light one
    expect(pencilStep(90, "alpha").value).toBeGreaterThan(
      pencilStep(10, "alpha").value,
    );
    expect(pencilStep(90, "holes").density).toBeLessThan(
      pencilStep(10, "holes").density,
    );
  });

  it("AC-270 there is room for the halo and the dust", () => {
    const rect = API.createElement({
      type: "rectangle",
      width: 100,
      height: 60,
    });
    const plain = draw(rect)!.canvas;

    for (const [look, amount] of [
      ["neon", 50],
      ["neon", 100],
      ["chalk", 50],
      ["marker", 100],
      ["pencil", 50],
    ] as const) {
      const ink = { look, amount };
      const canvas = draw(inked(rect, look, amount))!.canvas;
      const room = inkPadding(ink);

      // the canvas is wider on every side by what the look paints past the element
      expect(canvas.width - plain.width, `${look} ${amount}`).toBe(room * 2);
      expect(canvas.height - plain.height, `${look} ${amount}`).toBe(room * 2);
    }

    // a halo is never wider than the room it is given
    for (const amount of [1, 50, 100]) {
      const reach = Math.max(
        ...inkPlan({ look: "neon", amount }, "#fff", 1).map((s) =>
          s.op === "halo" ? s.blur : 0,
        ),
      );

      expect(inkPadding({ look: "neon", amount })).toBeGreaterThanOrEqual(
        reach,
      );
    }
  });

  it("AC-270 changing the look redraws", () => {
    const text = inked(
      API.createElement({ type: "text", text: "Hello" }),
      "neon",
      20,
    );
    const first = draw(text)!;

    // nothing changed: the canvas that was made is the one that is used
    expect(draw(text)).toBe(first);

    // the amount changes on the same element: a new canvas is made, with more room
    Object.assign(text, { customData: { ink: { look: "neon", amount: 90 } } });

    const wider = draw(text)!;

    expect(wider).not.toBe(first);
    expect(wider.canvas.width).toBeGreaterThan(first.canvas.width);

    // the look changes: another canvas again
    Object.assign(text, { customData: { ink: { look: "chalk", amount: 90 } } });

    const chalk = draw(text)!;

    expect(chalk).not.toBe(wider);
    expect(chalk.canvas.width).toBeLessThan(wider.canvas.width);

    // the colour of the ink changes: the glow is made again in it
    Object.assign(text, { strokeColor: "#ff0000" });
    expect(draw(text)).not.toBe(chalk);
  });
});
