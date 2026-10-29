/**
 * AC-276 - the grain and the age are seeded, and are the same every time (D-243).
 */

import { describe, expect, it, vi } from "vitest";

import {
  ageEdge,
  ageTint,
  drawPagePaper,
  grainStrength,
  paperFibres,
} from "../renderer/paperRender";
import { fibreCount, getPagePaperDraw } from "../scene/paper";

import type { PagePaper } from "../scene/paper";
import type { PageRect } from "../types";

const RECT: PageRect = { x: 0, y: 0, width: 1920, height: 1080 };

const drawOf = (paper: Partial<PagePaper>, id = "page-1", rect = RECT) =>
  getPagePaperDraw(
    {
      id,
      name: id,
      paper: { type: "plain", color: "cream", grain: 0, age: 0, ...paper },
    },
    rect,
  )!;

describe("AC-276 the grain and the age are seeded", () => {
  it("AC-276 the same page has the same fibres and another page has others", () => {
    const first = paperFibres(drawOf({ age: 60 }));

    expect(first.length).toBeGreaterThan(50);
    expect(paperFibres(drawOf({ age: 60 }))).toEqual(first);
    expect(paperFibres(drawOf({ age: 60 }, "page-2"))).not.toEqual(first);

    // every fibre is inside the page
    for (const fibre of first) {
      expect(fibre.x1).toBeGreaterThanOrEqual(0);
      expect(fibre.x1).toBeLessThanOrEqual(RECT.width);
    }
  });

  it("AC-276 more age is more fibres, more warmth and darker edges", () => {
    expect(fibreCount(drawOf({ age: 0 }))).toBe(0);
    expect(fibreCount(drawOf({ age: 80 }))).toBeGreaterThan(
      fibreCount(drawOf({ age: 20 })),
    );

    // a bigger page has more of them, for the same age
    expect(
      fibreCount(
        drawOf({ age: 50 }, "p", { ...RECT, width: 3840, height: 2160 }),
      ),
    ).toBeGreaterThan(fibreCount(drawOf({ age: 50 })));

    const alphaOf = (color: string) =>
      Number(color.split(",").pop()!.replace(")", ""));

    expect(alphaOf(ageTint(drawOf({ age: 90 })))).toBeGreaterThan(
      alphaOf(ageTint(drawOf({ age: 10 }))),
    );
    expect(alphaOf(ageEdge(drawOf({ age: 90 })))).toBeGreaterThan(
      alphaOf(ageEdge(drawOf({ age: 10 }))),
    );

    // light paper yellows, a board is smudged and not yellowed
    expect(ageTint(drawOf({ age: 50 }))).toContain("176,116,40");
    expect(ageTint(drawOf({ age: 50, color: "blackboard" }))).toContain(
      "255,255,255",
    );
  });

  it("AC-276 the grain is drawn only when there is some, and is stronger with more", () => {
    expect(grainStrength(80)).toBeGreaterThan(grainStrength(20));

    const patterns = (paper: Partial<PagePaper>) => {
      const context = document.createElement("canvas").getContext("2d")!;
      const createPattern = vi.spyOn(context, "createPattern");
      const gradient = vi.spyOn(context, "createRadialGradient");

      drawPagePaper(context, drawOf(paper), 0, 0);

      return {
        grain: createPattern.mock.calls.length,
        edges: gradient.mock.calls.length,
      };
    };

    expect(patterns({ grain: 0, age: 0 })).toEqual({ grain: 0, edges: 0 });
    expect(patterns({ grain: 50, age: 0 })).toEqual({ grain: 1, edges: 0 });
    expect(patterns({ grain: 0, age: 50 })).toEqual({ grain: 0, edges: 1 });
  });

  it("AC-276 drawing twice is the same", () => {
    const record = () => {
      const context = document
        .createElement("canvas")
        .getContext("2d")! as CanvasRenderingContext2D & {
        __getDrawCalls: () => unknown[];
      };

      drawPagePaper(
        context,
        drawOf({ type: "grid", grain: 40, age: 60 }),
        10,
        20,
      );

      return JSON.stringify(context.__getDrawCalls());
    };

    expect(record()).toBe(record());
  });
});
