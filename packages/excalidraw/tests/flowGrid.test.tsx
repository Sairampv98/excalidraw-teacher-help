/**
 * AC-259 - the grid is a table (D-234).
 */

import { describe, expect, it } from "vitest";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { applyFlowScript } from "../scene/flowApply";
import { checkFlowScript } from "../scene/flowCheck";
import { buildFlowPreset } from "../scene/flowPresets";
import { parseFlowScript } from "../scene/flowScript";

import { expectNoOverlap, nodesOf } from "./helpers/flowLargeHelpers";

import type { FlowPresetId } from "../scene/flowScript";

const PAGE = { x: 0, y: 0, width: 1920, height: 1080 };

const build = (
  preset: "grid" | "matrix",
  script: string,
  options: Partial<Parameters<typeof buildFlowPreset>[2]> = {},
) => {
  const built = buildFlowPreset(preset, script, {
    seed: 3,
    page: PAGE,
    ...options,
  });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements;
};

const labelOf = (
  elements: readonly ExcalidrawElement[],
  shape: ExcalidrawElement,
) =>
  (
    elements.find(
      (e): e is ExcalidrawTextElement =>
        e.type === "text" && e.containerId === shape.id,
    ) as ExcalidrawTextElement
  ).originalText;

const cell = (elements: readonly ExcalidrawElement[], label: string) =>
  nodesOf(elements).find((n) => labelOf(elements, n) === label)!;

const rnd = (n: number) => Math.round(n * 100) / 100;

