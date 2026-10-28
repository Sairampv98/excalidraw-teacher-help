/**
 * AC-275 - each paper type and colour is drawn, and scales with the page (D-243).
 */

import { describe, expect, it, vi } from "vitest";

import { drawPagePaper } from "../renderer/paperRender";
import {
  PAPER_COLORS,
  PAPER_TYPES,
  getPagePaperDraw,
  paperMarks,
} from "../scene/paper";

import type { PageRect } from "../types";

const SMALL: PageRect = { x: 0, y: 0, width: 1920, height: 1080 };
const BIG: PageRect = { x: 0, y: 0, width: 3840, height: 2160 };

const lines = (type: typeof PAPER_TYPES[number], rect = SMALL) =>
  paperMarks(type, rect).filter((mark) => mark.kind === "line") as Extract<
    ReturnType<typeof paperMarks>[number],
    { kind: "line" }
  >[];

describe("AC-275 each paper type and colour is drawn", () => {
  it("AC-275 each type has its own marks", () => {
    expect(paperMarks("plain", SMALL)).toEqual([]);

    const horizontal = (type: typeof PAPER_TYPES[number]) =>
      lines(type).filter((l) => l.y1 === l.y2);

    expect(horizontal("single-line")).toHaveLength(22);
    // two rules close together for each line of writing
    expect(horizontal("double-line")).toHaveLength(24);

    // a grid has both directions; dots are points and no lines
    expect(lines("grid").some((l) => l.x1 === l.x2)).toBe(true);
    expect(lines("grid").some((l) => l.y1 === l.y2)).toBe(true);
    expect(lines("dot-grid")).toHaveLength(0);
    expect(
      paperMarks("dot-grid", SMALL).filter((m) => m.kind === "dot").length,
    ).toBeGreaterThan(500);

    // the Cornell page has a cue column and a summary line, drawn heavier
    expect(lines("cornell").filter((l) => l.heavy)).toHaveLength(2);

    // isometric has verticals and two slanted families
    const iso = lines("isometric");

    expect(iso.some((l) => l.x1 === l.x2)).toBe(true);
    expect(iso.some((l) => l.y2 < l.y1)).toBe(true);
    expect(iso.some((l) => l.y2 > l.y1)).toBe(true);

    // eight staves of five lines
    expect(lines("music")).toHaveLength(40);
  });

  it("AC-275 the marks are inside the page and scale with it", () => {
    for (const type of PAPER_TYPES) {
      for (const mark of paperMarks(type, BIG)) {
        const points =
          mark.kind === "line"
            ? [
                [mark.x1, mark.y1],
                [mark.x2, mark.y2],
              ]
            : [[mark.x, mark.y]];

        for (const [x, y] of points) {
          expect(x).toBeGreaterThanOrEqual(-0.01);
          expect(y).toBeGreaterThanOrEqual(-0.01);
          expect(x).toBeLessThanOrEqual(BIG.width + 0.01);
          expect(y).toBeLessThanOrEqual(BIG.height + 0.01);
        }
      }
    }

    // a page twice as big has the same number of rules, twice as far apart
    for (const type of [
      "single-line",
      "double-line",
      "grid",
      "music",
    ] as const) {
      expect(lines(type, BIG).filter((l) => l.y1 === l.y2)).toHaveLength(
        lines(type, SMALL).filter((l) => l.y1 === l.y2).length,
      );
    }

    const gap = (rect: PageRect) => {
      const ys = lines("single-line", rect).map((l) => l.y1);

      return ys[1] - ys[0];
    };

    expect(gap(BIG)).toBeCloseTo(gap(SMALL) * 2, 5);
  });

  it("AC-275 the canvas draws the sheet in its colour and the rules over it", () => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    const fills: { color: unknown; rect: number[] }[] = [];
    const real = context.fillRect.bind(context);

    context.fillRect = vi.fn((x, y, w, h) => {
      fills.push({ color: context.fillStyle, rect: [x, y, w, h] });
      real(x, y, w, h);
    });

    const stroke = vi.spyOn(context, "stroke");

    for (const color of PAPER_COLORS) {
      fills.length = 0;

      const draw = getPagePaperDraw(
        {
          id: "p",
          name: "P",
          paper: { type: "single-line", color: color.id, grain: 0, age: 0 },
        },
        SMALL,
      )!;

      drawPagePaper(context, draw, 100, 50);

      // the sheet fills the page's rect, moved by the scroll
      expect(fills[0]).toEqual({
        color: color.color,
        rect: [100, 50, 1920, 1080],
      });
      expect(draw.dark).toBe(color.dark);
    }

    // a light paper has dark rules and a dark paper has light ones
    expect(
      getPagePaperDraw(
        {
          id: "p",
          name: "P",
          paper: { type: "grid", color: "white", grain: 0, age: 0 },
        },
        SMALL,
      )!.ruleColor,
    ).toContain("60,100,170");
    expect(
      getPagePaperDraw(
        {
          id: "p",
          name: "P",
          paper: { type: "grid", color: "blackboard", grain: 0, age: 0 },
        },
        SMALL,
      )!.ruleColor,
    ).toContain("255,255,255");
    expect(stroke).toHaveBeenCalled();
  });

  it("AC-275 the canvas colour lets the canvas show through", () => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    const fillRect = vi.spyOn(context, "fillRect");
    const draw = getPagePaperDraw(
      {
        id: "p",
        name: "P",
        paper: { type: "grid", color: "canvas", grain: 0, age: 0 },
      },
      SMALL,
    )!;

    expect(draw.color).toBeNull();
    drawPagePaper(context, draw, 0, 0);
    // no sheet is filled: only the rules are drawn
    expect(fillRect).not.toHaveBeenCalled();
  });
});
