/**
 * AC-258 - the gallery: nine layouts that need no arrows (D-232).
 *
 * Each layout is built from its example script by the real builder and read
 * back as elements.
 */

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { FLOW_PRESETS, buildFlowPreset } from "../scene/flowPresets";
import { FLOW_GALLERY_IDS } from "../scene/flowScript";
import { PAGE_HEIGHT, PAGE_WIDTH } from "../types";

import {
  expectNoOverlap,
  nodesOf,
  pageIndexOf,
} from "./helpers/flowLargeHelpers";

import type { FlowGalleryPresetId } from "../scene/flowScript";

const PAGE = { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT };

const exampleOf = (id: string) =>
  FLOW_PRESETS.find((p) => p.id === id)!.example;

const build = (
  id: FlowGalleryPresetId,
  options: Partial<Parameters<typeof buildFlowPreset>[2]> = {},
  script = exampleOf(id),
) => {
  const built = buildFlowPreset(id, script, {
    seed: 2,
    page: PAGE,
    ...options,
  });

  if (!built.ok) {
    throw new Error(`${id}: ${built.error}`);
  }

  return built;
};

const roleOf = (e: ExcalidrawElement) => e.customData?.flow?.role as string;

const kindOf = (shape: ExcalidrawElement) =>
  shape.type === "rectangle"
    ? shape.roundness
      ? "rounded"
      : "rectangle"
    : shape.type === "ellipse" && shape.width === shape.height
    ? "circle"
    : shape.type;

/** the words drawn in a chart, bound or free */
const wordsOf = (elements: readonly ExcalidrawElement[]) =>
  elements
    .filter((e) => e.type === "text" && roleOf(e) === "label")
    .map((e) => (e as { originalText: string }).originalText);

/** the number of nodes each example makes */
const NODE_COUNT: Record<FlowGalleryPresetId, number> = {
  list: 4,
  grid: 12,
  matrix: 4,
  pyramid: 6,
  funnel: 4,
  timeline: 4,
  target: 4,
  venn: 3,
  hierarchy: 6,
};

