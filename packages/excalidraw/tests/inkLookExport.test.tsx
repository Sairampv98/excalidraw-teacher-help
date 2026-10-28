/**
 * AC-271 - a look is the same every time and in every export (D-241).
 *
 * The exports are the real ones: a PNG export on a canvas whose context records
 * what it is asked to draw, and an SVG export read as the text it makes.
 */

import { describe, expect, it } from "vitest";

import { pointFrom } from "@excalidraw/math";

import {
  inkExportMargin,
  inkPadding,
  inkSvgPrimitives,
} from "@excalidraw/element";

import type { LocalPoint } from "@excalidraw/math";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { exportToCanvas, exportToSvg } from "../scene/export";

import { API } from "./helpers/api";

const stroke = (look?: string, amount = 50, seed?: number) => {
  const element = API.createElement({
    type: "freedraw",
    x: 20,
    y: 20,
    points: [
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(60, 30),
      pointFrom<LocalPoint>(120, 0),
    ],
  });

  return {
    ...element,
    ...(seed === undefined ? {} : { seed }),
    ...(look ? { customData: { ink: { look, amount } } } : {}),
  } as ExcalidrawElement;
};

const svgOf = async (elements: ExcalidrawElement[]) =>
  exportToSvg(
    elements as never,
    { exportBackground: false, viewBackgroundColor: "#ffffff" },
    {},
    { skipInliningFonts: true },
  );

const pngOf = async (elements: ExcalidrawElement[]) => {
  let drawn: CanvasRenderingContext2D | null = null;

  const canvas = await exportToCanvas(
    elements as never,
    { ...getDefaultAppState(), exportScale: 1 } as never,
    {},
    { exportBackground: false, viewBackgroundColor: "#ffffff" },
    (width, height) => {
      const made = document.createElement("canvas");

      made.width = width;
      made.height = height;
      drawn = made.getContext("2d");

      return { canvas: made, scale: 1 };
    },
    async () => {},
  );

  return {
    canvas,
    // the pictures of an inked element that were drawn on the export
    pictures: (drawn as any).drawImage.mock.calls.length as number,
  };
};

describe("AC-271 a look is the same every time and in every export", () => {
  it("AC-271 the same seed gives the same ink", async () => {
    // the plan and the filter are made from the element's seed alone
    for (const look of ["chalk", "pencil", "neon", "marker"] as const) {
      const ink = { look, amount: 60 };

      expect(inkSvgPrimitives(ink, "#ff2bd6", 42), look).toEqual(
        inkSvgPrimitives(ink, "#ff2bd6", 42),
      );
    }

    // an export of a scene is the same text every time it is made
    const scene = [stroke("chalk", 60, 42), stroke("pencil", 40, 7)];
    const first = (await svgOf(scene)).outerHTML;

    expect(first).toContain("feTurbulence");
    expect((await svgOf(scene)).outerHTML).toBe(first);
  });

  it("AC-271 another seed gives other gaps", async () => {
    const noise = (seed: number) =>
      inkSvgPrimitives({ look: "chalk", amount: 50 }, "#ffffff", seed).find(
        (p) => p.tag === "feTurbulence",
      )!.attrs.seed;

    expect(noise(1)).not.toBe(noise(2));

    // and in an export, two strokes with the same look are not given the same grain
    const svg = await svgOf([stroke("chalk", 50, 1), stroke("chalk", 50, 2)]);
    const seeds = [...svg.querySelectorAll("feTurbulence")].map((n) =>
      n.getAttribute("seed"),
    );

    expect(seeds).toHaveLength(2);
    expect(seeds[0]).not.toBe(seeds[1]);
  });

  it("AC-271 a PNG export draws the look and makes room", async () => {
    const plain = await pngOf([stroke()]);

    // Normal is drawn straight on the export; a look is drawn on a canvas of its own and put on it
    expect(plain.pictures).toBe(0);

    for (const [look, amount] of [
      ["neon", 50],
      ["neon", 100],
      ["chalk", 50],
      ["marker", 50],
      ["pencil", 50],
    ] as const) {
      const exported = await pngOf([stroke(look, amount)]);
      const room = inkPadding({ look, amount });

      expect(exported.pictures, look).toBeGreaterThan(0);
      // the export is wider and taller by the room the look needs on each side
      expect(exported.canvas.width - plain.canvas.width, look).toBe(room * 2);
      expect(exported.canvas.height - plain.canvas.height, look).toBe(room * 2);
    }

    // the room is the largest of any element's
    expect(
      inkExportMargin([stroke("pencil"), stroke("neon", 100), stroke()]),
    ).toBe(inkPadding({ look: "neon", amount: 100 }));
    expect(inkExportMargin([stroke()])).toBe(0);
  });

  it("AC-271 an SVG export has the filters and makes room", async () => {
    const plain = await svgOf([stroke()]);

    // Normal has no filter and no group of its own
    expect(plain.querySelector("filter")).toBeNull();
    expect(plain.querySelector("[data-ink]")).toBeNull();

    for (const [look, amount] of [
      ["neon", 50],
      ["chalk", 50],
      ["marker", 50],
      ["pencil", 50],
    ] as const) {
      const svg = await svgOf([stroke(look, amount)]);
      const filter = svg.querySelector("filter")!;
      const group = svg.querySelector(`g[data-ink="${look}"]`)!;

      // the stroke is drawn inside a group that uses the filter
      expect(filter, look).not.toBeNull();
      expect(group.getAttribute("filter"), look).toBe(
        `url(#${filter.getAttribute("id")})`,
      );
      expect(group.querySelector("path"), look).not.toBeNull();

      // the filter is the one the look plans, and is wide enough for what it paints
      expect(filter.children.length, look).toBe(
        inkSvgPrimitives({ look, amount }, "#000000", 1).length,
      );

      // the export is wider and taller by the room of the look on each side
      const room = inkPadding({ look, amount });

      expect(
        Number(svg.getAttribute("width")) - Number(plain.getAttribute("width")),
        look,
      ).toBe(room * 2);
      expect(
        Number(svg.getAttribute("height")) -
          Number(plain.getAttribute("height")),
        look,
      ).toBe(room * 2);
    }

    // a neon tube is four blurs, each under a flood of its colour, and a core
    const neon = await svgOf([stroke("neon", 50)]);

    expect(neon.querySelectorAll("feGaussianBlur")).toHaveLength(4);
    expect(neon.querySelector("feMerge")!.children.length).toBe(6);

    // only an element with a look is put in a group: the one beside it is not

    const rect = API.createElement({
      type: "rectangle",
      width: 100,
      height: 60,
    });
    const both = await svgOf([
      { ...rect, customData: { ink: { look: "neon", amount: 50 } } },
      { ...stroke(), x: 200 },
    ] as ExcalidrawElement[]);

    expect(both.querySelectorAll("g[data-ink]")).toHaveLength(1);
  });
});
