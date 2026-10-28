/**
 * AC-273 - the paper of a page is data that is kept (D-243).
 */

import { describe, expect, it } from "vitest";

import { restoreAppState } from "../data/restore";
import {
  CANVAS_PAPER_COLOR,
  PAPER_COLORS,
  PAPER_LOOKS,
  PAPER_TYPES,
  PLAIN_PAPER,
  getPagePaperDraw,
  isPlainPaper,
  paperOf,
  seedOf,
} from "../scene/paper";
import { getPageDecoration, updatePage } from "../scene/pages";

import type { ExcalidrawPage } from "../types";

const page = (paper?: ExcalidrawPage["paper"]): ExcalidrawPage => ({
  id: "page-1",
  name: "Page 1",
  ...(paper ? { paper } : {}),
});

describe("AC-273 the paper of a page is data that is kept", () => {
  it("AC-273 the types the colours and the looks", () => {
    expect(PAPER_TYPES).toEqual([
      "plain",
      "single-line",
      "double-line",
      "grid",
      "dot-grid",
      "cornell",
      "isometric",
      "music",
    ]);

    expect(PAPER_COLORS).toHaveLength(12);
    expect(new Set(PAPER_COLORS.map((c) => c.id)).size).toBe(12);
    expect(new Set(PAPER_COLORS.map((c) => c.name)).size).toBe(12);

    const dark = PAPER_COLORS.filter((c) => c.dark).map((c) => c.name);

    expect(dark).toEqual(["Green chalkboard", "Blackboard", "Midnight"]);

    expect(PAPER_LOOKS.map((look) => look.name)).toEqual([
      "Old paper",
      "Green chalkboard",
      "Blackboard",
      "Neon night",
    ]);

    // every look is a paper that exists, with the ink that goes with it
    for (const look of PAPER_LOOKS) {
      expect(PAPER_COLORS.some((c) => c.id === look.paper.color)).toBe(true);
      expect(PAPER_TYPES).toContain(look.paper.type);
      expect(look.ink.color).toMatch(/^#[0-9a-f]{6}$/i);
    }

    expect(PAPER_LOOKS.find((l) => l.id === "green-chalkboard")!.ink.look).toBe(
      "chalk",
    );
    expect(PAPER_LOOKS.find((l) => l.id === "neon-night")!.ink.look).toBe(
      "neon",
    );
  });

  it("AC-273 a page without a paper is plain", () => {
    const old = page();

    expect(paperOf(old)).toEqual(PLAIN_PAPER);
    expect(isPlainPaper(paperOf(old))).toBe(true);
    expect(
      getPagePaperDraw(old, { x: 0, y: 0, width: 1920, height: 1080 }),
    ).toBe(null);

    // and it has nothing to draw in the page's decoration
    expect(
      getPageDecoration({ pages: [old], pageId: "page-1" }).paper,
    ).toBeUndefined();
  });

  it("AC-273 the values are kept in range", () => {
    const odd = paperOf(
      page({
        type: "nonsense" as never,
        color: "nonsense",
        grain: 400,
        age: -20,
      }),
    );

    expect(odd).toEqual({
      type: "plain",
      color: CANVAS_PAPER_COLOR,
      grain: 100,
      age: 0,
    });

    expect(
      paperOf(page({ type: "grid", color: "cream", grain: 12.6, age: 3 })),
    ).toEqual({ type: "grid", color: "cream", grain: 13, age: 3 });
  });

  it("AC-273 the paper belongs to the page and is saved", () => {
    const pages = [page(), { id: "page-2", name: "Page 2" }];
    const paper = {
      type: "cornell",
      color: "legal",
      grain: 20,
      age: 40,
    } as const;

    const changed = updatePage({
      pages,
      pageId: "page-2",
      properties: { paper },
    });

    expect(changed[0].paper).toBeUndefined();
    expect(changed[1].paper).toEqual(paper);

    // the page's decoration carries the paper to the canvas and the exports
    const decoration = getPageDecoration({ pages: changed, pageId: "page-2" });

    expect(decoration.paper?.paper).toEqual(paper);
    expect(decoration.paper?.color).toBe("#fff3a3");

    // saved and loaded
    const restored = restoreAppState(
      { pages: changed, currentPageId: "page-2" } as never,
      null,
    );

    expect(restored.pages[1].paper).toEqual(paper);
    expect(restored.pages[0].paper).toBeUndefined();
  });

  it("AC-273 a page's seed is its own", () => {
    expect(seedOf("page-1")).toBe(seedOf("page-1"));
    expect(seedOf("page-1")).not.toBe(seedOf("page-2"));
  });
});
