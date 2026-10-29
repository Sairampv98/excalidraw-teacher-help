/**
 * AC-268 - an ink look is data that is kept (D-241).
 *
 * The data and the plan of each look are read where they are made, in
 * `@excalidraw/element`; a look is kept on the element and comes back from a
 * save and a load.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_INK_AMOUNT,
  INK_COLORS,
  INK_LOOKS,
  NORMAL_INK,
  canHaveInk,
  clampInkAmount,
  customDataWithInk,
  inkOf,
  inkPlan,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { restoreElements } from "../data/restore";

import { API } from "./helpers/api";

const withInk = (element: ExcalidrawElement, look: string, amount?: number) =>
  ({
    ...element,
    customData: { ink: { look, ...(amount === undefined ? {} : { amount }) } },
  } as ExcalidrawElement);

describe("AC-268 an ink look is data that is kept", () => {
  it("AC-268 the five looks and their colours", () => {
    expect(INK_LOOKS).toEqual(["normal", "neon", "chalk", "marker", "pencil"]);

    // each look but Normal has its named colours, as hex colours
    expect(Object.keys(INK_COLORS)).toEqual([
      "neon",
      "chalk",
      "marker",
      "pencil",
    ]);
    expect(INK_COLORS.neon.map((c) => c.name)).toEqual([
      "Pink",
      "Cyan",
      "Lime",
      "Yellow",
      "Orange",
      "Violet",
      "White",
    ]);
    expect(INK_COLORS.chalk.map((c) => c.name)).toEqual([
      "White",
      "Yellow",
      "Pink",
      "Blue",
      "Green",
      "Orange",
    ]);
    expect(INK_COLORS.marker.map((c) => c.name)).toEqual([
      "Yellow",
      "Pink",
      "Green",
      "Blue",
      "Orange",
      "Purple",
    ]);
    expect(INK_COLORS.pencil.map((c) => c.name)).toEqual([
      "Graphite",
      "Blue",
      "Red",
      "Green",
      "Brown",
    ]);

    for (const list of Object.values(INK_COLORS)) {
      for (const { color } of list) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }

    // the looks are not the same, and Normal paints nothing over the element
    const plans = INK_LOOKS.map((look) =>
      JSON.stringify(inkPlan({ look, amount: 50 }, "#ff2bd6", 7)),
    );

    expect(new Set(plans).size).toBe(5);
    expect(inkPlan(NORMAL_INK, "#000000", 1)).toEqual([]);
  });

  it("AC-268 the amount is kept in range", () => {
    expect(DEFAULT_INK_AMOUNT).toBe(50);
    expect(clampInkAmount(0)).toBe(1);
    expect(clampInkAmount(-20)).toBe(1);
    expect(clampInkAmount(250)).toBe(100);
    expect(clampInkAmount(33.6)).toBe(34);
    // a value that is not a number is the default
    expect(clampInkAmount("lots")).toBe(50);
    expect(clampInkAmount(NaN)).toBe(50);

    // an element without an amount has the default, and one out of range is kept in it
    const rect = API.createElement({ type: "rectangle" });

    expect(inkOf(withInk(rect, "neon"))).toEqual({ look: "neon", amount: 50 });
    expect(inkOf(withInk(rect, "neon", 900)).amount).toBe(100);
    expect(inkOf(withInk(rect, "neon", -4)).amount).toBe(1);

    // more of a look is more of what it paints
    const reach = (amount: number) =>
      Math.max(
        ...inkPlan({ look: "neon", amount }, "#00f0ff", 1).map((step) =>
          step.op === "halo" ? step.blur : 0,
        ),
      );

    expect(reach(100)).toBeGreaterThan(reach(50));
    expect(reach(50)).toBeGreaterThan(reach(1));
  });

  it("AC-268 only drawn elements have a look", () => {
    for (const type of [
      "text",
      "freedraw",
      "rectangle",
      "diamond",
      "ellipse",
      "line",
      "arrow",
    ] as const) {
      expect(canHaveInk({ type }), type).toBe(true);
      expect(
        inkOf(withInk(API.createElement({ type }), "chalk", 20)).look,
        type,
      ).toBe("chalk");
    }

    // an image and a frame are not drawn with ink: whatever is written on them, they are Normal
    for (const type of [
      "image",
      "frame",
      "magicframe",
      "iframe",
      "embeddable",
    ]) {
      expect(canHaveInk({ type }), type).toBe(false);
    }

    expect(
      inkOf(withInk(API.createElement({ type: "image" }), "neon", 50)),
    ).toEqual(NORMAL_INK);
    expect(
      inkOf(withInk(API.createElement({ type: "frame" }), "neon", 50)),
    ).toEqual(NORMAL_INK);
  });

  it("AC-268 a look is kept and an old element is normal", () => {
    // an element that never had a look is Normal
    const old = API.createElement({ type: "freedraw" });

    expect(inkOf(old)).toEqual(NORMAL_INK);
    expect(
      inkOf({ ...old, customData: { ink: { look: "glitter" } } } as never),
    ).toEqual(NORMAL_INK);

    // the look is written to customData, beside what is already there
    const data = customDataWithInk(
      { flow: { role: "node" } },
      { look: "marker", amount: 70 },
    );

    expect(data).toEqual({
      flow: { role: "node" },
      ink: { look: "marker", amount: 70 },
    });

    // and Normal takes it away: the same as an element that never had one
    expect(customDataWithInk(data, NORMAL_INK)).toEqual({
      flow: { role: "node" },
    });
    expect(customDataWithInk({ ink: { look: "neon" } }, NORMAL_INK)).toBe(
      undefined,
    );

    // saved and loaded, copied and pasted: the look is still on the element
    const element = withInk(
      API.createElement({ type: "text", text: "Hello" }),
      "chalk",
      80,
    );
    const loaded = restoreElements(JSON.parse(JSON.stringify([element])), null);

    expect(inkOf(loaded[0])).toEqual({ look: "chalk", amount: 80 });
    expect(inkOf({ ...loaded[0], id: "pasted" } as never)).toEqual({
      look: "chalk",
      amount: 80,
    });
  });
});