describe("AC-258 the gallery: nine layouts that need no arrows", () => {
  it("AC-258 each layout builds from its script", () => {
    expect([...FLOW_GALLERY_IDS]).toEqual([
      "list",
      "grid",
      "matrix",
      "pyramid",
      "funnel",
      "timeline",
      "target",
      "venn",
      "hierarchy",
    ]);

    for (const id of FLOW_GALLERY_IDS) {
      const built = build(id);

      expect(nodesOf(built.elements), id).toHaveLength(NODE_COUNT[id]);

      // the words of the script, all of them, each once
      const expected = exampleOf(id)
        .split("\n")
        .flatMap((line) => line.replace(/^\s*#/, "").split("|"))
        .map((cell) => cell.trim())
        .filter(Boolean)
        .sort();

      expect(wordsOf(built.elements).sort(), id).toEqual(expected);
    }
  });

  it("AC-258 the shapes of each layout are its own", () => {
    const own: Record<FlowGalleryPresetId, string> = {
      list: "rounded",
      grid: "rectangle",
      matrix: "rectangle",
      pyramid: "rectangle",
      funnel: "rectangle",
      timeline: "rounded",
      target: "ellipse",
      venn: "circle",
      hierarchy: "rounded",
    };

    for (const id of FLOW_GALLERY_IDS) {
      for (const shape of nodesOf(build(id).elements)) {
        expect(kindOf(shape), id).toBe(own[id]);
      }
    }
  });

  it("AC-258 a list stacks its lines", () => {
    const nodes = nodesOf(build("list").elements);

    // one under the next, in the order of the script, all the same width and
    // on the same middle
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i].y).toBeGreaterThanOrEqual(
        nodes[i - 1].y + nodes[i - 1].height,
      );
      expect(nodes[i].width).toBeCloseTo(nodes[0].width, 5);
      expect(nodes[i].x).toBeCloseTo(nodes[0].x, 5);
    }

    expect(nodes.map((n) => n.customData!.flow.nodeId)).toEqual([
      "n0",
      "n1",
      "n2",
      "n3",
    ]);
  });

  it("AC-258 a pyramid widens and a funnel narrows", () => {
    const widths = (id: "pyramid" | "funnel") =>
      nodesOf(build(id).elements).map((n) => n.width);

    const pyramid = widths("pyramid");
    const funnel = widths("funnel");

    for (let i = 1; i < pyramid.length; i++) {
      expect(pyramid[i]).toBeGreaterThan(pyramid[i - 1]);
    }

    for (let i = 1; i < funnel.length; i++) {
      expect(funnel[i]).toBeLessThan(funnel[i - 1]);
    }

    // and the blocks stay on one middle, going down the page
    for (const id of ["pyramid", "funnel"] as const) {
      const nodes = nodesOf(build(id).elements);
      const middle = nodes[0].x + nodes[0].width / 2;

      for (const node of nodes) {
        expect(node.x + node.width / 2).toBeCloseTo(middle, 3);
      }

      for (let i = 1; i < nodes.length; i++) {
        expect(nodes[i].y).toBeGreaterThan(nodes[i - 1].y);
      }
    }
  });

  it("AC-258 the chart fits the page", () => {
    for (const id of FLOW_GALLERY_IDS) {
      const built = build(id);

      expect(built.bounds.x, id).toBeGreaterThanOrEqual(PAGE.x);
      expect(built.bounds.y, id).toBeGreaterThanOrEqual(PAGE.y);
      expect(built.bounds.x + built.bounds.width, id).toBeLessThanOrEqual(
        PAGE.width,
      );
      expect(built.bounds.y + built.bounds.height, id).toBeLessThanOrEqual(
        PAGE.height,
      );

      // and the text is not below the floor
      expect(built.fontSize, id).toBeGreaterThanOrEqual(14);
    }

    // a chart that does not fit at full size is shrunk: a long grid
    const rows = Array.from(
      { length: 14 },
      (_, i) => `Row ${i + 1} | Something long to say | And more words here`,
    ).join("\n");
    const grid = build("grid", {}, rows);

    expect(grid.fontSize).toBeLessThan(24);
    expect(grid.bounds.height).toBeLessThanOrEqual(PAGE.height);

    // none overlap, but the target and the venn
    for (const id of FLOW_GALLERY_IDS) {
      if (id !== "target" && id !== "venn") {
        expectNoOverlap(build(id).elements);
      }
    }
  });

  it("AC-258 no arrows but connectors and the timeline's line", () => {
    for (const id of FLOW_GALLERY_IDS) {
      const arrows = build(id).elements.filter((e) => e.type === "arrow");
      const edges = arrows.filter((a) => roleOf(a) === "edge");
      const others = arrows.filter((a) => roleOf(a) !== "edge");

      if (id === "hierarchy") {
        // connectors, with no arrowhead at either end
        expect(edges.length).toBeGreaterThan(0);

        for (const edge of edges) {
          expect(edge.type === "arrow" && edge.endArrowhead).toBeNull();
        }
      } else {
        expect(edges, id).toHaveLength(0);
      }

      if (id === "timeline") {
        // the line, a stem for each part - and no arrowhead
        expect(others.some((a) => roleOf(a) === "timeline-line")).toBe(true);

        for (const a of others) {
          expect(a.type === "arrow" && a.endArrowhead).toBeNull();
        }
      } else {
        expect(others, id).toHaveLength(0);
      }
    }
  });

  it("AC-258 the node shape and keywords still apply", () => {
    // the chart's shape
    for (const shape of nodesOf(build("list", { shape: "circle" }).elements)) {
      expect(kindOf(shape)).toBe("circle");
    }

    // a keyword on one cell of a table
    const grid = build("grid", {}, "a | @circle b\nc | d");
    const cells = nodesOf(grid.elements);
    const labelOf = (shape: ExcalidrawElement) =>
      (
        grid.elements.find(
          (e) => e.type === "text" && e.containerId === shape.id,
        ) as { originalText: string }
      ).originalText;

    expect(kindOf(cells.find((c) => labelOf(c) === "b")!)).toBe("circle");
    expect(kindOf(cells.find((c) => labelOf(c) === "a")!)).toBe("rectangle");

    // and a mark in a hierarchy
    const tree = build("hierarchy", {}, "Root\n  <Child>");

    expect(nodesOf(tree.elements).map((n) => kindOf(n))).toEqual([
      "rounded",
      "diamond",
    ]);
  });

  it("AC-258 a large gallery chart is spread or enlarged", () => {
    const many = Array.from(
      { length: 90 },
      (_, i) => `Block ${i + 1} of the long lesson plan`,
    ).join("\n");

    // too much for one page at the floor: Fit to page refuses and says so
    const refused = buildFlowPreset("list", many, { seed: 2, page: PAGE });

    expect(refused.ok).toBe(false);

    // spread over the pages that follow
    const spread = build("list", { fit: "spread" }, many);

    expect(spread.pages).toBeGreaterThan(1);
    expect(nodesOf(spread.elements)).toHaveLength(90);
    expect(Math.max(...nodesOf(spread.elements).map(pageIndexOf))).toBe(
      spread.pages - 1,
    );
    expectNoOverlap(spread.elements);

    // or one chart, larger than the page
    const larger = build("list", { fit: "larger" }, many);

    expect(larger.pages).toBe(1);
    expect(larger.bounds.height).toBeGreaterThan(PAGE.height);
    expectNoOverlap(larger.elements);
  });
});