describe("AC-259 the grid is a table", () => {
  it("AC-259 cells make rows and columns", () => {
    const parsed = parseFlowScript("grid", "a | b | c\nd | e | f");

    expect(
      parsed.ok && parsed.nodes.map((n) => [n.label, n.row, n.col]),
    ).toEqual([
      ["a", 0, 0],
      ["b", 0, 1],
      ["c", 0, 2],
      ["d", 1, 0],
      ["e", 1, 1],
      ["f", 1, 2],
    ]);

    const elements = build("grid", "a | b | c\nd | e | f");

    // the same row is the same height on the page, the same column the same place
    for (const [x, y] of [
      ["a", "b"],
      ["b", "c"],
      ["d", "e"],
    ]) {
      expect(rnd(cell(elements, x).y)).toBe(rnd(cell(elements, y).y));
      expect(cell(elements, y).x).toBeGreaterThan(cell(elements, x).x);
    }

    for (const [x, y] of [
      ["a", "d"],
      ["b", "e"],
      ["c", "f"],
    ]) {
      expect(rnd(cell(elements, x).x)).toBe(rnd(cell(elements, y).x));
      expect(cell(elements, y).y).toBeGreaterThan(cell(elements, x).y);
    }
  });

  it("AC-259 a short row leaves cells undrawn", () => {
    // the shorter row has fewer cells: nothing is drawn where it has none
    const short = build("grid", "a | b | c\nd");

    expect(nodesOf(short)).toHaveLength(4);
    expect(rnd(cell(short, "d").x)).toBe(rnd(cell(short, "a").x));

    // an empty cell between two bars is a gap, and keeps the columns where they were
    const gap = parseFlowScript("grid", "a || c\nd | e | f");

    expect(gap.ok && gap.nodes.map((n) => [n.label, n.col])).toEqual([
      ["a", 0],
      ["c", 2],
      ["d", 0],
      ["e", 1],
      ["f", 2],
    ]);
    expect(nodesOf(build("grid", "a || c\nd | e | f"))).toHaveLength(5);

    // a row with no cell at all is a problem with its line
    expect(
      checkFlowScript("grid", "a | b\n |\nc").problems.map((p) => p.line),
    ).toEqual([2]);
  });

  it("AC-259 a header row is its own fill", () => {
    const elements = build("grid", "# Name | Role\nAda | Lead\nBo | Aide");
    const header = cell(elements, "Name");
    const body = cell(elements, "Ada");

    expect(header.backgroundColor).toBe("#a5d8ff");
    expect(body.backgroundColor).toBe("#b2f2bb");
    expect(cell(elements, "Role").backgroundColor).toBe(header.backgroundColor);
    expect(cell(elements, "Lead").backgroundColor).toBe(body.backgroundColor);

    // the header is the first row, and the # is not part of its words
    expect(header.y).toBeLessThan(body.y);
    expect(labelOf(elements, header)).toBe("Name");
  });

  it("AC-259 the cells meet in straight lines", () => {
    const elements = build(
      "grid",
      "Short | A much longer cell | x\nA row with more words | b | c\nd | e | f",
    );

    const nodes = nodesOf(elements);
    const byCol = new Map<number, ExcalidrawElement[]>();
    const byRow = new Map<number, ExcalidrawElement[]>();

    for (const n of nodes) {
      const flow = n.customData!.flow;
      const parsed = parseFlowScript(
        "grid",
        "Short | A much longer cell | x\nA row with more words | b | c\nd | e | f",
      );
      const info = parsed.ok
        ? parsed.nodes.find((p) => p.id === flow.nodeId)!
        : undefined;

      byCol.set(info!.col!, [...(byCol.get(info!.col!) ?? []), n]);
      byRow.set(info!.row!, [...(byRow.get(info!.row!) ?? []), n]);
    }

    // every cell of a column is as wide as the column and starts at the same x
    for (const cells of byCol.values()) {
      for (const c of cells) {
        expect(rnd(c.x)).toBe(rnd(cells[0].x));
        expect(rnd(c.width)).toBe(rnd(cells[0].width));
      }
    }

    for (const cells of byRow.values()) {
      for (const c of cells) {
        expect(rnd(c.y)).toBe(rnd(cells[0].y));
        expect(rnd(c.height)).toBe(rnd(cells[0].height));
      }
    }

    // the cells meet with only a small gap, and do not overlap
    const sorted = [...byCol.values()].sort((a, b) => a[0].x - b[0].x);

    for (let i = 1; i < sorted.length; i++) {
      const gap =
        sorted[i][0].x - (sorted[i - 1][0].x + sorted[i - 1][0].width);

      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(20);
    }

    expectNoOverlap(elements);
  });

  it("AC-259 a matrix is two larger columns", () => {
    const script = "a | b\nc | d";
    const grid = build("grid", script);
    const matrix = build("matrix", script);

    expect(nodesOf(matrix)).toHaveLength(4);

    // two columns, and every cell larger than the same cell of a grid
    expect(new Set(nodesOf(matrix).map((n) => rnd(n.x))).size).toBe(2);

    for (const label of ["a", "b", "c", "d"]) {
      expect(cell(matrix, label).width).toBeGreaterThan(
        cell(grid, label).width,
      );
      expect(cell(matrix, label).height).toBeGreaterThan(
        cell(grid, label).height,
      );
    }

    // its four quadrants are four fills
    expect(new Set(nodesOf(matrix).map((n) => n.backgroundColor)).size).toBe(4);

    // a row with three cells is a problem with its line
    expect(
      checkFlowScript(
        "matrix" as FlowPresetId,
        "a | b\nc | d | e",
      ).problems.map((p) => p.line),
    ).toEqual([2]);
  });

  it("AC-259 apply keeps the cell a label has", () => {
    const before = build("grid", "a | b\nc | d", { chartId: "chart-grid" });
    // the teacher recoloured one cell and moved another out to the right
    const edited = before.map((e) => {
      if (e.type === "text" || e.customData?.flow?.role !== "node") {
        return e;
      }

      const label = labelOf(before, e);

      return label === "b"
        ? ({ ...e, backgroundColor: "#ff6b6b" } as ExcalidrawElement)
        : label === "d"
        ? ({ ...e, x: e.x + 30 } as ExcalidrawElement)
        : e;
    });

    const result = applyFlowScript({
      elements: edited,
      chartId: "chart-grid",
      preset: "grid",
      script: "a | b\nc | d\ne | f",
      fit: "page",
      shape: "own",
      page: PAGE,
      seed: 7,
    });

    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.rebuilt).toBe(false);
    expect(result).toMatchObject({ kept: 4, added: 2, removed: 0 });

    const live = result.elements.filter((e) => !e.isDeleted);

    for (const label of ["a", "b", "c", "d"]) {
      const was = cell(edited, label);
      const is = cell(live, label);

      expect(is.id).toBe(was.id);
      expect([is.x, is.y]).toEqual([was.x, was.y]);
    }

    expect(cell(live, "b").backgroundColor).toBe("#ff6b6b");
    expect(nodesOf(live)).toHaveLength(6);
    expectNoOverlap(live);
  });
});
